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

const checkJ = (name, actual, expected) => check(name, JSON.stringify(actual), JSON.stringify(expected));

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

  // ---------- โฟลเดอร์ตามวันโพสต์ (posting-day) ----------
  const dayKey = (d) => c.exportDateParts(d).day;
  const t = (y, m, d) => new Date(y, m - 1, d);
  check("tomorrowOf: 2 ต.ค. 2026 10:00 → 3-10-69 (เที่ยงคืนท้องถิ่น)", `${dayKey(c.tomorrowOf(new Date(2026, 9, 2, 10)))} ${c.tomorrowOf(new Date(2026, 9, 2, 10)).getHours()}`, "3-10-69 0");
  check("tomorrowOf: 23:59 ก็ยังเป็นพรุ่งนี้ของวันนั้น", dayKey(c.tomorrowOf(new Date(2026, 9, 2, 23, 59))), "3-10-69");
  check("tomorrowOf: สิ้นเดือน 31 ต.ค. → 1-11-69", dayKey(c.tomorrowOf(t(2026, 10, 31))), "1-11-69");
  check("tomorrowOf: สิ้นปี 31 ธ.ค. 2026 → 1-1-70", dayKey(c.tomorrowOf(t(2026, 12, 31))), "1-1-70");
  const tm = t(2026, 10, 3); // พรุ่งนี้ = 3 ต.ค. 2026 (3-10-69)
  const pick = (counts, n = 4, from = tm) => dayKey(c.pickPostingDay(counts, from, n));
  check("pick: ยังไม่มีโฟลเดอร์เลย → พรุ่งนี้", pick({}), "3-10-69");
  check("pick: พรุ่งนี้มี 3 จาก 4 → ยังพรุ่งนี้", pick({ "3-10-69": 3 }), "3-10-69");
  check("pick: พรุ่งนี้เต็ม 4 → มะรืน", pick({ "3-10-69": 4 }), "4-10-69");
  check("pick: เต็มเกิน (ผู้ใช้ทำเองเพิ่ม 6) ก็ข้าม", pick({ "3-10-69": 6 }), "4-10-69");
  check("pick: พรุ่งนี้เต็ม มะรืนมี 2 → มะรืน", pick({ "3-10-69": 4, "4-10-69": 2 }), "4-10-69");
  check("pick: เต็มสองวันติด → วันที่สาม", pick({ "3-10-69": 4, "4-10-69": 4 }), "5-10-69");
  check("pick: วันถัดไปไกลๆ มีที่ว่างแต่ใกล้กว่าเต็ม → เอาวันที่ใกล้สุดที่ว่าง", pick({ "3-10-69": 4, "4-10-69": 4, "5-10-69": 4, "7-10-69": 0 }), "6-10-69");
  check("pick: วันที่ผ่านไปแล้วไม่นับ (ว่างก็ไม่เลือก)", pick({ "1-10-69": 0, "2-10-69": 1 }), "3-10-69");
  check("pick: วันที่ผ่านไปแล้วเต็มก็ไม่กระทบ", pick({ "2-10-69": 9 }), "3-10-69");
  check("pick: ข้ามเดือน — 31 ต.ค. เต็ม → 1 พ.ย.", pick({ "31-10-69": 4 }, 4, t(2026, 10, 31)), "1-11-69");
  check("pick: ข้ามปี — 31 ธ.ค. เต็ม → 1-1-70", pick({ "31-12-69": 4 }, 4, t(2026, 12, 31)), "1-1-70");
  check("pick: N=1 วันละคลิป", pick({ "3-10-69": 1, "4-10-69": 1 }, 1), "5-10-69");
  check("pick: N=20", pick({ "3-10-69": 19 }, 20), "3-10-69");
  check("pick: คืน Date ท้องถิ่นเที่ยงคืน (ไม่เลื่อนตาม timezone)", c.pickPostingDay({ "3-10-69": 4 }, tm, 4).getHours(), 0);

  check("quota: ค่าเริ่มต้น 4", c.DEFAULT_POSTS_PER_DAY, 4);
  check("quota: 6 → 6", c.normalizePostsPerDay(6), 6);
  checkJ("quota: ขอบ 1 และ 20", [c.normalizePostsPerDay(1), c.normalizePostsPerDay(20)], [1, 20]);
  checkJ("quota: 0 / 21 / ติดลบ → ค่าเริ่มต้น", [0, 21, -3].map((v) => c.normalizePostsPerDay(v)), [4, 4, 4]);
  checkJ("quota: ทศนิยม / NaN / ข้อความ / null / undefined → ค่าเริ่มต้น", [2.5, NaN, "abc", null, undefined, {}].map((v) => c.normalizePostsPerDay(v)), [4, 4, 4, 4, 4, 4]);
  check("quota: ข้อความตัวเลข \"7\" → 7", c.normalizePostsPerDay("7"), 7);

  check("post: มี product ID → บรรทัด Product ID ท้ายข้อความ", c.buildPostText({ productName: "A", caption: "B", hashtags: "#c", productId: "1729" }), "A\n\nB\n\n#c\n\nProduct ID: 1729");
  checkJ("post: ไม่มี product ID (null/ว่าง/ไม่ส่ง) → ไม่มีบรรทัด", [c.buildPostText({ productName: "A", caption: "", hashtags: "", productId: null }), c.buildPostText({ productName: "A", caption: "", hashtags: "", productId: "  " }), c.buildPostText({ productName: "A", caption: "", hashtags: "" })], ["A", "A", "A"]);
  check("copy: แคปชัน บรรทัดว่าง แฮชแท็ก (ไม่มีชื่อสินค้า/Product ID)", c.buildCaptionHashtagsText({ caption: "B", hashtags: "#c #d" }), "B\n\n#c #d");
  check("copy: ข้ามส่วนที่ว่าง + ตัดช่องว่างหัวท้าย", [c.buildCaptionHashtagsText({ caption: "  B  ", hashtags: " " }), c.buildCaptionHashtagsText({ caption: "", hashtags: "#c" }), c.buildCaptionHashtagsText({ caption: "", hashtags: "" })].join("|"), "B|#c|");
  check("copy: แคปชันหลายบรรทัดคงบรรทัดภายในไว้", c.buildCaptionHashtagsText({ caption: "บรรทัด 1\nบรรทัด 2", hashtags: "#c" }), "บรรทัด 1\nบรรทัด 2\n\n#c");
  check("post: product ID ถูกตัดช่องว่าง", c.buildPostText({ productName: "", caption: "", hashtags: "", productId: " 99 " }), "Product ID: 99");
  checkJ("รูปต้นทาง: ชื่อไฟล์ตามนามสกุลเดิม", [c.sourcePhotoName(".png"), c.sourcePhotoName(".jpg")], ["รูปต้นทาง.png", "รูปต้นทาง.jpg"]);
  check("exportAction: งานไม่มีคลิป (ส่ง video ว่าง) — แถวเดิม video=null → update เสมอ", c.exportAction({ path: "C:/TTS/1_a", video: null }, true, ""), "update");
  check("exportAction: งานไม่มีคลิป — โฟลเดอร์ถูกลบ → new", c.exportAction({ path: "C:/TTS/1_a", video: null }, false, ""), "new");
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
