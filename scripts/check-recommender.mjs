/**
 * ตรวจตรรกะของแผง "งานรอบนี้" — ทำหน้าที่แทน test suite ที่โปรเจกต์นี้ไม่มี
 *
 * คอมไพล์ไฟล์ .ts ที่เกี่ยวข้องไปยัง temp dir แล้ว import ผลลัพธ์เข้ามาทดสอบ
 * ใช้ fixture สังเคราะห์ ไม่พึ่ง dev.db เพื่อให้ผลคงที่ไม่เปลี่ยนตามข้อมูลจริง
 *
 * รัน: node scripts/check-recommender.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(tmpdir(), "check-recommender-"));
let failed = 0;

function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}

function checkClose(name, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${actual} ควรได้ ~${expected} (คลาดได้ ${tolerance})`);
}

try {
  execFileSync(
    "npx",
    ["tsc", "lib/stats.ts", "lib/import-schedule.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
    { stdio: "inherit", shell: true }
  );

  const stats = await import(pathToFileURL(join(out, "stats.js")).href);
  const schedule = await import(pathToFileURL(join(out, "import-schedule.js")).href);

  console.log("=== wilsonLowerBound / wilsonUpperBound ===");
  check("ไม่มีข้อมูลเลย (trials=0) คืน 0", stats.wilsonLowerBound(0, 0), 0);
  check("trials ติดลบ คืน 0", stats.wilsonLowerBound(3, -5), 0);
  check("สำเร็จ 0 ครั้ง ขอบล่างต้องเป็น 0", stats.wilsonLowerBound(0, 100), 0);
  checkClose("สำเร็จทุกครั้ง (10/10) ขอบล่างสูงแต่ไม่ถึง 1", stats.wilsonLowerBound(10, 10), 0.7225, 0.01);
  check("สำเร็จทุกครั้ง ขอบบนต้องเป็น 1", stats.wilsonUpperBound(10, 10), 1);
  checkClose("50/100 ขอบล่าง", stats.wilsonLowerBound(50, 100), 0.4038, 0.01);
  checkClose("50/100 ขอบบน", stats.wilsonUpperBound(50, 100), 0.5962, 0.01);
  check("ขอบล่างต้องไม่เกินขอบบนเสมอ", stats.wilsonLowerBound(3, 1000) <= stats.wilsonUpperBound(3, 1000), true);
  check("successes เกิน trials ถูกตัดให้เท่า trials", stats.wilsonUpperBound(20, 10), 1);
  // n น้อยต้องได้ช่วงกว้างกว่า n มาก ที่สัดส่วนเท่ากัน — นี่คือคุณสมบัติที่ทั้งฟีเจอร์พึ่งพา
  const narrowSpan = stats.wilsonUpperBound(100, 10000) - stats.wilsonLowerBound(100, 10000);
  const wideSpan = stats.wilsonUpperBound(3, 300) - stats.wilsonLowerBound(3, 300);
  check("n น้อยให้ช่วงกว้างกว่า n มาก ที่สัดส่วนเดียวกัน", wideSpan > narrowSpan, true);

  console.log("\n=== IMPORT_STALE_DAYS / nextImportDate / daysUntil ===");
  check("IMPORT_STALE_DAYS = 7", schedule.IMPORT_STALE_DAYS, 7);
  check("ยังไม่เคยนำเข้า คืน null", schedule.nextImportDate(null), null);

  const key = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  check("นำเข้า 3 ส.ค. 16:21 -> รอบหน้า 10 ส.ค.", key(schedule.nextImportDate(new Date(2026, 7, 3, 16, 21))), "2026-08-10");
  check("ข้ามเดือน: 28 ส.ค. -> 4 ก.ย.", key(schedule.nextImportDate(new Date(2026, 7, 28, 9, 0))), "2026-09-04");
  check("ข้ามปี: 28 ธ.ค. -> 4 ม.ค. ปีถัดไป", key(schedule.nextImportDate(new Date(2026, 11, 28, 9, 0))), "2027-01-04");
  // เวลาไทยตี 1 ครึ่ง — ถ้าเผลอใช้ UTC getter จะได้วันก่อนหน้า
  check("นำเข้าตี 1 ครึ่งของวันที่ 3 ยังนับเป็นวันที่ 3", key(schedule.nextImportDate(new Date(2026, 7, 3, 1, 30))), "2026-08-10");

  const NOW = new Date(2026, 7, 8, 14, 0);
  check("อีก 2 วัน", schedule.daysUntil(new Date(2026, 7, 10), NOW), 2);
  check("วันนี้ = 0", schedule.daysUntil(new Date(2026, 7, 8), NOW), 0);
  check("เลยมาแล้ว 3 วัน = -3", schedule.daysUntil(new Date(2026, 7, 5), NOW), -3);
  check("เทียบที่ระดับวัน ไม่ใช่ชั่วโมง", schedule.daysUntil(new Date(2026, 7, 9, 1, 0), NOW), 1);
  check("ตอนตี 1 ครึ่งของวันนี้ ยังได้ 0 สำหรับวันนี้", schedule.daysUntil(new Date(2026, 7, 8), new Date(2026, 7, 8, 1, 30)), 0);

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
