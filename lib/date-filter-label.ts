/**
 * ตรรกะตัวกรองวันที่ของหน้ารายการ — แยกจากคอมโพเนนต์เพราะเป็นฟังก์ชันบริสุทธิ์ล้วน
 * ไม่ import อะไรเลย จึงคอมไพล์เดี่ยวแล้วทดสอบด้วย node ได้ (โปรเจกต์ไม่มี test runner)
 *
 * ทุกฟังก์ชันที่นี่อ่านเวลาปัจจุบันด้วย local getter เสมอ เพราะ new Date() คือ timestamp จริง
 * ไม่ใช่ค่าที่เข้ารหัสเป็น UTC midnight แบบ postedAt ที่เก็บใน DB — การตีความสตริง
 * "YYYY-MM-DD" ต่างกันตามฐานวันที่เป็นหน้าที่ของ lib/entry-date-filter.ts ไม่ใช่ที่นี่
 * (บั๊กคลาสนี้เคยเกิดมาแล้วตอน todayKey/daysAgoKey อยู่ใน entry-list.tsx และทำให้
 * ปุ่มช่วงวันที่เลื่อนไป 1 วันในช่วงเที่ยงคืนถึง 7 โมงเช้าเวลาไทย)
 *
 * ทุกฟังก์ชันรับ now เข้ามาได้เพื่อให้ทดสอบแบบกำหนดเวลาเองได้ ค่าปริยายคือเวลาจริง
 */

export type QuickRangeId = "all" | "today" | "7d" | "30d" | "custom";

/** ช่วงสำเร็จรูปในเมนู — days คือจำนวนวันที่ถอยหลังจากวันนี้ (0 = วันนี้วันเดียว) */
export const QUICK_RANGES: {
  id: "today" | "7d" | "30d";
  label: string;
  days: number;
}[] = [
  { id: "today", label: "วันนี้", days: 0 },
  { id: "7d", label: "7 วันล่าสุด", days: 6 },
  { id: "30d", label: "30 วันล่าสุด", days: 29 },
];

/** Date -> "YYYY-MM-DD" ตามปฏิทินท้องถิ่น */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" -> Date เที่ยงคืนตามเวลาท้องถิ่น (undefined ถ้ารูปแบบไม่ถูก) */
export function fromDateKey(key: string): Date | undefined {
  if (!key) return undefined;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

export function daysAgoKey(days: number, now: Date = new Date()): string {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  base.setTime(base.getTime() - days * 86400000);
  return toDateKey(base);
}

/**
 * ช่วงที่กรองอยู่ตรงกับปุ่มสำเร็จรูปตัวไหน
 * ไม่ตรงตัวไหนเลยแต่มีค่าอยู่ = "custom" · ไม่มีค่าเลย = "all"
 */
export function matchQuickRange(
  from: string | null,
  to: string | null,
  now: Date = new Date()
): QuickRangeId {
  if (from === null && to === null) return "all";
  if (to === todayKey(now)) {
    for (const range of QUICK_RANGES) {
      if (from === daysAgoKey(range.days, now)) return range.id;
    }
  }
  return "custom";
}

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** "2026-08-05" -> "5 ส.ค." — ไม่ใส่ปีเพราะป้ายบนปุ่มต้องสั้นพอไม่ดันปุ่มข้างๆ */
function shortThaiDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return `${d} ${THAI_MONTHS[m - 1]}`;
}

/**
 * ข้อความบนปุ่มตัวกรองวันที่
 * ตอนไม่ได้กรองคืนชื่อหมวด ("วันที่") ไม่ใช่ค่า เพื่อไม่ให้ซ้ำกับตัวเลือก "ทั้งหมด"
 * ของตัวกรองสถานะที่อยู่ข้างกันบนหน้าจอเดียวกัน
 */
export function formatDateFilterLabel(
  from: string | null,
  to: string | null,
  now: Date = new Date()
): string {
  const matched = matchQuickRange(from, to, now);
  if (matched === "all") return "วันที่";
  const quick = QUICK_RANGES.find((r) => r.id === matched);
  if (quick) return quick.label;
  if (from !== null && to !== null) {
    return `${shortThaiDate(from)} - ${shortThaiDate(to)}`;
  }
  if (from !== null) return `ตั้งแต่ ${shortThaiDate(from)}`;
  return `ถึง ${shortThaiDate(to as string)}`;
}
