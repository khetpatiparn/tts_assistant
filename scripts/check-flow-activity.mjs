/**
 * ตรวจตรรกะ pure ของ lib/flow-activity.ts — รัน: node scripts/check-flow-activity.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-activity-tmp-"));
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}

try {
  execFileSync("npx", ["tsc", "lib/flow-activity.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"], { stdio: "inherit", shell: true });
  const a = await import(pathToFileURL(join(out, "flow-activity.js")).href);
  const now = new Date("2026-10-01T10:00:00+07:00");
  const at = (min) => new Date(now.getTime() - min * 60000);
  const gen = (min) => ({ at: at(min), kind: "generate_image" });

  check("ไม่มีแถว → 0/0/null", a.summarizeActivity([], now), { today: 0, peakPer10Min: 0, lastWarnAt: null });
  check("นับเฉพาะ kind ที่เป็นการยิง (generate/upload/new_project) ไม่นับ break/session_start",
    a.summarizeActivity([gen(1), { at: at(2), kind: "break" }, { at: at(3), kind: "session_start" }, { at: at(4), kind: "upload" }], now).today, 2);
  check("peak = จำนวนมากสุดในช่วง 10 นาทีใดๆ", a.summarizeActivity([gen(0), gen(1), gen(2), gen(30), gen(31)], now).peakPer10Min, 3);
  check("แถวเมื่อวาน (ก่อนเที่ยงคืนท้องถิ่น) ไม่นับ today", a.summarizeActivity([gen(11 * 60)], now).today, 0);
  check("lastWarnAt = http_warn หรือ bot_signal ล่าสุด", a.summarizeActivity([{ at: at(50), kind: "http_warn" }, { at: at(20), kind: "bot_signal" }, gen(1)], now).lastWarnAt, at(20));
  check("ACTIVITY_KINDS มีครบตามสเปก", a.ACTIVITY_KINDS, ["generate_image", "generate_video", "upload", "new_project", "download", "http_warn", "bot_signal", "break", "session_start"]);
  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
