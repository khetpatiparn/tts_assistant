import type { AffiliateOrderRecord } from "@/lib/dashboard";
import { weekStartOfPostedAt } from "@/lib/weekly-scoreboard";

const DAY_MS = 24 * 60 * 60 * 1000;

/** รับ shape แคบๆ ไม่ผูกกับ Prisma เพื่อให้ทดสอบง่าย (แบบเดียวกับ ScoreboardEntry) */
export type ChannelMetricRecord = {
  statsOn: Date;
  videoViews: number;
};

export type ReachWeekRow = {
  /** จันทร์ 00:00 UTC ใช้เป็นคีย์ของสัปดาห์ (วันตามปฏิทิน ไม่ใช่เวลาจริง) */
  weekStart: Date;
  views: number;
  orders: number;
  /** null เมื่อสัปดาห์นั้นวิวเป็นศูนย์ — ห้ามคืน Infinity/NaN ให้ UI ไปเรนเดอร์ */
  convPct: number | null;
};

export type ChannelReach = {
  /** เรียงใหม่→เก่า */
  weeks: ReachWeekRow[];
  views30d: number;
  orders30d: number;
  conv30d: number | null;
  /** conversion ของ 30 วันก่อนหน้านั้นอีกช่วง — null เมื่อยังไม่มีข้อมูล (UI ซ่อนลูกศร) */
  convPrev30d: number | null;
};

/**
 * คีย์วันตามปฏิทินจาก statsOn ซึ่งเก็บเป็น UTC midnight — ต้องอ่านด้วย getUTC*
 * คู่กับ dayKeyLocal ด้านล่าง สลับกันเมื่อไรวันจะเลื่อนไป 1 วันเงียบๆ
 */
function dayKeyUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/** คีย์วันตามปฏิทินจาก orderDate ซึ่งเป็น timestamp จริง — ต้องอ่านด้วย local getter */
function dayKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function buildChannelReach(args: {
  metrics: ChannelMetricRecord[];
  orders: AffiliateOrderRecord[];
}): ChannelReach {
  const { metrics, orders } = args;

  if (metrics.length === 0) {
    return { weeks: [], views30d: 0, orders30d: 0, conv30d: null, convPrev30d: null };
  }

  // วิวรายสัปดาห์ + จำวันที่มีข้อมูลวิวไว้ เพื่อใช้กรองออเดอร์ทีหลัง
  //
  // statsOn เก็บเป็น UTC midnight → ใช้ weekStartOfPostedAt (UTC getter)
  // ส่วน orderDate เป็น timestamp จริง → ใช้ weekStartOfLocal (local getter) ด้านล่าง
  // *** ห้ามสลับสองตัวนี้ *** สลับแล้วสัปดาห์จะเหลื่อมกันโดยไม่มีอะไรฟ้อง
  const viewsByWeek = new Map<number, number>();
  const dayToWeek = new Map<string, number>();
  for (const m of metrics) {
    const wk = weekStartOfPostedAt(m.statsOn).getTime();
    viewsByWeek.set(wk, (viewsByWeek.get(wk) ?? 0) + m.videoViews);
    dayToWeek.set(dayKeyUtc(m.statsOn), wk);
  }

  // นับออเดอร์เฉพาะวันที่มีข้อมูลวิวจริงเท่านั้น — สัปดาห์หัวท้ายของช่วง import มักมีวิว
  // ไม่ครบ 7 วัน ถ้านับออเดอร์ทั้งสัปดาห์มาหารด้วยวิวแค่ 5 วัน conv% จะสูงเกินจริง
  const ordersByWeek = new Map<number, number>();
  for (const o of orders) {
    const wk = dayToWeek.get(dayKeyLocal(o.orderDate));
    if (wk === undefined) continue;
    ordersByWeek.set(wk, (ordersByWeek.get(wk) ?? 0) + 1);
  }

  const weeks: ReachWeekRow[] = [...viewsByWeek.entries()]
    .map(([wk, views]) => {
      const count = ordersByWeek.get(wk) ?? 0;
      return {
        weekStart: new Date(wk),
        views,
        orders: count,
        convPct: views > 0 ? (100 * count) / views : null,
      };
    })
    .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());

  // ช่วง 30 วันนับถอยจาก "วันที่มีข้อมูลล่าสุดในตาราง" ไม่ใช่จากวันนี้ — ถ้านับจากวันนี้
  // ช่วงที่ยังไม่ได้ import จะถูกนับเป็นวิว 0 แล้วลาก conversion ให้เพี้ยน
  const latest = Math.max(...metrics.map((m) => m.statsOn.getTime()));

  function window(fromMs: number, toMs: number) {
    const days = new Set<string>();
    let views = 0;
    for (const m of metrics) {
      const t = m.statsOn.getTime();
      if (t < fromMs || t > toMs) continue;
      days.add(dayKeyUtc(m.statsOn));
      views += m.videoViews;
    }
    let count = 0;
    for (const o of orders) {
      if (days.has(dayKeyLocal(o.orderDate))) count++;
    }
    return { views, orders: count, conv: views > 0 ? (100 * count) / views : null };
  }

  const cur = window(latest - 29 * DAY_MS, latest);
  const prev = window(latest - 59 * DAY_MS, latest - 30 * DAY_MS);

  return {
    weeks,
    views30d: cur.views,
    orders30d: cur.orders,
    conv30d: cur.conv,
    convPrev30d: prev.conv,
  };
}
