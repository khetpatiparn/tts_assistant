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
  // สร้างวันด้วย local getter — ไม่ขึ้นกับ timezone เครื่องที่รัน
  const localNow = new Date(2026, 9, 1, 10, 0);
  const yesterdayNoon = new Date(2026, 9, 0, 12, 0);
  check("แถวเมื่อวาน (ก่อนเที่ยงคืนท้องถิ่น) ไม่นับ today", a.summarizeActivity([{ at: yesterdayNoon, kind: "generate_image" }, { at: localNow, kind: "generate_image" }], localNow).today, 1);
  const t0 = new Date(2026, 9, 1, 9, 0);
  const plus = (ms) => ({ at: new Date(t0.getTime() + ms), kind: "generate_image" });
  check("t กับ t+10:00 เป๊ะ ไม่อยู่หน้าต่างเดียวกัน", a.summarizeActivity([plus(0), plus(10 * 60000)], localNow).peakPer10Min, 1);
  check("t กับ t+9:59 อยู่หน้าต่างเดียวกัน", a.summarizeActivity([plus(0), plus(9 * 60000 + 59000)], localNow).peakPer10Min, 2);
  check("lastWarnAt = http_warn หรือ bot_signal ล่าสุด", a.summarizeActivity([{ at: at(50), kind: "http_warn" }, { at: at(20), kind: "bot_signal" }, gen(1)], now).lastWarnAt, at(20));
  check("ACTIVITY_KINDS มีครบตามสเปก", a.ACTIVITY_KINDS, ["generate_image", "generate_video", "upload", "new_project", "download", "http_warn", "bot_signal", "break", "auto_continue", "round_ok", "session_start", "user_enqueue", "user_choose", "user_redraw", "user_approve_render", "user_redo_render", "user_skip", "user_resume", "user_finish_manual", "user_take_over", "user_prompt_now", "user_retry_upscale", "user_export_clip"]);
  const userRows = a.ACTIVITY_KINDS.filter((k) => k.startsWith("user_")).map((k, i) => ({ at: at(i), kind: k }));
  check("kind ของผู้ใช้ไม่นับเป็นคำขอของบอท (today/peak) และไม่นับเป็นสัญญาณเตือน", a.summarizeActivity(userRows, now), { today: 0, peakPer10Min: 0, lastWarnAt: null });
  check("ปนกับของบอท นับเฉพาะของบอท", a.summarizeActivity([...userRows, gen(1)], now).today, 1);
  check("auto_continue/round_ok ไม่นับเป็นยิง Flow วันนี้ และไม่นับเป็นสัญญาณเตือน",
    a.summarizeActivity([{ at: at(1), kind: "auto_continue" }, { at: at(2), kind: "round_ok" }], now), { today: 0, peakPer10Min: 0, lastWarnAt: null });
  check("isTakeoverKind: user_take_over และแถวเก่า user_finish_manual นับเป็นทำต่อเอง · อย่างอื่นไม่", ["user_take_over", "user_finish_manual", "user_skip", "user_export_clip", "round_ok"].map((k) => a.isTakeoverKind(k)), [true, true, false, false, false]);
  check("takeOver ไม่นับเป็นคำขอของบอท/สัญญาณเตือน", a.summarizeActivity([{ at: at(1), kind: "user_take_over" }], now), { today: 0, peakPer10Min: 0, lastWarnAt: null });
  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
