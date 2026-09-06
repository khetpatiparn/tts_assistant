/**
 * ตรวจโมดูล pure ของ worker (config / humanize / schedule) — แทน test runner ที่โปรเจกต์ไม่มี
 * รัน: node scripts/check-flow-worker-pure.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-flow-tmp-"));
let failed = 0;

function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}
function checkThrows(name, fn, includes) {
  let msg = null;
  try { fn(); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  const ok = msg !== null && msg.includes(includes);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(msg)} ควรมีคำว่า ${JSON.stringify(includes)}`);
}

try {
  execFileSync(
    "npx",
    ["tsc", "worker/config.ts", "worker/humanize.ts", "worker/schedule.ts",
     "--outDir", out, "--module", "es2022", "--target", "ES2020", "--moduleResolution", "bundler",
     "--esModuleInterop", "--skipLibCheck"],
    { stdio: "inherit", shell: true }
  );

  // ---------- config ----------
  const cfg = await import(pathToFileURL(join(out, "config.js")).href);
  const good = cfg.loadWorkerConfig("flow-worker.config.json");
  check("default dailyBatchCap = 24", good.dailyBatchCap, 24);
  check("default activeHours = null", good.activeHours, null);
  check("actionDelayMs is a range", Array.isArray(good.actionDelayMs) && good.actionDelayMs.length === 2, true);

  const badPath = join(out, "bad.json");
  writeFileSync(badPath, JSON.stringify({ ...good, actionDelayMs: [3000, 800] }));
  checkThrows("range with min > max rejected", () => cfg.loadWorkerConfig(badPath), "actionDelayMs");

  writeFileSync(badPath, JSON.stringify({ ...good, activeHours: ["25:00", "07:00"] }));
  checkThrows("activeHours invalid hour rejected", () => cfg.loadWorkerConfig(badPath), "activeHours");

  writeFileSync(badPath, JSON.stringify({ ...good, dailyBatchCap: 0 }));
  checkThrows("dailyBatchCap must be >= 1", () => cfg.loadWorkerConfig(badPath), "dailyBatchCap");

  // ---------- humanize / schedule checks are appended by later tasks ----------
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
