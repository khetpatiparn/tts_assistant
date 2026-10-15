/** Isolated local app sandbox; never starts Flow or copies its browser profile. */
import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { require as tsxRequire } from "tsx/cjs/api";

const { resolveRuntimePaths } = tsxRequire("../lib/runtime-paths.ts", import.meta.url);
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function sandboxEnvironment(name, repo = REPO) {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(name ?? "")) {
    throw new Error("Sandbox name: use 1–48 lowercase letters, digits or hyphens.");
  }
  const root = path.join(repo, ".scratch", "sandboxes", name);
  return {
    ANGLE_SANDBOX_ROOT: root,
    DATABASE_URL: `file:${path.join(root, "dev-test.db")}`,
    ANGLE_UPLOAD_ROOT: path.join(root, "uploads"),
    ANGLE_SETTINGS_FILE: path.join(root, "tts-settings.json"),
    ANGLE_WORKER_CONFIG: path.join(root, "flow-worker.config.json"),
    ANGLE_FLOW_PROFILE: path.join(root, ".flow-profile"),
    ANGLE_STOP_FILE: path.join(root, ".flow-worker.stop"),
    CLIP_EXPORT_ROOT: path.join(root, "exports"),
    ANGLE_BACKUP_ROOT: path.join(root, "backups"),
    NEXT_DIST_DIR: ".next-dev",
    // Empty shell variables take precedence over the real .env loaded by Next/dotenv.
    GEMINI_API_KEY: "",
    TYPESAFE_API_KEY: "",
  };
}

async function jsonOr(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Copy bytes, not links, and detect a source file changing while it is copied. */
async function copyMedia(source, target) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Refusing to copy linked media: ${source}`);
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source)) await copyMedia(path.join(source, name), path.join(target, name));
  } else if (info.isFile()) {
    const before = digest(await readFile(source));
    await copyFile(source, target);
    const after = digest(await readFile(source));
    if (before !== after || before !== digest(await readFile(target))) {
      throw new Error("Source media changed while copying; prepare a new sandbox after this render finishes.");
    }
  } else throw new Error(`Unsupported media file: ${source}`);
}

export async function prepareSandbox(name, { repo = REPO, entryId } = {}) {
  const env = sandboxEnvironment(name, repo);
  const paths = resolveRuntimePaths(env, repo);
  // Source is opened read-only; SQLite backup includes committed WAL pages.
  const source = new Database(path.join(repo, "dev.db"), { readonly: true, fileMustExist: true });
  try {
    await mkdir(path.dirname(paths.sandboxRoot), { recursive: true });
    // Refuse reuse rather than overwrite a sandbox whose server may be running.
    await mkdir(paths.sandboxRoot);
    const deadline = Date.now() + 30_000;
    await source.backup(paths.databasePath, { progress: () => {
      if (Date.now() > deadline) throw new Error("SQLite snapshot timed out; retry with a new sandbox name.");
      return 128;
    } });
  } finally { source.close(); }

  const db = new Database(paths.databasePath);
  let selectedId;
  let candidates;
  try {
    if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Sandbox DB integrity check failed.");
    db.pragma("journal_mode = WAL");
    selectedId = entryId ?? db.prepare("SELECT id FROM PromptEntry ORDER BY createdAt DESC LIMIT 1").get()?.id;
    if (!selectedId || !/^[a-zA-Z0-9_-]+$/.test(selectedId) || !db.prepare("SELECT id FROM PromptEntry WHERE id = ?").get(selectedId)) {
      throw new Error("No matching entry to copy. Pass --entry with an existing entry ID.");
    }
    candidates = db.prepare("SELECT id FROM ProductCandidate WHERE linkedEntryId = ?").all(selectedId);
    // Snapshot rows describe the copied worker, not a sandbox process that is alive.
    db.prepare("UPDATE FlowWorkerState SET lastSeenAt = NULL, currentJobId = NULL, nextWakeAt = NULL, pausedReason = 'sandbox_disabled'").run();
    // A copied scanner secret must never impersonate the production destination.
    db.prepare("UPDATE ScannerLink SET token = ?").run(randomBytes(32).toString("hex"));
  } finally { db.close(); }

  await mkdir(paths.uploadRoot, { recursive: true });
  const missing = [];
  const relativeDirs = [selectedId, ...candidates.map((row) => path.join("_candidates", row.id))];
  for (const relative of relativeDirs) {
    if (relative.split(path.sep).some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment))) throw new Error("Invalid media directory in snapshot.");
    try { await copyMedia(path.join(repo, "uploads", relative), path.join(paths.uploadRoot, relative)); }
    catch (error) { if (error.code === "ENOENT") missing.push(relative); else throw error; }
  }
  const settings = await jsonOr(path.join(repo, "tts-settings.json"), {});
  await writeFile(paths.settingsFile, JSON.stringify({ ...settings, autoGenerateTts: false, autoMergeVideo: false }, null, 2) + "\n");
  const worker = await jsonOr(path.join(repo, "flow-worker.config.json"), {});
  await writeFile(paths.workerConfigFile, JSON.stringify({ ...worker, profileDir: paths.profileDir }, null, 2) + "\n");
  await mkdir(paths.exportRoot, { recursive: true });
  await mkdir(paths.backupRoot, { recursive: true });
  const manifest = { version: 1, name, preparedAt: new Date().toISOString(), entryId: selectedId, mediaScope: "selected-entry-and-linked-candidates", missing };
  // Written last. Incomplete preparation cannot be launched.
  await writeFile(path.join(paths.sandboxRoot, "sandbox.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { paths, manifest };
}

export async function startSandbox(name) {
  const env = { ...process.env, ...sandboxEnvironment(name) };
  const paths = resolveRuntimePaths(env, REPO);
  const manifest = JSON.parse(await readFile(path.join(paths.sandboxRoot, "sandbox.json"), "utf8"));
  if (manifest.version !== 1 || manifest.name !== name) throw new Error("Sandbox preparation is incomplete or does not match its name.");
  const snapshot = new Database(paths.databasePath, { readonly: true, fileMustExist: true });
  try {
    if (snapshot.pragma("quick_check", { simple: true }) !== "ok") throw new Error("Sandbox database is not healthy.");
  } finally { snapshot.close(); }
  const net = await import("node:net");
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error("Port 3051 is occupied. Do not start a second .next-dev process.")));
    probe.listen(3051, "127.0.0.1", () => probe.close(resolve));
  });
  console.log(`SANDBOX: http://localhost:3051/entry/${manifest.entryId}`);
  console.log(`Storage: ${paths.sandboxRoot}\nLive Flow and AI keys: disabled. Ctrl+C stops this dev server only.`);
  const child = spawn(process.execPath, [path.join(REPO, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "-p", "3051"], { cwd: REPO, env, stdio: "inherit", shell: false });
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}

async function main() {
  const [command, name, ...args] = process.argv.slice(2);
  if (!command || command === "--help") {
    console.log("node scripts/sandbox.mjs prepare <name> [--entry <id>]\nnode scripts/sandbox.mjs start <name>");
    console.log("Copies the DB and selected entry's media only; other entries may have no local media. Never runs production start/stop or Flow.");
    return;
  }
  if (command === "prepare") {
    if (args.length && (args.length !== 2 || args[0] !== "--entry" || !args[1])) throw new Error("Expected optional --entry <id> only.");
    const { paths, manifest } = await prepareSandbox(name, { entryId: args[1] });
    console.log(`Prepared ${paths.sandboxRoot}\nEntry: ${manifest.entryId}\nMissing media directories: ${manifest.missing.length}\nStart: node scripts/sandbox.mjs start ${name}`);
  } else if (command === "start" && args.length === 0) await startSandbox(name);
  else throw new Error("Use prepare <name> [--entry <id>] or start <name>.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
