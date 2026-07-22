/** ชดเชยเวลาไทย (UTC+7) — ผู้ชมส่วนใหญ่เป็นคนไทย จึงวิเคราะห์ตามเวลาไทยเสมอ */
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * TikTok video id เป็น snowflake — 32 บิตบนคือ Unix seconds ของ "เวลาอัปโหลด"
 * ยืนยันกับคลิปจริง 15 ตัว คลาดเคลื่อนจากเวลาโพสต์จริง ~21 วินาที (ไม่มีผลระดับชั่วโมง)
 *
 * ⚠️ นี่คือเวลา "อัปโหลด" ไม่ใช่ "เผยแพร่" — คลิปที่ตั้งเวลาไว้จะได้เวลาผิด
 * (เจอจริง: ที่ลับเล็บแมว อัป 28 มิ.ย. แต่เผยแพร่ 1 ก.ค.) การคัดออกทำใน analyzePostTimes
 */
export function uploadedAtFromVideoId(videoId: string): Date | null {
  if (!/^\d{6,25}$/.test(videoId)) return null;
  const seconds = Number(BigInt(videoId) >> BigInt(32));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const ms = seconds * 1000;
  // TikTok เริ่มมีคลิปปี 2016 — ค่าที่ต่ำกว่านี้แปลว่า id ไม่ใช่ snowflake ที่เราคิด
  if (ms < Date.UTC(2016, 0, 1)) return null;
  return new Date(ms);
}

/** ชั่วโมง 0-23 ตามเวลาไทย */
export function thaiHourOf(d: Date): number {
  return new Date(d.getTime() + THAI_OFFSET_MS).getUTCHours();
}

/** คีย์วันที่ YYYY-MM-DD ตามเวลาไทย — ใช้เทียบกับวันเผยแพร่ที่ได้จาก Content.csv */
export function thaiDateKey(d: Date): string {
  return new Date(d.getTime() + THAI_OFFSET_MS).toISOString().slice(0, 10);
}
