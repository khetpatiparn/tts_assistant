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
