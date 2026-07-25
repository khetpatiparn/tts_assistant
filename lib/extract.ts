/**
 * แยกคำตอบของโมเดลเป็นชื่อสินค้ากับรายละเอียดสินค้า
 *
 * ถ้าโมเดลตอบผิดฟอร์แมตจนแยกไม่ได้ ให้คืนทั้งก้อนเป็น productInfo แทนการ throw —
 * ผู้ใช้ตัดแปะเองได้ ดีกว่าเสียผลลัพธ์ที่จ่ายโควตาไปแล้วทิ้งทั้งหมด (แบบเดียวกับ lib/caption.ts)
 */
export function parseExtractOutput(raw: string): {
  productName: string;
  productInfo: string;
} {
  const text = raw.replace(/\*\*/g, "").trim();
  const match = text.match(
    /ชื่อสินค้า:\s*([\s\S]*?)\n\s*รายละเอียดสินค้า:\s*([\s\S]*)/
  );

  if (!match) {
    return { productName: "", productInfo: text };
  }

  return { productName: match[1].trim(), productInfo: match[2].trim() };
}
