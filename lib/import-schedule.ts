/**
 * รอบนำเข้าข้อมูลจาก TikTok Studio
 *
 * ไฟล์นี้ไม่ import อะไรเลยโดยตั้งใจ จึงคอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้
 * IMPORT_STALE_DAYS ย้ายมาจาก lib/dashboard.ts ซึ่ง re-export ต่อให้ผู้เรียกเดิม
 * (lib/entry-queries.ts, components/import-log-panel.tsx, components/reminder-banner.tsx)
 */

/** รอบนำเข้าไฟล์ — อิงรอบ settle ของ TikTok (~สัปดาห์) ใช้ทั้งแถบเตือนและบรรทัดสถานะ */
export const IMPORT_STALE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * วันที่แนะนำให้นำเข้ารอบถัดไป = วันที่นำเข้าล่าสุด + IMPORT_STALE_DAYS
 * คืน null เมื่อยังไม่เคยนำเข้า (ไม่มีฐานให้นับ)
 *
 * ปัดลงเป็นเที่ยงคืนตามปฏิทินท้องถิ่นก่อนบวก เพราะผลลัพธ์คือ "วันที่" ที่ผู้ใช้อ่าน
 * ไม่ใช่เวลาเป๊ะ — importedAt เป็น timestamp จริงจึงต้องอ่านด้วย local getter
 * ไม่ใช่ UTC (การอัปช่วงเช้าตรู่เวลาไทยจะถูกจัดเป็นคนละวันถ้าใช้ UTC)
 */
export function nextImportDate(lastImportedAt: Date | null): Date | null {
  if (lastImportedAt === null) return null;
  const base = new Date(
    lastImportedAt.getFullYear(),
    lastImportedAt.getMonth(),
    lastImportedAt.getDate()
  );
  base.setTime(base.getTime() + IMPORT_STALE_DAYS * DAY_MS);
  return base;
}

/**
 * จำนวนวันจากวันนี้ถึงวันที่กำหนด — บวก = ยังไม่ถึง, 0 = วันนี้, ลบ = เลยมาแล้ว
 * เทียบที่ระดับวันตามปฏิทินท้องถิ่น ไม่ใช่ชั่วโมง
 */
export function daysUntil(target: Date, now: Date): number {
  const t = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime();
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((t - n) / DAY_MS);
}
