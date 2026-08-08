/**
 * ตรวจตรรกะของแผง "งานรอบนี้" — ทำหน้าที่แทน test suite ที่โปรเจกต์นี้ไม่มี
 *
 * คอมไพล์ไฟล์ .ts ที่เกี่ยวข้องไปยัง temp dir แล้ว import ผลลัพธ์เข้ามาทดสอบ
 * ใช้ fixture สังเคราะห์ ไม่พึ่ง dev.db เพื่อให้ผลคงที่ไม่เปลี่ยนตามข้อมูลจริง
 *
 * รัน: node scripts/check-recommender.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// วางไว้ใต้ project root (ไม่ใช่ os.tmpdir()) โดยตั้งใจ: lib/recommender.ts ลาก import ไปถึง
// lib/dashboard.ts -> lib/affiliate.ts -> "xlsx" — Node resolve bare specifier ด้วยการเดินขึ้น
// ไปหา node_modules จากตำแหน่งไฟล์ที่ import เท่านั้น ถ้า out อยู่ใน os.tmpdir() (คนละ drive/ทรี)
// จะไม่เจอ node_modules ของ repo เลย ตัว dir นี้ถูกลบทิ้งใน finally เสมอ ไม่หลงเหลือใน git status
const out = mkdtempSync(join(process.cwd(), ".check-recommender-tmp-"));
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

  // recommender.ts import จาก @/lib/dashboard ซึ่งลากไปถึง xlsx จึงคอมไพล์เดี่ยวไม่ได้
  // แก้ด้วยการคอมไพล์ทั้งสายแล้ว map @/ ตอน import ผ่าน loader ของ node ไม่ได้ใน .mjs
  // จึงทดสอบ detectTasks ผ่านการ re-implement เกณฑ์ไม่ได้เช่นกัน (จะกลายเป็นทดสอบตัวเอง)
  // -> ทดสอบด้วยการคอมไพล์ recommender.ts พร้อม dependency แล้วแก้ specifier ในไฟล์ผลลัพธ์
  //
  // หมายเหตุ: brief เดิมสั่งให้คอมไพล์แค่ lib/recommender.ts ไฟล์เดียว แต่ dashboard.js/affiliate.js
  // ที่มันอ้างถึงจะไม่ถูก emit ออกมาด้วย (stats.js/import-schedule.js ถูก emit ไปแล้วจากคำสั่ง tsc
  // ด้านบน) ต้องคอมไพล์ recommender.ts พร้อม dashboard.ts และ affiliate.ts ในคำสั่งเดียวกัน ให้ไฟล์
  // js ทั้งหมดลงไปอยู่ output dir เดียวกัน แล้ว rewrite specifier "@/lib/..." ในทุกไฟล์ที่มี
  // (ไม่ใช่แค่ recommender.js — dashboard.js เองก็ import "@/lib/affiliate" และ "@/lib/import-schedule")
  console.log("\n=== detectTasks ===");
  try {
    execFileSync(
      "npx",
      [
        "tsc",
        "lib/recommender.ts",
        "lib/dashboard.ts",
        "lib/affiliate.ts",
        "--outDir",
        out,
        "--module",
        "es2022",
        "--target",
        "ES2017",
        "--moduleResolution",
        "bundler",
        "--skipLibCheck",
      ],
      { stdio: "inherit", shell: true }
    );
  } catch (e) {
    // ไม่ได้ส่ง paths mapping ให้ tsc ตรงนี้ "@/lib/..." เลยหา module ไม่เจอ (TS2307) โดยตั้งใจ —
    // tsc ยัง emit .js ออกมาให้ตามปกติ (noEmitOnError เป็น false โดย default) แค่ exit code ไม่ใช่ 0
    // (สังเกตแล้วว่าเป็น 2 เสมอสำหรับ diagnostic ธรรมดา) ถ้า exit code อื่นแปลว่ามีปัญหาจริงให้ throw ต่อ
    if (e.status !== 2) throw e;
  }
  // ไฟล์ผลลัพธ์อ้าง "@/lib/..." ซึ่ง node ไม่รู้จัก — เขียนทับให้ชี้ไฟล์ข้างกันแทน
  for (const f of ["recommender.js", "dashboard.js"]) {
    const p = join(out, f);
    const src = readFileSync(p, "utf8").replace(/["']@\/lib\/([\w-]+)["']/g, '"./$1.js"');
    writeFileSync(p, src);
  }

  const rec = await import(pathToFileURL(join(out, "recommender.js")).href);

  /** สร้าง ClipStat แบบย่อ — ค่าที่ไม่ระบุใช้ค่าที่ไม่ทำให้ติดเกณฑ์ */
  const stat = (o) => ({
    entryId: o.entryId,
    productName: o.productName ?? o.entryId,
    views: o.views ?? 0,
    viewDelta: o.viewDelta ?? null,
    orders: o.orders ?? 0,
    badOrders: o.badOrders ?? 0,
    ordersLast7Days: o.ordersLast7Days ?? 0,
  });

  check("ไม่มีคลิปเลย คืนลิสต์ว่าง", rec.detectTasks([]).length, 0);
  check("มีคลิปแต่วิว 0 ทั้งหมด คืนลิสต์ว่าง", rec.detectTasks([stat({ entryId: "a", views: 0 })]).length, 0);

  // ฐาน: 3 คลิปธรรมดา วิว 1000 ออเดอร์ 2 -> channelConv ~0.2% medianViews 1000
  const base = [
    stat({ entryId: "b1", views: 1000, orders: 2 }),
    stat({ entryId: "b2", views: 1000, orders: 2 }),
    stat({ entryId: "b3", views: 1000, orders: 2 }),
  ];

  const growing = rec.detectTasks([...base, stat({ entryId: "g", views: 5000, viewDelta: 3000, orders: 4 })]);
  const gTask = growing.find((t) => t.entryId === "g");
  check("วิวโตเกินค่ากลาง ติดป้าย growing", gTask?.kinds.includes("growing"), true);

  const noDelta = rec.detectTasks([...base, stat({ entryId: "nd", views: 5000, viewDelta: null, orders: 4 })]);
  check("ไม่มี viewDelta (นำเข้ารอบเดียว) ไม่ติด growing", noDelta.find((t) => t.entryId === "nd")?.kinds.includes("growing") ?? false, false);

  // conv สูงมากแต่ n น้อย -> ช่วงกว้าง -> ต้องไม่ติด proven
  // หมายเหตุ: brief เดิมใช้ views:300 orders:3 แต่คำนวณจริงด้วย wilsonLowerBound (Task 1)
  // แล้วขอบล่างของคู่นี้ (~0.34%) สูงกว่า channelConv ของชุดข้อมูลนี้ (~0.27%) จริง คือ "พิสูจน์ได้"
  // ตามสถิติจริงแม้ n แค่ 300 (conv ต่างกันเกิน 3 เท่า) จึงไม่ใช่เคสทดสอบที่ตรงเจตนา "n น้อยต้องเงียบ"
  // เปลี่ยนเป็น views:100 orders:1 (ยืนยันด้วยการรันจริง: low ~0.177% < channelConv ~0.226%)
  const tiny = rec.detectTasks([...base, stat({ entryId: "tiny", views: 100, orders: 1 })]);
  check("conv สูงแต่ n น้อย ต้องเงียบ (ไม่ติด proven)", tiny.find((t) => t.entryId === "tiny")?.kinds.includes("proven") ?? false, false);

  // conv สูงและ n เยอะ -> ต้องติด proven
  // หมายเหตุ: brief เดิมใช้ views:20000 orders:120 แต่คำนวณจริงแล้ว pv (conv 0.6%) มีวิวมากพอที่จะ
  // ลาก channelConv ของชุดนี้ขึ้นไปใกล้ตัวเอง (~0.548%) จนขอบล่าง (~0.502%) ไม่พ้นค่าเฉลี่ยช่อง —
  // เปลี่ยนเป็น views:5000 orders:60 (conv 1.2%) ซึ่ง n ยังมากพอให้ช่วงแคบ และช่องว่างจาก
  // channelConv (~0.825%) กว้างพอให้ขอบล่าง (~0.933%) พ้นได้จริง (ยืนยันด้วยการรันจริงแล้ว)
  const proven = rec.detectTasks([...base, stat({ entryId: "pv", views: 5000, orders: 60 })]);
  const pTask = proven.find((t) => t.entryId === "pv");
  check("conv สูงและ n เยอะ ติดป้าย proven", pTask?.kinds.includes("proven"), true);
  check("proven มีช่วง convRatioRange", pTask?.convRatioRange !== null && pTask?.convRatioRange !== undefined, true);
  check("ขอบล่างของช่วงต้องเกิน 1 เท่า", (pTask?.convRatioRange?.low ?? 0) > 1, true);

  // ติดทั้งสองป้ายต้องมาก่อนตัวที่ติดป้ายเดียว
  const both = rec.detectTasks([
    ...base,
    stat({ entryId: "both", views: 20000, viewDelta: 5000, orders: 120 }),
    stat({ entryId: "onlyGrow", views: 9000, viewDelta: 8000, orders: 18 }),
  ]);
  check("คลิปที่ติดสองป้ายมาเป็นอันดับแรก", both[0]?.entryId, "both");
  check("คลิปที่ติดสองป้ายมี kinds ครบสอง", both[0]?.kinds.length, 2);

  // badRatio เกินเกณฑ์ต้องถูกตัดออกก่อนพิจารณาอะไรทั้งสิ้น
  const bad = rec.detectTasks([...base, stat({ entryId: "bad", views: 20000, viewDelta: 9000, orders: 120, badOrders: 60 })]);
  check("badRatio >= 0.3 ถูกตัดออก", bad.find((t) => t.entryId === "bad") === undefined, true);

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
