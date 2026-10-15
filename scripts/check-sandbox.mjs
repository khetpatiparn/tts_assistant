/** X01 UAT with synthetic SQLite/WAL and real files; never opens the user's dev.db. */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { require as tsxRequire } from "tsx/cjs/api";
import { prepareSandbox, sandboxEnvironment, REPO } from "./sandbox.mjs";

const { resolveRuntimePaths, assertLiveFlowAllowed } = tsxRequire("../lib/runtime-paths.ts", import.meta.url);
const fixture = mkdtempSync(path.join(os.tmpdir(), "angle-sandbox-check-"));
const originalCwd = process.cwd();
const oldEnv = { ...process.env };
let source;
let prisma;
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
try {
  mkdirSync(path.join(fixture, "uploads", "entry-x01", "flow"), { recursive: true });
  mkdirSync(path.join(fixture, "uploads", "_candidates", "candidate-x01"), { recursive: true });
  writeFileSync(path.join(fixture, "uploads/entry-x01/photo.png"), "production photo fixture");
  writeFileSync(path.join(fixture, "uploads/entry-x01/flow/r3-a1.mp4"), "production video fixture");
  writeFileSync(path.join(fixture, "uploads/_candidates/candidate-x01/shop.png"), "shop photo fixture");
  writeFileSync(path.join(fixture, "tts-settings.json"), JSON.stringify({ postsPerDay: 4, autoGenerateTts: true }));
  writeFileSync(path.join(fixture, "flow-worker.config.json"), readFileSync(path.join(REPO, "flow-worker.config.json")));
  source = new Database(path.join(fixture, "dev.db"));
  // One legacy directory uses an ISO timestamp; compare timestamps, not punctuation.
  const timestamp = (name) => name.split("_")[0].replace(/\D/g, "");
  for (const migration of readdirSync(path.join(REPO, "prisma/migrations")).sort((a, b) => timestamp(a).localeCompare(timestamp(b)))) {
    const sql = path.join(REPO, "prisma/migrations", migration, "migration.sql");
    if (existsSync(sql)) source.exec(readFileSync(sql, "utf8"));
  }
  source.pragma("journal_mode = WAL");
  source.prepare("INSERT INTO PromptEntry (id, productName, productInfo, riskModule, extraNotes, images) VALUES (?, ?, '', '', '', '[]')").run("entry-x01", "สินค้า fixture");
  source.prepare("INSERT INTO CandidateBatch (id, capturedOn) VALUES ('batch-x01', ?)").run(Date.now());
  source.prepare("INSERT INTO ProductCandidate (id,batchId,name,nameKey,price,commission,categoryLabel,capturedOn,linkedEntryId,sourceProductId) VALUES ('candidate-x01','batch-x01','fixture','fixture',99,9,'test',?,'entry-x01','product-x01')").run(Date.now());
  source.prepare("INSERT INTO ScannerLink (id,token) VALUES ('singleton','fixture-production-token')").run();
  const sourceFiles = ["dev.db", "dev.db-wal", "tts-settings.json", "flow-worker.config.json", "uploads/entry-x01/photo.png", "uploads/entry-x01/flow/r3-a1.mp4", "uploads/_candidates/candidate-x01/shop.png"];
  const sourceHashes = sourceFiles.map((file) => hash(path.join(fixture, file)));

  check("production paths remain the legacy defaults", () => {
    const production = resolveRuntimePaths({}, fixture, fixture);
    assert.equal(production.databasePath, path.join(fixture, "dev.db"));
    assert.equal(production.uploadRoot, path.join(fixture, "uploads"));
    assert.equal(production.exportRoot, path.join(fixture, "Desktop", "TTS"));
  });
  check("test DB without isolated roots is rejected", () => assert.throws(() => resolveRuntimePaths({ DATABASE_URL: "file:./dev-test.db" }, fixture), /copied DB alone/));
  check("sandbox names cannot escape", () => assert.throws(() => sandboxEnvironment("../../uploads", fixture)));
  const env = sandboxEnvironment("uat", fixture);
  const { paths, manifest } = await prepareSandbox("uat", { repo: fixture, entryId: "entry-x01" });
  check("SQLite snapshot includes committed rows from live WAL", () => {
    const copy = new Database(paths.databasePath, { readonly: true });
    try {
      assert.equal(copy.pragma("integrity_check", { simple: true }), "ok");
      assert.equal(copy.prepare("SELECT productName FROM PromptEntry WHERE id = 'entry-x01'").get().productName, "สินค้า fixture");
      assert.notEqual(copy.prepare("SELECT token FROM ScannerLink").get().token, "fixture-production-token");
    } finally { copy.close(); }
  });
  check("only selected media is copied, with correct bytes", () => {
    assert.equal(manifest.entryId, "entry-x01");
    assert.deepEqual(manifest.missing, []);
    assert.equal(hash(path.join(paths.uploadRoot, "entry-x01/photo.png")), sourceHashes[4]);
    assert.ok(existsSync(path.join(paths.uploadRoot, "_candidates/candidate-x01/shop.png")));
    assert.ok(!existsSync(paths.profileDir));
  });
  await assert.rejects(prepareSandbox("uat", { repo: fixture }), /EEXIST/);
  passed++; console.log("PASS preparation cannot overwrite an existing sandbox");
  for (const key of ["DATABASE_URL", "ANGLE_UPLOAD_ROOT", "ANGLE_SETTINGS_FILE", "ANGLE_WORKER_CONFIG", "ANGLE_FLOW_PROFILE", "ANGLE_STOP_FILE", "CLIP_EXPORT_ROOT", "ANGLE_BACKUP_ROOT"]) {
    const unsafe = { ...env, [key]: key === "DATABASE_URL" ? `file:${path.join(fixture, "dev.db")}` : path.join(fixture, "uploads") };
    check(`reject production override: ${key}`, () => assert.throws(() => resolveRuntimePaths(unsafe, fixture), /must stay inside/));
  }
  const linkedUploads = path.join(paths.sandboxRoot, "linked-uploads");
  symlinkSync(path.join(fixture, "uploads"), linkedUploads, process.platform === "win32" ? "junction" : "dir");
  check("reject a junction back to production", () => assert.throws(() => resolveRuntimePaths({ ...env, ANGLE_UPLOAD_ROOT: linkedUploads }, fixture)));
  unlinkSync(linkedUploads);
  const dangling = path.join(paths.sandboxRoot, "dangling-uploads");
  symlinkSync(path.join(fixture, "not-created"), dangling, process.platform === "win32" ? "junction" : "dir");
  check("reject a dangling junction", () => assert.throws(() => resolveRuntimePaths({ ...env, ANGLE_UPLOAD_ROOT: dangling }, fixture)));
  unlinkSync(dangling);
  const linkedDb = path.join(paths.sandboxRoot, "linked.db");
  linkSync(path.join(fixture, "dev.db"), linkedDb);
  check("reject a hardlinked test database", () => assert.throws(() => resolveRuntimePaths({ ...env, DATABASE_URL: `file:${linkedDb}` }, fixture), /hardlinked/));
  unlinkSync(linkedDb);

  Object.assign(process.env, env);
  process.chdir(fixture);
  process.env.ANGLE_UPLOAD_ROOT = path.join(fixture, "uploads");
  check("Next startup rejects shared production storage", () => assert.throws(() => tsxRequire(path.join(REPO, "next.config.ts"), import.meta.url), /must stay inside/));
  process.env.ANGLE_UPLOAD_ROOT = env.ANGLE_UPLOAD_ROOT;
  process.env.NEXT_DIST_DIR = ".next";
  check("Next startup rejects shared production build directory", () => assert.throws(() => tsxRequire(path.join(REPO, "next.config.ts"), import.meta.url), /NEXT_DIST_DIR=.next-dev/));
  process.env.NEXT_DIST_DIR = env.NEXT_DIST_DIR;
  check("live browser entry point is blocked in sandbox", () => assert.throws(assertLiveFlowAllowed, /live Flow/));
  const uploads = tsxRequire(path.join(REPO, "lib/upload-paths.ts"), import.meta.url);
  const settings = tsxRequire(path.join(REPO, "lib/tts-settings.ts"), import.meta.url);
  const exporter = tsxRequire(path.join(REPO, "lib/clip-export-fs.ts"), import.meta.url);
  prisma = tsxRequire(path.join(REPO, "lib/prisma.ts"), import.meta.url).prisma;
  await prisma.promptEntry.update({ where: { id: "entry-x01" }, data: { productName: "แก้เฉพาะ sandbox" } });
  await settings.updateSystemSettings({ postsPerDay: 7 });
  writeFileSync(path.join(uploads.UPLOAD_ROOT, "entry-x01/photo.png"), "changed sandbox photo");
  const result = await exporter.exportClip({
    root: exporter.clipExportRoot(), now: new Date(2026, 9, 15), prev: null,
    job: { productName: "fixture", chatgptOutput: "", caption: "ทดสอบ", hashtags: "", flowDir: path.join(uploads.UPLOAD_ROOT, "entry-x01/flow"), images: [{ kind: "video", round: 3, chosen: false, filename: "r3-a1.mp4" }] },
  });
  check("DB/settings/photo/export mutations stay inside sandbox", () => {
    assert.equal(uploads.UPLOAD_ROOT, paths.uploadRoot);
    assert.equal(JSON.parse(readFileSync(paths.settingsFile)).postsPerDay, 7);
    assert.ok(path.relative(paths.exportRoot, result.path).startsWith("October"));
    assert.ok(existsSync(path.join(result.path, "คลิป-720p.mp4")));
    assert.deepEqual(sourceFiles.map((file) => hash(path.join(fixture, file))), sourceHashes);
    assert.equal(source.prepare("SELECT productName FROM PromptEntry WHERE id = 'entry-x01'").get().productName, "สินค้า fixture");
  });
  unlinkSync(path.join(uploads.UPLOAD_ROOT, "entry-x01/photo.png"));
  check("deleting a sandbox photo preserves production photo", () => assert.equal(hash(path.join(fixture, "uploads/entry-x01/photo.png")), sourceHashes[4]));
  await prisma.$disconnect();
  prisma = null;
  const worker = spawnSync(process.execPath, [path.join(REPO, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", path.join(REPO, "tsconfig.json"), path.join(REPO, "worker/index.ts")], { cwd: fixture, env: { ...process.env, ...env }, encoding: "utf8", timeout: 30_000, shell: false });
  check("accidental Flow worker start exits without opening Chrome", () => {
    assert.equal(worker.status, 0, worker.stderr);
    assert.match(worker.stdout, /Flow worker is disabled/);
    assert.ok(!existsSync(paths.profileDir));
    assert.deepEqual(sourceFiles.map((file) => hash(path.join(fixture, file))), sourceHashes);
  });
  console.log(`\n${passed} sandbox checks passed (synthetic DB/files, no live APIs or production writes).`);
} finally {
  await prisma?.$disconnect();
  source?.close();
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
  Object.assign(process.env, oldEnv);
  assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(fixture).startsWith("angle-sandbox-check-"));
  rmSync(fixture, { recursive: true, force: true });
}
