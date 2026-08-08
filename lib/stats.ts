/**
 * สถิติพื้นฐานสำหรับตัดสินว่าตัวเลขที่เห็นเชื่อได้แค่ไหน
 *
 * ไฟล์นี้ไม่ import อะไรเลยโดยตั้งใจ จึงคอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้
 * (โปรเจกต์นี้ไม่มี test runner)
 */

/** z ของช่วงความเชื่อมั่น 95% สองทาง */
const Z_95 = 1.959964;

/**
 * ขอบล่างของช่วงความเชื่อมั่นแบบ Wilson สำหรับสัดส่วน successes/trials
 *
 * ใช้ Wilson ไม่ใช่สูตร normal ธรรมดา เพราะ conversion ของช่องนี้อยู่แถว 0.2%
 * (1 ออเดอร์ต่อ ~466 วิว) และจำนวนออเดอร์ต่อคลิปน้อย สูตรธรรมดาจะให้ช่วงที่
 * ผิดจนติดลบได้ในย่านนั้น
 *
 * คืน 0 เมื่อ trials <= 0 — ไม่มีข้อมูลแปลว่าพิสูจน์อะไรไม่ได้ ไม่ใช่แปลว่าดี
 */
export function wilsonLowerBound(
  successes: number,
  trials: number,
  z: number = Z_95
): number {
  if (trials <= 0) return 0;
  const k = Math.max(0, Math.min(successes, trials));
  const p = k / trials;
  const denom = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const spread =
    z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return Math.max(0, (centre - spread) / denom);
}

/** ขอบบนของช่วงเดียวกัน — ใช้คู่กับขอบล่างเวลาแสดงช่วงให้ผู้ใช้เห็น */
export function wilsonUpperBound(
  successes: number,
  trials: number,
  z: number = Z_95
): number {
  if (trials <= 0) return 0;
  const k = Math.max(0, Math.min(successes, trials));
  const p = k / trials;
  const denom = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const spread =
    z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  const result = (centre + spread) / denom;
  return result > 0.9999999999 ? 1 : Math.min(1, result);
}
