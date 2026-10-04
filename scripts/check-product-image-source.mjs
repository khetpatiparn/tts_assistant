/**
 * ตรวจ lib/auto-source-image.ts — รูปต้นทางที่ใส่เข้ารูปสินค้าอัตโนมัติ (ProductImage) ระบุได้จากชื่อไฟล์ที่มี prefix สงวนเท่านั้น
 * แถวที่ผู้ใช้เพิ่มเอง (ชื่อ `<uuid>.<ext>`) ต้องไม่ถูกนับเป็นรูปอัตโนมัติเด็ดขาด เพราะเข้าคิว/เลือกรอบ 2 ลบรูปอัตโนมัติทิ้ง
 * พฤติกรรมกับ DB จริงอยู่ scripts/check-product-image-source-db.ts (ต้องมีสำเนา DB)
 * รัน: node scripts/check-product-image-source.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(process.cwd(), ".check-flow-tmp-"));
let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      ได้ ${a}\n      ควรได้ ${e}`);
}

try {
  execFileSync(
    "npx",
    ["tsc", "lib/auto-source-image.ts", "--outDir", out, "--module", "es2022", "--target", "ES2017", "--moduleResolution", "bundler", "--types", "node"],
    { stdio: "pipe", shell: true },
  );
  const S = await import(pathToFileURL(join(out, "auto-source-image.js")).href);

  const a = S.autoSourceFilename("jpg");
  const b = S.autoSourceFilename("png");
  check("ชื่อไฟล์รูปอัตโนมัติ = auto-source-<uuid>.<ext>", /^auto-source-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(a), true);
  check("สร้างสองครั้งได้ชื่อไม่ซ้ำ (เข้าคิวซ้ำไม่ชนไฟล์เดิม)", a !== b && b.endsWith(".png"), true);
  check("ชื่อที่สร้างเองถูกระบุว่าเป็นรูปอัตโนมัติ", [S.isAutoSourceImage(a), S.isAutoSourceImage(b)], [true, true]);

  // แถวที่ผู้ใช้เพิ่มเอง / รูปที่ก๊อปจาก Flow รอบ 2 / ทำซ้ำ entry = `<uuid>.<ext>` — ห้ามโดนแตะ
  check("รูปที่ผู้ใช้เพิ่มเอง (uuid ล้วน) ไม่ใช่รูปอัตโนมัติ", S.isAutoSourceImage("0b6a2c1e-4f1d-4c4e-9a51-3f0b1e2d7c11.jpg"), false);
  check("ไฟล์รูปต้นทางในโฟลเดอร์ flow/ (source-0.jpg) ไม่ใช่", S.isAutoSourceImage("source-0.jpg"), false);
  check("prefix ต้องตรงตัวพิมพ์ (AUTO-SOURCE-...) ไม่ใช่", S.isAutoSourceImage("AUTO-SOURCE-x.jpg"), false);
  check("prefix อยู่กลางชื่อไม่นับ", S.isAutoSourceImage("x-auto-source-y.jpg"), false);
  check("prefix ล้วนไม่มีชื่อต่อท้ายไม่นับ", S.isAutoSourceImage("auto-source-"), false);
  // ลบไฟล์ได้เฉพาะไฟล์ในโฟลเดอร์ของ entry เท่านั้น — ชื่อที่มี path ต้องไม่ผ่านแม้ขึ้นต้นด้วย prefix
  check("มี / ไม่นับ", S.isAutoSourceImage("auto-source-x/../../evil.jpg"), false);
  check("มี \\ ไม่นับ", S.isAutoSourceImage("auto-source-x\\..\\evil.jpg"), false);
  check("มี .. ไม่นับ", S.isAutoSourceImage("auto-source-..jpg"), false);

  check("caption ของรูปอัตโนมัติไม่ว่าง (ส่งให้ Gemini เป็นคำกำกับรูป)", typeof S.AUTO_SOURCE_CAPTION === "string" && S.AUTO_SOURCE_CAPTION.trim().length > 0, true);
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failed > 0) {
  console.log(`\n${failed} รายการไม่ผ่าน`);
  process.exit(1);
}
console.log("\nผ่านทั้งหมด");
