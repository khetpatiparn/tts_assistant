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

  // --- pickCandidateBadges (TOP_BADGE_COUNT = 3, badge เก็บ rank ด้วย) ---
  // ไม่มีเกณฑ์ %ค่าคอมเทียบร้านอีกแล้ว (ถอดออก 2026-08-19) — จัดอันดับด้วยเงินจริงล้วนๆ
  // เหลือเกณฑ์กรองเดียว: %สมเหตุสมผล (≤100%, กันข้อมูลราคาอ่านผิด)
  // ไม่มี status ให้กรองแล้ว (ตัดระบบปัดตก/สนใจทิ้งทั้งหมด 2026-08-23)
  const B = "batch-1";
  const badgeRows = [
    { id: "junk", batchId: B, commission: 300, commissionPercent: 6901, weeklySales: 9000, categoryLabel: "หมวดทดสอบ" }, // %ไม่น่าเชื่อถือ (ราคาอ่านผิด) -> ไม่ติดป้ายแม้ตัวเลขดิบสูงสุดในชุด
    { id: "top", batchId: B, commission: 100, commissionPercent: 10.0, weeklySales: 1000, categoryLabel: "หมวดทดสอบ" }, // อันดับ 1 ทั้งยอดขายและค่าคอม -> ติด 2 ป้าย rank 1 พร้อมกัน
    { id: "s2", batchId: B, commission: 9, commissionPercent: 10.0, weeklySales: 900, categoryLabel: "หมวดทดสอบ" },
    { id: "s3", batchId: B, commission: 8, commissionPercent: 10.0, weeklySales: 800, categoryLabel: "หมวดทดสอบ" },
    { id: "s4", batchId: B, commission: 7, commissionPercent: 10.0, weeklySales: 700, categoryLabel: "หมวดทดสอบ" }, // อันดับ 4 ยอดขาย -> เกิน TOP_BADGE_COUNT=3 ไม่ติดป้าย
    // เคสจริง (2026-08-19, หมวดโซฟา): สินค้า %ต่ำมาก (2.3%) แต่ค่าคอมบาทสูง (Woodpanda ฿249.95/ชิ้น)
    // เคยถูกกรองทิ้งเพราะ %ต่ำกว่าเกณฑ์ร้าน ทั้งที่จ่ายเงินจริงมากกว่าตัวที่เคยติดป้าย
    { id: "lowpercent", batchId: B, commission: 95, commissionPercent: 2.3, weeklySales: 10, categoryLabel: "หมวดทดสอบ" },
    { id: "c3", batchId: B, commission: 80, commissionPercent: 10.0, weeklySales: 40, categoryLabel: "หมวดทดสอบ" }, // อันดับ 4 ค่าคอม -> เกิน TOP_BADGE_COUNT ไม่ติดป้าย
    { id: "f", batchId: B, commission: 85, commissionPercent: 10.0, weeklySales: null, categoryLabel: "หมวดทดสอบ" }, // ไม่มียอดขาย -> ชิงป้ายยอดขายดีไม่ได้ แต่ยังชิงป้ายค่าคอมสูงสุดได้ปกติ
  ];
  const badges = c.pickCandidateBadges(badgeRows);
  checkDeep(
    "แถว top อันดับ 1 ทั้งยอดขายและค่าคอม -> ติด 2 ป้าย rank 1 พร้อมกัน",
    badges.get("top"),
    [{ type: "topSeller", rank: 1 }, { type: "topCommission", rank: 1 }]
  );
  checkDeep("แถว s2 ยอดขายอันดับ 2 -> ติดป้ายยอดขายดี rank 2", badges.get("s2"), [{ type: "topSeller", rank: 2 }]);
  checkDeep("แถว s3 ยอดขายอันดับ 3 -> ติดป้ายยอดขายดี rank 3", badges.get("s3"), [{ type: "topSeller", rank: 3 }]);
  check("แถว s4 ยอดขายอันดับ 4 -> เกิน TOP_BADGE_COUNT=3 ไม่ติดป้าย", badges.has("s4"), false);
  checkDeep(
    "แถว lowpercent %ต่ำมาก (2.3%) แต่ค่าคอมบาทอันดับ 2 -> ยังติดป้ายค่าคอมสูงสุดได้ (เคส Woodpanda)",
    badges.get("lowpercent"),
    [{ type: "topCommission", rank: 2 }]
  );
  checkDeep(
    "แถว f ไม่มียอดขายแต่ค่าคอมอันดับ 3 -> ยังติดป้ายค่าคอมสูงสุดได้ (ไม่ติดยอดขายดี)",
    badges.get("f"),
    [{ type: "topCommission", rank: 3 }]
  );
  check("แถว c3 ค่าคอมอันดับ 4 -> เกิน TOP_BADGE_COUNT ไม่ติดป้าย", badges.has("c3"), false);
  check("แถว junk %ไม่น่าเชื่อถือ -> ไม่ติดป้ายเลยแม้ตัวเลขดิบสูงสุดในชุด", badges.has("junk"), false);

  // จัดอันดับด้วยเงินบาทจริงล้วนๆ — ของถูก %สูงลิ่วแต่เงินจริงน้อย (๓.๖๔ บาท) ยังคงแพ้ของแพง
  // %ต่ำกว่าแต่เงินจริงเยอะกว่า (๓๘.๗๒ บาท) ตามธรรมชาติของการจัดอันดับเอง ไม่ต้องมีเกณฑ์ %ช่วย
  const bahtVsPercent = c.pickCandidateBadges([
    { id: "cheap", batchId: B, commission: 3.64, commissionPercent: 16.2, weeklySales: null, categoryLabel: "หมวดทดสอบ" },
    { id: "pricey", batchId: B, commission: 38.72, commissionPercent: 8.9, weeklySales: null, categoryLabel: "หมวดทดสอบ" },
    { id: "mid", batchId: B, commission: 24.1, commissionPercent: 12.6, weeklySales: null, categoryLabel: "หมวดทดสอบ" },
    { id: "filler1", batchId: B, commission: 20, commissionPercent: 10.0, weeklySales: null, categoryLabel: "หมวดทดสอบ" },
  ]);
  checkDeep("ของแพงค่าคอมบาทสูง ติดป้ายค่าคอมสูงสุด rank 1", bahtVsPercent.get("pricey"), [{ type: "topCommission", rank: 1 }]);
  check(
    "ของถูก %สูงลิ่วแต่เงินจริงน้อย หลุดอันดับ 4 ตามธรรมชาติ -> ไม่ติดป้าย (ไม่ต้องพึ่งเกณฑ์ %)",
    bahtVsPercent.has("cheap"),
    false
  );

  // เคสจริง (2026-08-19): ราคา ฿0.01 (โปรโมชั่น/อ่านผิด) ทำให้ %ค่าคอมพุ่งไป 6900%
  check("%ค่าคอม 6900% ไม่น่าเชื่อถือ", c.isCommissionPercentPlausible(6900), false);
  check("%ค่าคอม 100% ยังน่าเชื่อถือ (ขอบเขต)", c.isCommissionPercentPlausible(100), true);
  check("%ค่าคอม 12.6% น่าเชื่อถือปกติ", c.isCommissionPercentPlausible(12.6), true);

  // อัปโหลด 2 ประเภทสินค้าในชุดเดียว (การ์ดจัดอันดับคนละใบ คนละสเกลตัวเลข) ต้องได้ป้ายแยกกัน
  // ประเภทละชุด ไม่ใช่รวมเป็นกองเดียวแล้วประเภทที่ตัวเลขเล็กกว่า (เฟอร์นิเจอร์) แพ้ประเภทที่
  // ตัวเลขใหญ่กว่าโดยธรรมชาติ (ของสิ้นเปลือง) ไปทั้งหมด
  const twoCategoryBadges = c.pickCandidateBadges([
    { id: "furniture-a", batchId: B, commission: 24.1, commissionPercent: 12.6, weeklySales: 103, categoryLabel: "เฟอร์นิเจอร์" },
    { id: "furniture-b", batchId: B, commission: 38.72, commissionPercent: 8.9, weeklySales: 62, categoryLabel: "เฟอร์นิเจอร์" },
    { id: "consumable-a", batchId: B, commission: 6.88, commissionPercent: 7.7, weeklySales: 5700, categoryLabel: "ของสิ้นเปลือง" },
    { id: "consumable-b", batchId: B, commission: 12.06, commissionPercent: 9.0, weeklySales: 4900, categoryLabel: "ของสิ้นเปลือง" },
  ]);
  check("2 ประเภทในชุดเดียว -> ติดป้ายรวม 4 รายการ (ไม่ใช่แค่ 2)", twoCategoryBadges.size, 4);
  // เช็ก rank เป๊ะๆ ไม่ใช่แค่ has() -- has() อย่างเดียวพิสูจน์แค่ว่าแยก batch ได้ ไม่พิสูจน์ว่า
  // แยกหมวดได้จริง (ถ้า group key ดันเหลือแค่ batchId เฉยๆ ทั้ง 4 แถวจะรวมกองเดียว แต่ union
  // ของป้ายที่ได้บังเอิญยังครบ 4 ชื่อเหมือนเดิม has() เลยตรวจไม่เจอ) เฟอร์นิเจอร์มีแค่ 2 แถว
  // จึงติดทั้ง topSeller และ topCommission ครบทั้งคู่ (rank 1-2) ถ้าเผลอไปแย่งอันดับกับของ
  // สิ้นเปลืองซึ่งยอดขาย/ค่าคอมสูงกว่ามาก furniture-a จะหล่นจาก topSeller rank 1 ไปอยู่ rank 3
  checkDeep(
    "furniture-a ในหมวดตัวเอง -> ขายดี rank 1 (103>62) และค่าคอม rank 2 (24.1<38.72)",
    twoCategoryBadges.get("furniture-a"),
    [{ type: "topSeller", rank: 1 }, { type: "topCommission", rank: 2 }]
  );
  checkDeep(
    "furniture-b ในหมวดตัวเอง -> ขายดี rank 2 และค่าคอม rank 1 (38.72 สูงสุดในหมวด)",
    twoCategoryBadges.get("furniture-b"),
    [{ type: "topSeller", rank: 2 }, { type: "topCommission", rank: 1 }]
  );
  checkDeep(
    "consumable-a ในหมวดตัวเอง -> ขายดี rank 1 (5700>4900) และค่าคอม rank 2 (6.88<12.06)",
    twoCategoryBadges.get("consumable-a"),
    [{ type: "topSeller", rank: 1 }, { type: "topCommission", rank: 2 }]
  );
  checkDeep(
    "consumable-b ในหมวดตัวเอง -> ขายดี rank 2 และค่าคอม rank 1 (12.06 สูงสุดในหมวด)",
    twoCategoryBadges.get("consumable-b"),
    [{ type: "topSeller", rank: 2 }, { type: "topCommission", rank: 1 }]
  );

  // หัวใจของฟีเจอร์ชุด (2026-08-23): หมวดเดียวกันแต่คนละชุด ต้องคิดอันดับแยกขาดจากกัน
  // ไม่ใช่เอาของเก่ากับของใหม่มาแย่งอันดับกัน ซึ่งเป็นบั๊กที่ทำให้ต้องมีฟีเจอร์นี้ตั้งแต่ต้น
  const twoBatchBadges = c.pickCandidateBadges([
    { id: "old-1", batchId: "batch-old", commission: 999, commissionPercent: 10.0, weeklySales: 9999, categoryLabel: "โซฟา" },
    { id: "old-2", batchId: "batch-old", commission: 900, commissionPercent: 10.0, weeklySales: 9000, categoryLabel: "โซฟา" },
    { id: "new-1", batchId: "batch-new", commission: 10, commissionPercent: 10.0, weeklySales: 100, categoryLabel: "โซฟา" },
    { id: "new-2", batchId: "batch-new", commission: 9, commissionPercent: 10.0, weeklySales: 90, categoryLabel: "โซฟา" },
  ]);
  checkDeep(
    "ชุดใหม่ได้ rank 1 ของตัวเอง แม้ตัวเลขต่ำกว่าชุดเก่ามาก (ไม่ข้ามชุดมาแย่งอันดับ)",
    twoBatchBadges.get("new-1"),
    [{ type: "topSeller", rank: 1 }, { type: "topCommission", rank: 1 }]
  );
  checkDeep(
    "ชุดเก่าก็ยังมี rank 1 ของตัวเองแยกต่างหาก",
    twoBatchBadges.get("old-1"),
    [{ type: "topSeller", rank: 1 }, { type: "topCommission", rank: 1 }]
  );

  // --- latestBatchPerCategory ---
  // หมวดเดียวกันอาจอยู่หลายชุด ต้องเลือกชุดที่ capturedOn ใหม่สุดของหมวดนั้นๆ แยกกันทีละหมวด
  // (ชุดเดียวมีได้หลายหมวด และชุดที่ใหม่สุดของหมวด A อาจไม่ใช่ชุดที่ใหม่สุดของหมวด B)
  const latest = c.latestBatchPerCategory([
    { batchId: "b-aug20", categoryLabel: "โซฟา", capturedOn: new Date("2026-08-20T05:00:00Z") },
    { batchId: "b-aug23", categoryLabel: "โซฟา", capturedOn: new Date("2026-08-23T05:00:00Z") },
    { batchId: "b-aug20", categoryLabel: "ชั้นวาง", capturedOn: new Date("2026-08-20T05:00:00Z") },
  ]);
  check("โซฟา -> ชุด 23 ส.ค. (ใหม่สุดของหมวดนี้)", latest.get("โซฟา"), "b-aug23");
  check("ชั้นวาง -> ชุด 20 ส.ค. (มีชุดเดียว ไม่ถูกชุดใหม่ของหมวดอื่นแย่ง)", latest.get("ชั้นวาง"), "b-aug20");
  check("หมวดที่ไม่มีข้อมูล -> undefined", latest.get("ไม่มีจริง"), undefined);

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
