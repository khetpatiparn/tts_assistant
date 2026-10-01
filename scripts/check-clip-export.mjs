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
  check("short: ตัดที่ 30 ตัว", Array.from(c.shortFolderName("ก".repeat(50))).length, 30);
  check("short: ว่าง → clip", c.shortFolderName("   "), "clip");
  check("short: มีแต่อักขระต้องห้าม → clip", c.shortFolderName("???"), "clip");

  check("slotFolderName", c.slotFolderName(3, "กล่อง"), "3_กล่อง");
  check("post: ครบ 3 ส่วน", c.buildPostText({ productName: "A", caption: "B", hashtags: "#c" }), "A\n\nB\n\n#c");
  check("post: ข้ามส่วนว่าง", c.buildPostText({ productName: "A", caption: " ", hashtags: "#c" }), "A\n\n#c");
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
