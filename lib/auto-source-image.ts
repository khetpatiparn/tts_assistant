/**
 * รูปต้นทางที่ใส่เข้ารูปสินค้า (ProductImage) ของ entry อัตโนมัติตอนเข้าคิว Flow — ระบุด้วย prefix ของชื่อไฟล์ (ไม่มีคอลัมน์ใหม่)
 * เข้าคิวซ้ำ = แทนแถวเดิม · เลือกรูปรอบ 2 = ลบทิ้งแล้วใช้รูปที่ Flow วาด 2 รูปแทน · แถวที่ไม่มี prefix (ผู้ใช้เพิ่มเอง /
 * ก๊อปจาก Flow รอบ 2) ไม่ถูกแตะอัตโนมัติเด็ดขาด · ส่วนที่แตะ DB/ดิสก์อยู่ lib/auto-source-image-db.ts
 * ไฟล์นี้ pure (ทดสอบด้วย scripts/check-product-image-source.mjs) — ห้าม import อะไรที่แตะ DB/ดิสก์/Next
 */

/** ชื่อไฟล์อื่นของ ProductImage คือ `<uuid>.<ext>` เสมอ (อัปโหลดเอง / ก๊อปจาก Flow / ทำซ้ำ entry) จึงไม่มีทางชนกัน */
export const AUTO_SOURCE_PREFIX = "auto-source-";

/**
 * caption ตั้งต้นของรูปต้นทางอัตโนมัติ — **ถูกส่งให้ Gemini เป็นคำกำกับรูป** (interleave กับรูป ดู gemini-prompting.md)
 * รูปของร้านมักมีราคา/ข้อความโฆษณาทับ บอกไว้ว่าไม่ใช่ส่วนของสินค้า ไม่งั้นโมเดลบรรยายตัวหนังสือเป็นลายบนสินค้า
 * (ปัญหาเดียวกับที่ทำให้ต้องใช้รูปที่ Flow วาดแทนหลังเลือกรอบ 2) · ผู้ใช้แก้ caption ได้ในหน้า entry เหมือนรูปอื่น
 */
export const AUTO_SOURCE_CAPTION = "รูปสินค้าจริงจากร้าน (ราคา/ข้อความโฆษณาที่ร้านใส่ทับรูปไม่ใช่ส่วนของสินค้า)";

export function autoSourceFilename(ext: string): string {
  return `${AUTO_SOURCE_PREFIX}${crypto.randomUUID()}.${ext}`;
}

/**
 * เป็นรูปต้นทางอัตโนมัติหรือไม่ — ใช้ตัดสินว่าลบแถว+ไฟล์ได้ จึงเข้มงวด: ขึ้นต้นด้วย prefix ตรงตัวพิมพ์ มีชื่อต่อท้าย
 * และไม่มี path (`/` `\` `..`) — ลบได้เฉพาะไฟล์นั้นตัวเดียวในโฟลเดอร์ของ entry
 */
export function isAutoSourceImage(filename: string): boolean {
  return (
    filename.startsWith(AUTO_SOURCE_PREFIX) &&
    filename.length > AUTO_SOURCE_PREFIX.length &&
    !/[\\/]/.test(filename) &&
    !filename.includes("..")
  );
}
