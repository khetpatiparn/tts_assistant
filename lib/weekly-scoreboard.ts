import type { AffiliateOrderRecord } from "@/lib/dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

/** entry เท่าที่ scoreboard ต้องใช้ — รับเป็น shape แคบๆ เพื่อให้ทดสอบง่ายและไม่ผูกกับ Prisma */
export type ScoreboardEntry = {
  id: string;
  postedAt: Date | null;
};

export type WeekRow = {
  /** จันทร์ 00:00 UTC ใช้เป็นคีย์ของสัปดาห์ (ไม่ใช่เวลาจริง — เป็นวันตามปฏิทิน) */
  weekStart: Date;
  /** อาทิตย์ของสัปดาห์เดียวกัน */
  weekEnd: Date;
  isCurrent: boolean;
  clips: number;
  settledRevenue: number;
  newWinners: number;
};

export type Scoreboard = {
  /** เรียงใหม่→เก่า แถวแรกคือสัปดาห์ปัจจุบัน */
  weeks: WeekRow[];
  /** คลิปที่โพสต์ไม่ถึง 7 วัน — ยังสรุปผลไม่ได้ */
  tooEarlyClips: number;
};

/**
 * หาวันจันทร์ของสัปดาห์ที่วันตามปฏิทิน (y, m, d) นั้นอยู่ คืนเป็น Date ที่ UTC midnight
 * รับเป็นตัวเลขวันตามปฏิทินแทน Date เพื่อบังคับให้ผู้เรียกตัดสินใจก่อนว่าจะอ่านวันจาก
 * UTC หรือ local — สองแหล่งข้อมูลในแอปนี้เก็บคนละแบบ (ดูคอมเมนต์สองฟังก์ชันถัดไป)
 */
function mondayUtc(year: number, monthIndex: number, day: number): Date {
  const dt = new Date(Date.UTC(year, monthIndex, day));
  const back = (dt.getUTCDay() + 6) % 7; // อาทิตย์(0) ต้องถอย 6 วัน
  return new Date(dt.getTime() - back * DAY_MS);
}

/** `postedAt` เก็บเป็น UTC midnight ของวันที่โพสต์ — ต้องอ่านด้วย getUTC* ไม่งั้นเพี้ยนไป 1 วัน */
export function weekStartOfPostedAt(d: Date): Date {
  return mondayUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** `orderDate` และ `now` เป็น timestamp เวลาไทย — อ่านด้วย local getter (เหมือน dayKey ใน lib/dashboard.ts) */
export function weekStartOfLocal(d: Date): Date {
  return mondayUtc(d.getFullYear(), d.getMonth(), d.getDate());
}

export function buildWeeklyScoreboard(args: {
  entries: ScoreboardEntry[];
  orders: AffiliateOrderRecord[];
  now: Date;
  weeks?: number;
}): Scoreboard {
  const { entries, orders, now } = args;
  const weekCount = args.weeks ?? 4;

  const currentWeek = weekStartOfLocal(now);

  // โครงแถวว่างของ N สัปดาห์ล่าสุด (ใหม่→เก่า) สร้างก่อนเสมอ เพื่อให้สัปดาห์ที่ไม่มีข้อมูล
  // แสดงเป็น 0 ไม่ใช่หายไปจากตาราง
  const rows: WeekRow[] = [];
  const indexByKey = new Map<number, number>();
  for (let i = 0; i < weekCount; i++) {
    const weekStart = new Date(currentWeek.getTime() - i * 7 * DAY_MS);
    rows.push({
      weekStart,
      weekEnd: new Date(weekStart.getTime() + 6 * DAY_MS),
      isCurrent: i === 0,
      clips: 0,
      settledRevenue: 0,
      newWinners: 0,
    });
    indexByKey.set(weekStart.getTime(), i);
  }

  for (const e of entries) {
    if (!e.postedAt) continue;
    const idx = indexByKey.get(weekStartOfPostedAt(e.postedAt).getTime());
    if (idx !== undefined) rows[idx].clips++;
  }

  // เงินที่ได้จริง — นิยามเดียวกับ settledRevenue ใน summarizeOrders (ผลรวม finalRevenue)
  // ต้องตรงกัน ไม่งั้นตัวเลขสองที่ในหน้าเดียวกันจะขัดกันเอง
  for (const o of orders) {
    const revenue = o.finalRevenue ?? 0;
    if (revenue === 0) continue;
    const idx = indexByKey.get(weekStartOfLocal(o.orderDate).getTime());
    if (idx !== undefined) rows[idx].settledRevenue += revenue;
  }

  // winner ใหม่ = entry ที่ "ได้เงินจริงครั้งแรก" ในสัปดาห์นั้น
  // ต้องหาจากออเดอร์ทั้งหมด ไม่ใช่เฉพาะ 4 สัปดาห์ล่าสุด ไม่งั้น entry ที่เคยได้เงินตั้งแต่
  // เดือนก่อนจะถูกนับเป็น winner ใหม่ซ้ำ
  const firstRevenueAt = new Map<string, Date>();
  for (const o of orders) {
    if (!o.matchedEntryId) continue;
    if ((o.finalRevenue ?? 0) === 0) continue;
    const prev = firstRevenueAt.get(o.matchedEntryId);
    if (!prev || o.orderDate.getTime() < prev.getTime()) {
      firstRevenueAt.set(o.matchedEntryId, o.orderDate);
    }
  }
  for (const first of firstRevenueAt.values()) {
    const idx = indexByKey.get(weekStartOfLocal(first).getTime());
    if (idx !== undefined) rows[idx].newWinners++;
  }

  const currentWeekStart = rows[0].weekStart;
  const tooEarlyClips = entries.filter((e) => {
    if (!e.postedAt) return false;
    const age = now.getTime() - e.postedAt.getTime();
    if (age < 0 || age >= 7 * DAY_MS) return false;
    const weekStart = weekStartOfPostedAt(e.postedAt);
    return weekStart.getTime() === currentWeekStart.getTime();
  }).length;

  return { weeks: rows, tooEarlyClips };
}
