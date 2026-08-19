/**
 * ตรวจตรรกะของ lib/candidates.ts — ทำหน้าที่แทน test suite ที่โปรเจกต์นี้ไม่มี
 *
 * คอมไพล์ .ts ไปยัง temp dir ใต้ project root แล้ว import เข้ามาทดสอบ
 * (ต้องอยู่ใต้ project root เพราะ Node resolve bare specifier จากตำแหน่งไฟล์)
 *
 * รัน: node scripts/check-candidates.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-candidates-tmp-"));
let failed = 0;

function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)} ควรได้ ${JSON.stringify(expected)}`);
}

function checkDeep(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${JSON.stringify(actual)}\n      ควรได้ ${JSON.stringify(expected)}`);
}

try {
  execFileSync(
    "npx",
    ["tsc", "lib/candidates.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
    { stdio: "inherit", shell: true }
  );
  const c = await import(pathToFileURL(join(out, "candidates.js")).href);

  // --- parseThaiNumber ---
  check("13.9K -> 13900", c.parseThaiNumber("13.9K"), 13900);
  check("1.4K -> 1400", c.parseThaiNumber("1.4K"), 1400);
  check("816 -> 816", c.parseThaiNumber("816"), 816);
  check("฿29.90 -> 29.9", c.parseThaiNumber("฿29.90"), 29.9);
  check("฿0.96 ไม่ปัดทศนิยมทิ้ง", c.parseThaiNumber("฿0.96"), 0.96);
  check("ช่วงราคา ฿17.52 – 21.90 -> ใช้ค่าต่ำสุด", c.parseThaiNumber("฿17.52 – 21.90"), 17.52);
  check("ช่วงราคาขีดสั้น 17.52 - 21.90 -> ใช้ค่าต่ำสุด", c.parseThaiNumber("17.52 - 21.90"), 17.52);
  check("มีคอมมา 1,250 -> 1250", c.parseThaiNumber("1,250"), 1250);
  check("ขีดกลาง - (ไม่มีข้อมูล) -> null", c.parseThaiNumber("-"), null);
  check("ข้อความว่าง -> null", c.parseThaiNumber("   "), null);
  check("อ่านไม่ออก -> null", c.parseThaiNumber("รีวิวเชิงบวก"), null);

  // --- normalizeName ---
  check(
    "ช่องว่างซ้ำ + ตัวพิมพ์ต่างกัน ได้ key เดียวกัน",
    c.normalizeName("  HEINO  กว้าง40CM  "),
    c.normalizeName("heino กว้าง40cm")
  );
  check("ตัดช่องว่างหัวท้าย", c.normalizeName(" ก ข "), "ก ข");

  // --- detectFlags ---
  checkDeep("ชื่อมี 'พับได้' ติดธงกลไก", c.detectFlags("ตู้เก็บของพับได้ 49CM"), ["mechanism"]);
  checkDeep("ชื่อมี 'หมุน 360' ติดธงกลไก", c.detectFlags("ชั้นวางเครื่องสำอางหมุนได้ 360 องศา"), ["mechanism"]);
  checkDeep("ชื่อมี 'อาหาร' ติดธงข้อความเยอะ", c.detectFlags("อาหารแมวเกรดพรีเมียม"), ["heavyText"]);
  checkDeep("ชื่อปกติไม่ติดธง", c.detectFlags("ชั้นวางของติดผนัง ไม่ต้องเจาะ"), []);
  checkDeep(
    "ติดได้พร้อมกัน 2 ธง",
    c.detectFlags("ที่ให้อาหารแมวอัตโนมัติ"),
    ["mechanism", "heavyText"]
  );

  // --- parseCandidateRows ---
  const sample = [
    "หมวด: ที่เก็บของและชั้นวาง",
    "HEINO กว้าง40CM 5ชั้น ตู้เก็บของพับได้ | 249.00 | 29.90 | 13.9K",
    "ชั้นวางของพร้อมที่ดูดติดผนัง ไม่ต้องเจาะรู | 67.50 | 12.15 | 3.3K",
    "บรรทัดพังไม่มีขีดคั่น",
    "สินค้าไม่มียอดขาย | 55.00 | 2.30 | -",
  ].join("\n");
  const parsed = c.parseCandidateRows(sample);
  check("อ่านได้ 3 แถว (ข้ามบรรทัดพัง)", parsed.rows.length, 3);
  check("นับบรรทัดที่ข้ามได้ถูก", parsed.skipped, 1);
  check("แถวแรกได้ชื่อเต็มไม่ย่อ", parsed.rows[0].name, "HEINO กว้าง40CM 5ชั้น ตู้เก็บของพับได้");
  check("แถวแรกได้ราคา", parsed.rows[0].price, 249);
  check("แถวแรกได้ค่าคอม", parsed.rows[0].commission, 29.9);
  check("แถวแรกได้ยอดขายแปลง K แล้ว", parsed.rows[0].weeklySales, 13900);
  check("ทุกแถวได้หมวดจากหัวข้อ", parsed.rows[2].categoryLabel, "ที่เก็บของและชั้นวาง");
  check("แถวไม่มียอดขาย -> weeklySales เป็น null", parsed.rows[2].weeklySales, null);

  const noHeader = c.parseCandidateRows("สินค้าเดี่ยว | 10.00 | 1.00 | 500");
  check("ไม่มีหัวข้อหมวด -> categoryLabel ว่าง ไม่ throw", noHeader.rows[0].categoryLabel, "");
  check("ไม่มีหัวข้อหมวด ยังอ่านแถวได้", noHeader.rows.length, 1);

  const badNumbers = c.parseCandidateRows("หมวด: ก\nสินค้า | อ่านไม่ออก | 1.00 | 500");
  check("ราคาอ่านไม่ออก -> ข้ามทั้งแถว", badNumbers.rows.length, 0);
  check("ราคาอ่านไม่ออก -> นับเป็น skipped", badNumbers.skipped, 1);

  // เคสจริงที่เจอตอนทดสอบครั้งแรก (2026-08-18): AI ตอบป้ายกำกับติดตัวเลขมาด้วย
  // ("รับ ฿2.95", "ขายได้ 3.3K ชิ้นในสัปดาห์ที่ผ่านมา") ทั้งที่พรอมต์สั่งห้าม —
  // ทุกแถวใน 8 ภาพจริงมีรูปแบบนี้หมด ทำให้ parseThaiNumber อ่าน "รับ2.95" ไม่ออก
  // แล้วข้ามทั้งแถว (skipped 40 จาก 40) ต้องรอดแม้พรอมต์จะสั่งห้ามไม่สำเร็จ
  const withLabels = c.parseCandidateRows(
    "หมวด: แผ่นและเสาลับเล็บแมว\n" +
      "yoyopet : ที่ลับเล็บแมว+แคทนิป | ฿44.25 | รับ ฿2.95 | ขายได้ 3.3K ชิ้นในสัปดาห์ที่ผ่านมา"
  );
  check("แถวมีป้ายกำกับติดมา -> ยังอ่านได้ ไม่ถูกข้าม", withLabels.rows.length, 1);
  check("ค่าคอมตัดคำว่า 'รับ' ออกแล้ว", withLabels.rows[0]?.commission, 2.95);
  check("ยอดขายตัดคำว่า 'ขายได้'/'ชิ้นในสัปดาห์ที่ผ่านมา' ออกแล้ว", withLabels.rows[0]?.weeklySales, 3300);

  // --- categorize ---
  check(
    "'เหมาะสำหรับ...' ไม่ใช่ 'หมา' -> ไม่เข้าสัตว์เลี้ยง",
    c.categorize("เสื้อกันฝนเหมาะสำหรับใส่ทำงาน"),
    null
  );
  check(
    "ชั้นวางของ...สำหรับครัว -> จัดระเบียบบ้าน ไม่ใช่เครื่องครัว",
    c.categorize("ชั้นวางของ 5 ชั้น สำหรับครัว"),
    "จัดระเบียบบ้าน"
  );
  check("อาหารหมา -> ยังเข้าสัตว์เลี้ยง (lookbehind ไม่กันของจริง)", c.categorize("อาหารหมา"), "สัตว์เลี้ยง");
  check("หม้อทอดไร้น้ำมัน -> เครื่องครัว", c.categorize("หม้อทอดไร้น้ำมัน"), "เครื่องครัว");

  // --- pickCandidateBadges ---
  const badgeRows = [
    { id: "a", status: "new", commission: 50, commissionPercent: 5.0, weeklySales: 1000 }, // %ต่ำกว่าเกณฑ์ -> ไม่ติดป้ายแม้ค่าคอมบาทสูงสุด
    { id: "b", status: "new", commission: 40, commissionPercent: 12.0, weeklySales: 900 }, // ยอดขายสูงสุด + บาทสูงสุด -> ติด 2 ป้าย
    { id: "c", status: "new", commission: 5, commissionPercent: 8.0, weeklySales: 800 }, // ยอดขายอันดับ 2 -> ติดป้ายยอดขายดี
    { id: "d", status: "new", commission: 24, commissionPercent: 10.0, weeklySales: 100 }, // บาทอันดับ 2 -> ติดป้ายค่าคอมสูงสุด
    { id: "e", status: "rejected", commission: 99, commissionPercent: 20.0, weeklySales: 5000 }, // ปัดตกแล้ว -> ไม่ติดป้ายแม้ตัวเลขดีสุด
    { id: "f", status: "new", commission: 3, commissionPercent: 7.0, weeklySales: null }, // ไม่มียอดขาย -> ชิงป้ายยอดขายดีไม่ได้
  ];
  const badges = c.pickCandidateBadges(badgeRows, 6.0, 50);
  checkDeep("แถว b ติดทั้ง 2 ป้าย (ยอดขายสูงสุด + ค่าคอมบาทสูงสุด)", badges.get("b"), ["topSeller", "topCommission"]);
  checkDeep("แถว c ติดป้ายยอดขายดี (อันดับ 2)", badges.get("c"), ["topSeller"]);
  checkDeep("แถว d ติดป้ายค่าคอมสูงสุด (บาทอันดับ 2)", badges.get("d"), ["topCommission"]);
  check("แถว a %ต่ำกว่าเกณฑ์ -> ไม่ติดป้ายเลยแม้ค่าคอมบาทสูงสุดในชุด", badges.has("a"), false);
  check("แถว e ปัดตกแล้ว -> ไม่ติดป้ายแม้ตัวเลขดีที่สุด", badges.has("e"), false);
  check("แถว f ไม่มียอดขาย -> ไม่ติดป้ายยอดขายดี", badges.has("f"), false);

  // เคสจริงที่เคยเลือกผิดตอนใช้ % จัดอันดับ (2026-08-18): สินค้าถูกที่ %สูงลิ่วแต่เงินจริงน้อย
  // ต้องแพ้สินค้าแพงที่ %ต่ำกว่าแต่เงินจริงมากกว่า 10 เท่า — % เป็นอัตราส่วน ไม่ใช่เงินที่ได้
  const bahtVsPercent = c.pickCandidateBadges(
    [
      { id: "cheap", status: "new", commission: 3.64, commissionPercent: 16.2, weeklySales: 117 },
      { id: "pricey", status: "new", commission: 38.72, commissionPercent: 8.9, weeklySales: 62 },
      { id: "mid", status: "new", commission: 24.1, commissionPercent: 12.6, weeklySales: 103 },
    ],
    6.9,
    582
  );
  checkDeep("ของแพงค่าคอมบาทสูง ติดป้ายค่าคอมสูงสุด", bahtVsPercent.get("pricey"), ["topCommission"]);
  check(
    "ของถูก %สูงลิ่วแต่เงินจริงน้อย ไม่ติดป้ายค่าคอมสูงสุด",
    (bahtVsPercent.get("cheap") ?? []).includes("topCommission"),
    false
  );

  const noBenchmark = c.pickCandidateBadges(badgeRows, 6.0, 0);
  check("benchmarkOrderCount เป็น 0 -> ไม่ติดป้ายใครเลย", noBenchmark.size, 0);

  // เคสจริงที่เจอ (2026-08-19): ราคา ฿0.01 (โปรโมชั่น/อ่านผิด) ทำให้ %ค่าคอมพุ่งไป 6900%
  // แล้วชนะป้ายยอดขายดีทั้งที่เป็นข้อมูลขยะ — isCommissionPercentPlausible ต้องกันไว้
  check("%ค่าคอม 6900% ไม่น่าเชื่อถือ", c.isCommissionPercentPlausible(6900), false);
  check("%ค่าคอม 100% ยังน่าเชื่อถือ (ขอบเขต)", c.isCommissionPercentPlausible(100), true);
  check("%ค่าคอม 12.6% น่าเชื่อถือปกติ", c.isCommissionPercentPlausible(12.6), true);

  const junkPriceRows = [
    { id: "junk", status: "new", commission: 0.69, commissionPercent: 6900, weeklySales: 15300 },
    { id: "real", status: "new", commission: 12.99, commissionPercent: 12.4, weeklySales: 4600 },
  ];
  const junkBadges = c.pickCandidateBadges(junkPriceRows, 6.907, 582);
  check("ราคา 0.01 บาท (ป้ายขยะ) ไม่ติดป้ายยอดขายดี", junkBadges.has("junk"), false);
  check("สินค้าจริงที่ยอดขายรองลงมาได้ป้ายยอดขายดีแทน", junkBadges.get("real")?.includes("topSeller"), true);

  // --- คำนวณ ---
  checkClose3("%ค่าคอม 29.90/249", c.commissionPercent(249, 29.9), 12.0);
  checkClose3("%ค่าคอม 12.15/67.50", c.commissionPercent(67.5, 12.15), 18.0);
  check("ราคา 0 -> %ค่าคอมเป็น 0 ไม่ใช่ Infinity", c.commissionPercent(0, 5), 0);
  check("ดีมานด์รวม 29.90 x 13900", c.demandTotal(29.9, 13900), 415610);
  check("ไม่มียอดขาย -> ดีมานด์รวมเป็น null", c.demandTotal(29.9, null), null);

  console.log(failed === 0 ? "\nผ่านทุกเคส" : `\nตก ${failed} เคส`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

function checkClose3(name, actual, expected) {
  const ok = Math.abs(actual - expected) < 0.05;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${actual} ควรได้ ~${expected}`);
}

process.exit(failed === 0 ? 0 : 1);
