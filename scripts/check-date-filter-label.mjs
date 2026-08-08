/**
 * ตรวจ lib/date-filter-label.ts (ฟังก์ชันบริสุทธิ์ล้วน ไม่ import อะไรเลย) ด้วย 27 test case
 * ที่ยืนยันมาแล้วตอนพัฒนา (docs/superpowers/plans/2026-08-08-list-page-rework.md Task 1 Step 2)
 * — คอมมิตไว้เป็นสคริปต์ถาวรแทนที่จะอยู่แค่ในเอกสารแผน เพราะโค้ดฐานนี้เคยพลาดบั๊กคลาส
 * UTC-vs-local ในจุดนี้มาแล้ว (ดู CLAUDE.md หัวข้อ toDateInputValue/toLocalDateInputValue)
 *
 * ไฟล์เป็น .ts แต่โปรเจกต์ไม่มี tsx/ts-node ติดตั้ง จึงคอมไพล์เดี่ยวไปยัง temp dir ด้วย
 * `npx tsc` ก่อนแล้ว dynamic import ผลลัพธ์ที่ compile ได้ (ไฟล์นี้ไม่ import อะไรเลย
 * จึงคอมไพล์เดี่ยวได้โดยไม่ต้องพึ่ง path alias หรือไฟล์อื่นในโปรเจกต์)
 *
 * รัน: node scripts/check-date-filter-label.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const sourceFile = join(repoRoot, "lib", "date-filter-label.ts");

const outDir = mkdtempSync(join(tmpdir(), "check-date-filter-label-"));

try {
  const tscBin = join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc"
  );
  execFileSync(
    tscBin,
    [sourceFile, "--outDir", outDir, "--module", "commonjs", "--target", "ES2017"],
    { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" }
  );

  const {
    toDateKey,
    fromDateKey,
    todayKey,
    daysAgoKey,
    matchQuickRange,
    formatDateFilterLabel,
  } = await import(pathToFileURL(join(outDir, "date-filter-label.js")).href);

  let failed = 0;
  function check(name, actual, expected) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${name}\n      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`
    );
  }

  // เวลาอ้างอิง: 8 ส.ค. 2026 เวลา 14:00 ตามเวลาท้องถิ่น
  const NOON = new Date(2026, 7, 8, 14, 0, 0);
  // เวลาตี 1 ครึ่ง — ถ้าเผลอใช้ UTC getter จะได้วันที่ 7 ส.ค. แทน 8 ส.ค. (บั๊กที่เคยเกิดจริง)
  const EARLY = new Date(2026, 7, 8, 1, 30, 0);

  check("toDateKey เติมศูนย์หน้าเลขเดือน/วัน", toDateKey(new Date(2026, 0, 5)), "2026-01-05");
  check("fromDateKey คืน Date ท้องถิ่น", toDateKey(fromDateKey("2026-08-05")), "2026-08-05");
  check("fromDateKey สตริงว่างคืน undefined", fromDateKey(""), undefined);
  check("fromDateKey สตริงพังคืน undefined", fromDateKey("ไม่ใช่วันที่"), undefined);

  check("todayKey ตอนบ่าย", todayKey(NOON), "2026-08-08");
  check("todayKey ตอนตี 1 ครึ่ง ต้องยังเป็นวันเดียวกัน", todayKey(EARLY), "2026-08-08");
  check("daysAgoKey 0 วัน = วันนี้", daysAgoKey(0, NOON), "2026-08-08");
  check("daysAgoKey 6 วัน", daysAgoKey(6, NOON), "2026-08-02");
  check("daysAgoKey 29 วัน ข้ามเดือน", daysAgoKey(29, NOON), "2026-07-10");
  check("daysAgoKey ตอนตี 1 ครึ่งต้องไม่เลื่อน", daysAgoKey(6, EARLY), "2026-08-02");

  check("matchQuickRange ไม่มีค่า = all", matchQuickRange(null, null, NOON), "all");
  check("matchQuickRange วันนี้", matchQuickRange("2026-08-08", "2026-08-08", NOON), "today");
  check("matchQuickRange 7 วัน", matchQuickRange("2026-08-02", "2026-08-08", NOON), "7d");
  check("matchQuickRange 30 วัน", matchQuickRange("2026-07-10", "2026-08-08", NOON), "30d");
  check("matchQuickRange ช่วงเอง", matchQuickRange("2026-08-01", "2026-08-05", NOON), "custom");
  check(
    "matchQuickRange ถึงวันนี้แต่ต้นทางไม่ตรงปุ่มไหน",
    matchQuickRange("2026-08-04", "2026-08-08", NOON),
    "custom"
  );
  check("matchQuickRange มีแค่ from", matchQuickRange("2026-08-01", null, NOON), "custom");
  check("matchQuickRange มีแค่ to", matchQuickRange(null, "2026-08-05", NOON), "custom");

  check("label ไม่ได้กรอง", formatDateFilterLabel(null, null, NOON), "วันที่");
  check("label วันนี้", formatDateFilterLabel("2026-08-08", "2026-08-08", NOON), "วันนี้");
  check("label 7 วัน", formatDateFilterLabel("2026-08-02", "2026-08-08", NOON), "7 วันล่าสุด");
  check("label 30 วัน", formatDateFilterLabel("2026-07-10", "2026-08-08", NOON), "30 วันล่าสุด");
  check(
    "label ช่วงเองสองด้าน",
    formatDateFilterLabel("2026-08-05", "2026-08-20", NOON),
    "5 ส.ค. - 20 ส.ค."
  );
  check("label เฉพาะ from", formatDateFilterLabel("2026-08-05", null, NOON), "ตั้งแต่ 5 ส.ค.");
  check("label เฉพาะ to", formatDateFilterLabel(null, "2026-08-20", NOON), "ถึง 20 ส.ค.");
  check(
    "label ตอนตี 1 ครึ่งยังจับ 7 วันได้",
    formatDateFilterLabel("2026-08-02", "2026-08-08", EARLY),
    "7 วันล่าสุด"
  );

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
