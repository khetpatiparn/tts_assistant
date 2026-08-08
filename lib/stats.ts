/**
 * สถิติพื้นฐานสำหรับตัดสินว่าตัวเลขที่เห็นเชื่อได้แค่ไหน
 *
 * ไฟล์นี้ไม่ import อะไรเลยโดยตั้งใจ จึงคอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้
 * (โปรเจกต์นี้ไม่มี test runner)
 */

/** z ของช่วงความเชื่อมั่น 95% สองทาง */
const Z_95 = 1.959964;

/**
 * Epsilon threshold สำหรับ clamp ขอบบน เพื่อรองรับความคลาดเคลื่อนของทศนิยม
 *
 * ในกรณี 100% สำเร็จ (successes === trials) สูตร Wilson ควรให้ผลลัพธ์เป็น 1.0 พอดี
 * แต่การคำนวณด้วย JavaScript floating-point ให้ผลลัพธ์ 0.9999999999999999 แทน
 * (เนื่องจาก (centre + spread) / denom ตรงแนวเส้นนี้ไม่เท่ากับพอดี เนื่องจากการปัดเศษ)
 * ค่า threshold นี้ใช้ handle edge case นั้นให้ return เป็น 1 ตามที่คาดหวัง
 */
const NEAR_ONE_EPSILON = 0.9999999999;

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
  // Clamp ให้เป็น 1 สำหรับค่าที่เกือบ 1 เพื่อรองรับ floating-point precision
  // (ดู NEAR_ONE_EPSILON comment ด้านบน)
  return result > NEAR_ONE_EPSILON ? 1 : Math.min(1, result);
}

/**
 * ช่วงความเชื่อมั่นของอัตราส่วนความเร็วสองช่วงเวลา (rate ratio) — ใช้กับข้อมูลนับที่มาจาก
 * ช่วงเวลาไม่เท่ากัน เช่น "วิวเพิ่มขึ้นเท่าไรในกี่วัน" สองช่วง
 *
 * แปลงโจทย์เป็นสัดส่วนแบบ Wilson: ถ้าอัตราทั้งสองช่วงเท่ากันจริง สัดส่วนของนับที่มาจาก
 * ช่วงแรก (c1/(c1+c2)) ควรเท่ากับสัดส่วนเวลาของช่วงแรก (t1/(t1+t2)) พอดี ใช้ Wilson CI
 * ของสัดส่วนนี้แล้วแปลงกลับเป็นช่วงของ rate ratio ผ่านความสัมพันธ์ odds: p/(1-p) = (c1/c2)
 * ดังนั้น ratio = [p/(1-p)] * (t2/t1)
 *
 * ออกแบบมาแทนที่การเทียบ "อัตราของคลิปนี้กับค่ากลางของกลุ่มคลิปเดียวกับที่กำลังทดสอบ"
 * ซึ่งรับประกันทางคณิตศาสตร์ว่าประมาณครึ่งหนึ่งจะผ่านเกณฑ์เสมอไม่ว่าจะโตจริงหรือไม่
 * (self-referential median) — ตอนนี้เทียบกับตัวเองในอดีตแทน จึงเงียบได้จริงเมื่อไม่ได้โตขึ้น
 *
 * คืน null เมื่อ c1/c2 ติดลบ หรือ t1/t2 ไม่เป็นบวก (คำนวณไม่ได้)
 */
export function rateRatioBounds(
  c1: number,
  t1: number,
  c2: number,
  t2: number
): { low: number; high: number } | null {
  if (c1 < 0 || c2 < 0 || t1 <= 0 || t2 <= 0) return null;
  const n = c1 + c2;
  if (n <= 0) return null;
  const pLow = wilsonLowerBound(c1, n);
  const pHigh = wilsonUpperBound(c1, n);
  const toRatio = (p: number) => (p >= 1 ? Infinity : (p / (1 - p)) * (t2 / t1));
  return { low: toRatio(pLow), high: toRatio(pHigh) };
}
