import type { Range } from "./config";
import { randInt } from "./humanize.js";

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * อยู่ในช่วงเวลาทำงานไหม — ปลายทางเป็น exclusive และรองรับช่วงข้ามเที่ยงคืน
 * (["22:00","07:00"] = 22:00 ถึง 06:59)
 */
export function isWithinActiveHours(now: Date, activeHours: [string, string] | null): boolean {
  if (activeHours === null) return true;
  const start = minutesOf(activeHours[0]);
  const end = minutesOf(activeHours[1]);
  const cur = minutesNow(now);
  if (start === end) return true;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

/** กี่มิลลิวินาทีจนถึงเวลาเริ่มช่วงถัดไป (เรียกเฉพาะตอน isWithinActiveHours เป็น false) */
export function msUntilActiveWindow(now: Date, activeHours: [string, string]): number {
  const start = minutesOf(activeHours[0]);
  const cur = minutesNow(now);
  const deltaMin = start > cur ? start - cur : 24 * 60 - cur + start;
  // ตัดวินาที/มิลลิวินาทีของ now ออก ให้ตื่นตรงนาทีเป้า
  return deltaMin * 60000 - now.getSeconds() * 1000 - now.getMilliseconds();
}

/** "YYYY-MM-DD" ตามเวลาท้องถิ่น — ห้ามใช้ toISOString() (จะได้วัน UTC ซึ่งเพี้ยนก่อนตี 7) */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** สุ่มว่าจะทำต่อเนื่องกี่สินค้าก่อนพักยาว — สุ่มใหม่ทุกครั้งหลังพัก */
export function pickLongBreakTarget(range: Range): number {
  return randInt(range);
}
