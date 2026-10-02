/**
 * ตรวจตรรกะ pure ของ lib/clip-export.ts — รัน: node scripts/check-clip-export.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-clip-export-tmp-"));
let failed = 0;
function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}

try {
  execFileSync("npx", ["tsc", "lib/clip-export.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"], { stdio: "inherit", shell: true });
  const c = await import(pathToFileURL(join(out, "clip-export.js")).href);

  const a = c.exportDateParts(new Date(2027, 0, 5));
  check("5 ม.ค. 2027 → January / 5-1-70", `${a.month} ${a.day}`, "January 5-1-70");
  const b = c.exportDateParts(new Date(2026, 11, 31));
  check("31 ธ.ค. 2026 → December / 31-12-69", `${b.month} ${b.day}`, "December 31-12-69");
  const d = c.exportDateParts(new Date(2026, 9, 1));
  check("1 ต.ค. 2026 → October / 1-10-69", `${d.month} ${d.day}`, "October 1-10-69");

  check("slot: 1, 2_x, abc → 3", c.nextSlotNumber(["1", "2_x", "abc"]), 3);
  check("slot: ว่าง → 1", c.nextSlotNumber([]), 1);
  check("slot: ข้ามเลข 1, 5 → 6", c.nextSlotNumber(["1", "5_a"]), 6);
  check("slot: ไม่มีเลขเลย → 1", c.nextSlotNumber(["abc"]), 1);

  check("short: อักขระต้องห้ามหาย", c.shortFolderName('a\\b/c:d*e?f"g<h>i|j'), "abcdefghij");
  check("short: ขึ้นบรรทัดใหม่ + ยุบช่องว่าง", c.shortFolderName("ที่ลับ\nเล็บ   แมว"), "ที่ลับ เล็บ แมว");
  check("short: ตัดวงเล็บโปร 【…】", c.shortFolderName("【พร้อมฝา+ช้อน】กล่องพลาสติกใส"), "กล่องพลาสติกใส");
  check("short: ตัดที่ 30 ตัว", Array.from(c.shortFolderName("ก".repeat(50))).length, 30);
  check("short: ว่าง → clip", c.shortFolderName("   "), "clip");
  check("short: มีแต่อักขระต้องห้าม → clip", c.shortFolderName("???"), "clip");

  check("slotFolderName", c.slotFolderName(3, "กล่อง"), "3_กล่อง");
  check("post: ครบ 3 ส่วน", c.buildPostText({ productName: "A", caption: "B", hashtags: "#c" }), "A\n\nB\n\n#c");
  check("post: ข้ามส่วนว่าง", c.buildPostText({ productName: "A", caption: " ", hashtags: "#c" }), "A\n\n#c");

  // B1: ส่งซ้ำหลังคลิปเปลี่ยน (720p → 1080p / เรนเดอร์ใหม่) ต้องอัปเดตโฟลเดอร์เดิม ไม่ใช่คืนของเก่า
  check("detail ใหม่ {path, video}", JSON.stringify(c.parseExportDetail('{"path":"C:/TTS/1_a","video":"r3-a1.mp4"}')), JSON.stringify({ path: "C:/TTS/1_a", video: "r3-a1.mp4" }));
  check("detail เก่าไม่มี video → video null", JSON.stringify(c.parseExportDetail('{"path":"C:/TTS/1_a"}')), JSON.stringify({ path: "C:/TTS/1_a", video: null }));
  check("detail เสีย → null", c.parseExportDetail("{oops"), null);
  check("detail ไม่มี path → null", c.parseExportDetail('{"video":"r3-a1.mp4"}'), null);
  const prev720 = { path: "C:/TTS/1_a", video: "r3-a1.mp4" };
  check("ยังไม่เคยส่ง → new", c.exportAction(null, false, "r3-a1.mp4"), "new");
  check("ส่งแล้ว คลิปเดิม โฟลเดอร์อยู่ → already", c.exportAction(prev720, true, "r3-a1.mp4"), "already");
  check("ส่งไว้ 720p แล้วได้ 1080p → update", c.exportAction(prev720, true, "r3-final.mp4"), "update");
  check("เรนเดอร์ใหม่ (r3-a2) → update", c.exportAction(prev720, true, "r3-a2.mp4"), "update");
  check("โฟลเดอร์ถูกลบ → new แม้คลิปเดิม", c.exportAction(prev720, false, "r3-a1.mp4"), "new");
  check("แถวเก่าไม่รู้ว่าส่งคลิปไหน → update (ก๊อปซ้ำปลอดภัย)", c.exportAction({ path: "C:/TTS/1_a", video: null }, true, "r3-a1.mp4"), "update");
  check("ชื่อคลิป 1080p", c.exportClipName(true), "คลิป-1080p.mp4");
  check("ชื่อคลิป 720p", c.exportClipName(false), "คลิป-720p.mp4");
  check("คลิปอีกขนาดที่ต้องลบตอนอัปเดตเป็น 1080p", c.otherExportClipName(true), "คลิป-720p.mp4");
  check("hint: ส่ง 720p ไว้ ตอนนี้มี 1080p", c.exportStaleHint("r3-a1.mp4", "r3-final.mp4", "r3-final.mp4"), "ส่งไว้เป็น 720p — กดเพื่ออัปเดตเป็น 1080p");
  check("hint: เรนเดอร์ใหม่", c.exportStaleHint("r3-a1.mp4", "r3-a2.mp4", "r3-final.mp4"), "มีคลิปใหม่กว่า — กดเพื่ออัปเดต");
  check("hint: คลิปเดิม → ไม่มี", c.exportStaleHint("r3-final.mp4", "r3-final.mp4", "r3-final.mp4"), null);
  check("hint: แถวเก่าไม่รู้ video → ไม่มี (ไม่เดา)", c.exportStaleHint(null, "r3-final.mp4", "r3-final.mp4"), null);
  check("hint: ไม่มีคลิปตอนนี้ → ไม่มี", c.exportStaleHint("r3-a1.mp4", null, "r3-final.mp4"), null);
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
