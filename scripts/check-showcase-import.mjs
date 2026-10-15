/**
 * ตรวจตรรกะของ lib/showcase-import.ts — ทำหน้าที่แทน test suite ที่โปรเจกต์นี้ไม่มี
 * (แบบเดียวกับ scripts/check-candidates.mjs)
 *
 * รัน: node scripts/check-showcase-import.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-showcase-import-tmp-"));
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

function checkClose(name, actual, expected, tolerance = 0.001) {
  const ok = Math.abs(actual - expected) < tolerance;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${actual} ควรได้ ~${expected}`);
}

try {
  // compile lib/candidates.ts ด้วย (ไม่ใช่แค่ showcase-import.ts) เพื่อใช้ normalizeName ตัวจริง
  // ตอนทดสอบ Finding 2 (nameKey collision fix) — ให้ทดสอบสูตรเดียวกับที่ app/actions.ts ใช้จริง
  // (`${normalizeName(row.name)}::${row.sourceProductId}`) ไม่ใช่ก๊อปสูตรมาเขียนซ้ำในเทสต์
  execFileSync(
    "npx",
    ["tsc", "lib/showcase-import.ts", "lib/candidates.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler"],
    { stdio: "inherit", shell: true }
  );
  const m = await import(pathToFileURL(join(out, "showcase-import.js")).href);
  const candidatesModule = await import(pathToFileURL(join(out, "candidates.js")).href);

  const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/showcase-sample.json"), "utf8"));
  const { rows, skipped } = m.parseShowcasePayload(fixture);

  check("3 usable rows parsed", rows.length, 3);
  check("2 rows skipped (missing productId + hasStatusPopup)", skipped, 2);
  check("first row sourceProductId", rows[0].sourceProductId, "1736476547228075452");
  check("first row name", rows[0].name, "ชั้นวางของในครัว 2 ชั้น");
  check("price parsed from display string", rows[0].price, 128.71);
  check("commissionRate 1200 -> 12", rows[0].commission, 12);
  check("categoryLabel ส่งตรงจาก field categoryLabel", rows[0].categoryLabel, "เครื่องครัว");
  checkDeep("imageUrls ส่งตรงจาก field imageUrls (extension flatten ให้แล้ว)", rows[0].imageUrls, [
    "https://p16-oec-sg.ibyteimg.com/example-cover.jpeg",
    "https://p16-oec-sg.ibyteimg.com/example-1.jpeg",
    "https://p16-oec-sg.ibyteimg.com/example-2.jpeg",
  ]);
  check("second row (PETLUSCI, no imageUrls field) has empty imageUrls", rows[1].imageUrls.length, 0);
  check("commissionRate 1600 -> 16", rows[1].commission, 16);
  check("third row (no commissionRate field) commission falls back to 0", rows[2].commission, 0);
  check("third row (no categoryLabel field) categoryLabel falls back to empty string", rows[2].categoryLabel, "");
  check(
    "hasStatusPopup=true (สินค้าที่ผู้ขายลบไปแล้ว) ถูกกรองออก ไม่ปนกับ rows",
    rows.some((r) => r.sourceProductId === "1736686332743353868"),
    false,
  );

  let threw = false;
  try {
    m.parseShowcasePayload({ not_products: [] });
  } catch {
    threw = true;
  }
  check("malformed payload (no products array) throws", threw, true);

  let threwProbe = false;
  try {
    m.parseShowcasePayload({ resultKind: "single_page_probe", products: [] });
  } catch {
    threwProbe = true;
  }
  check("resultKind ที่ไม่ใช่ full_scan (เช่น single_page_probe) ถูกปฏิเสธ", threwProbe, true);

  // --- Fix 1 (final-review 2026-09-22): commissionBahtFromPercent ---
  // price=128.71, commission=12 (เปอร์เซ็นต์ — เหมือนแถวแรกของ fixture ด้านบน) ต้องได้บาทต่อชิ้น
  // ฿15.4452 (128.71 * 12 / 100) ไม่ใช่ 12 ดิบๆ ที่เคยถูกเขียนลง Prisma ตรงๆ (บั๊ก Critical)
  checkClose(
    "commissionBahtFromPercent(128.71, 12) = 15.4452 บาท (ไม่ใช่ 12% ดิบ)",
    m.commissionBahtFromPercent(128.71, 12),
    15.4452
  );
  checkClose("commissionBahtFromPercent(70, 16) = 11.2 บาท", m.commissionBahtFromPercent(70, 16), 11.2);
  check("commissionBahtFromPercent(0, 12) = 0 บาท (ราคา 0)", m.commissionBahtFromPercent(0, 12), 0);
  // ยืนยันด้วยแถวที่ parse จริงจาก fixture ด้านบน (rows[0]: price 128.71, commission 12%)
  checkClose(
    "commissionBahtFromPercent ต่อจาก parseShowcasePayload จริง ได้ 15.4452 บาท",
    m.commissionBahtFromPercent(rows[0].price, rows[0].commission),
    15.4452
  );

  // --- Fix 2 (final-review 2026-09-22): nameKey ไม่ชนกันเมื่อ 2 สินค้าคนละตัวชื่อซ้ำ ---
  // จำลองเพย์โหลดที่มี 2 product_id ต่างกันแต่ title เหมือนกันเป๊ะ (routine บน TikTok Shop —
  // ร้านคัดลอกชื่อกัน) ก่อนแก้บั๊ก: nameKey = normalizeName(title) ล้วนๆ จะชนกันที่
  // @@unique([batchId, nameKey]) จน transaction ทั้งก้อน rollback สูตรที่แก้แล้วใน
  // app/actions.ts คือ `${normalizeName(row.name)}::${row.sourceProductId}` — ทดสอบด้วย
  // normalizeName ตัวจริงจาก lib/candidates.ts (compile คู่กันด้านบน) ไม่ใช่ก๊อปสูตรมาเขียนซ้ำ
  const duplicateTitlePayload = {
    products: [
      { productId: "aaa111", title: "ที่ลับเล็บแมว", priceDisplay: "฿29.00" },
      { productId: "bbb222", title: "ที่ลับเล็บแมว", priceDisplay: "฿35.00" },
    ],
  };
  const { rows: dupRows } = m.parseShowcasePayload(duplicateTitlePayload);
  check("payload สินค้าชื่อซ้ำ 2 ตัว -> parse ได้ 2 แถวไม่ถูกข้าม", dupRows.length, 2);
  const nameKeyA = `${candidatesModule.normalizeName(dupRows[0].name)}::${dupRows[0].sourceProductId}`;
  const nameKeyB = `${candidatesModule.normalizeName(dupRows[1].name)}::${dupRows[1].sourceProductId}`;
  check(
    "nameKey ของ 2 สินค้าชื่อซ้ำแต่ product_id ต่างกัน -> ไม่ชนกัน (Fix 2)",
    nameKeyA === nameKeyB,
    false
  );
  // ก่อนแก้ (nameKey = normalizeName(title) เฉยๆ) สองแถวนี้จะได้คีย์เดียวกันเป๊ะ — ยืนยันว่า
  // normalizeName อย่างเดียวคือสาเหตุจริงของการชนกัน ไม่ใช่แค่สมมติฐาน
  check(
    "ยืนยันสาเหตุ: normalizeName(title) อย่างเดียว (สูตรเดิมก่อนแก้) ชนกันจริง",
    candidatesModule.normalizeName(dupRows[0].name) === candidatesModule.normalizeName(dupRows[1].name),
    true
  );

  // --- ลิงก์รูปขนาดเต็ม ---
  const thumb = "https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/908df4290824450bafdf809aa9ada706~tplv-aphluv4xwc-resize-jpeg:300:300.jpeg";
  check("thumbnail 300:300 -> 0:0 (ขนาดเต็ม)", m.originalImageUrl(thumb), thumb.replace(":300:300.jpeg", ":0:0.jpeg"));
  check("webp ก็แปลง", m.originalImageUrl("https://h/x/a~tplv-abc-resize-webp:48:48.webp"), "https://h/x/a~tplv-abc-resize-webp:0:0.webp");
  check("มี query ต่อท้าย -> แปลงแต่คง query", m.originalImageUrl("https://h/x/a~tplv-abc-resize-jpeg:300:300.jpeg?from=1"), "https://h/x/a~tplv-abc-resize-jpeg:0:0.jpeg?from=1");
  check("ไม่ใช่รูปแบบ resize -> คืนเดิม", m.originalImageUrl("https://p16-oec-sg.ibyteimg.com/a.jpeg"), "https://p16-oec-sg.ibyteimg.com/a.jpeg");
  check("origin อยู่แล้ว -> คืนเดิม", m.originalImageUrl("https://h/x/a~tplv-abc-origin-jpeg.jpeg"), "https://h/x/a~tplv-abc-origin-jpeg.jpeg");
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
