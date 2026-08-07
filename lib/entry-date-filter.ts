/**
 * ตัวกรองช่วงวันที่ของหน้ารายการ — แยกออกจาก lib/entry-rows.ts โดยตั้งใจ (ห้ามแก้ไฟล์นั้น)
 * ไม่มี dependency ใดๆ จึงคอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้
 */

/** คืนสตริง YYYY-MM-DD ที่ parse ได้จริงเท่านั้น ค่าอื่นคืน null เสมอ ไม่ throw */
export function parseDateParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) ? value : null;
}

/**
 * กรองแถวที่ postedAt (เก็บเป็น UTC midnight) อยู่ในช่วง [from, to] แบบรวมขอบ
 *
 * entry ที่ postedAt เป็น null (ยังไม่ได้ลงคลิป) ถูกซ่อนทันทีที่ from หรือ to
 * อย่างใดอย่างหนึ่งไม่ว่าง — เพราะ "อยู่ในช่วงวันที่" กับ entry ที่ไม่มีวันที่เป็นเรื่อง
 * กำกวม เลือกซ่อนแทนการเดา
 */
export function filterByPostedDateRange<T extends { postedAt: Date | null }>(
  rows: T[],
  from: string | null,
  to: string | null
): T[] {
  if (from === null && to === null) return rows;

  const fromMs = from !== null ? Date.parse(`${from}T00:00:00.000Z`) : -Infinity;
  const toMs = to !== null ? Date.parse(`${to}T23:59:59.999Z`) : Infinity;

  return rows.filter((r) => {
    if (r.postedAt === null) return false;
    const ms = new Date(r.postedAt).getTime();
    return ms >= fromMs && ms <= toMs;
  });
}

export type DateFilterBasis = "posted" | "created";

/** ค่า invalid หรือไม่มีค่า → fallback "posted" (พฤติกรรมเดิมของลิงก์เก่าที่ไม่มี by param) */
export function parseDateBasisParam(raw: string | string[] | undefined): DateFilterBasis {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "created" ? "created" : "posted";
}

function startOfLocalDay(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function endOfLocalDay(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/**
 * กรองแถวที่ createdAt (timestamp จริง ไม่ใช่ UTC midnight แบบ postedAt) อยู่ในช่วง [from, to]
 * ต้องใช้ local getter อ่าน from/to ไม่ใช่ UTC — บั๊กคลาสเดียวกับ toDateInputValue/
 * toLocalDateInputValue ที่ CLAUDE.md เตือนไว้ ถ้าสลับกันจะเพี้ยนไป 1 วันสำหรับ entry
 * ที่สร้างก่อน 7 โมงเช้าเวลาไทย
 *
 * createdAt ไม่เคยเป็น null (ต่างจาก postedAt) จึงไม่ต้องมีเงื่อนไขซ่อนแถวแบบ
 * filterByPostedDateRange
 */
export function filterByCreatedDateRange<T extends { createdAt: Date }>(
  rows: T[],
  from: string | null,
  to: string | null
): T[] {
  if (from === null && to === null) return rows;

  const fromMs = from !== null ? startOfLocalDay(from) : -Infinity;
  const toMs = to !== null ? endOfLocalDay(to) : Infinity;

  return rows.filter((r) => {
    const ms = new Date(r.createdAt).getTime();
    return ms >= fromMs && ms <= toMs;
  });
}
