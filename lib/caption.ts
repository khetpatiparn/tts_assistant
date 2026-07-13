/**
 * แยกคำตอบของโมเดลเป็น caption กับ hashtags
 *
 * ถ้าโมเดลตอบผิดฟอร์แมตจนแยกไม่ได้ ให้คืนข้อความทั้งก้อนเป็น caption แทนการ throw —
 * ผู้ใช้ตัดแปะเองได้ ดีกว่าเสียผลลัพธ์ที่จ่ายโควตาไปแล้วทิ้งทั้งหมด
 */
export function parseCaptionOutput(raw: string): {
  caption: string;
  hashtags: string;
} {
  const text = raw.replace(/\*\*/g, "").trim();
  const match = text.match(/Caption:\s*([\s\S]*?)\n\s*Hashtags:\s*([\s\S]*)/i);

  if (!match) {
    return { caption: text, hashtags: "" };
  }

  return {
    caption: match[1].trim(),
    hashtags: match[2].trim().replace(/\s+/g, " "),
  };
}
