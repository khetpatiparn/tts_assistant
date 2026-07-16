import { PAID_STATUS } from "@/lib/affiliate";

export type AffiliateOrderRecord = {
  orderId: string;
  productName: string;
  contentId: string;
  status: string;
  gmv: number;
  itemsSold: number;
  actualCommission: number | null;
  finalRevenue: number | null;
  orderDate: Date;
  matchedEntryId: string | null;
  importedAt: Date;
};

export const INELIGIBLE_STATUS = "ไม่มีสิทธิ์";

export function summarizeOrders(orders: AffiliateOrderRecord[]) {
  let totalGmv = 0;
  let settledRevenue = 0;
  let itemCount = 0;
  let paidOrderCount = 0;
  let paidGmv = 0;
  let pendingOrders = 0;
  let pendingGmv = 0;
  let ineligibleOrders = 0;
  let ineligibleGmv = 0;

  for (const o of orders) {
    totalGmv += o.gmv;
    settledRevenue += o.finalRevenue ?? 0;
    itemCount += o.itemsSold;
    if (o.status === PAID_STATUS) {
      paidOrderCount++;
      paidGmv += o.gmv;
    } else if (o.status === INELIGIBLE_STATUS) {
      ineligibleOrders++;
      ineligibleGmv += o.gmv;
    } else {
      pendingOrders++;
      pendingGmv += o.gmv;
    }
  }

  // อัตราค่าคอมจริงที่สังเกตจากออเดอร์ที่ settle แล้ว — เอาไปประเมินของที่ยังรอ
  const realizedRate = paidGmv > 0 ? settledRevenue / paidGmv : null;
  const estimatedPendingCommission =
    realizedRate !== null ? pendingGmv * realizedRate : null;

  return {
    totalGmv,
    settledRevenue,
    orderCount: orders.length,
    itemCount,
    paidOrderCount,
    paidGmv,
    pendingOrders,
    pendingGmv,
    ineligibleOrders,
    ineligibleGmv,
    realizedRate,
    estimatedPendingCommission,
  };
}

function dayKey(d: Date): string {
  // ใช้เวลาท้องถิ่น (ออเดอร์ TikTok เป็นเวลาไทยอยู่แล้ว)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ordersByDay(orders: AffiliateOrderRecord[]) {
  const map = new Map<string, { date: string; orders: number; gmv: number }>();
  for (const o of orders) {
    const k = dayKey(o.orderDate);
    const ex = map.get(k);
    if (ex) {
      ex.orders++;
      ex.gmv += o.gmv;
    } else {
      map.set(k, { date: k, orders: 1, gmv: o.gmv });
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * แนวโน้มรายได้สำหรับ sparkline — เทียบผลรวมครึ่งหลังกับครึ่งแรกของช่วง
 * points = gmv รายวัน (ใช้วาดเส้นจิ๋ว)
 */
export function revenueTrend(orders: AffiliateOrderRecord[]): {
  points: number[];
  direction: "up" | "down" | "flat";
  changePct: number;
} {
  const points = ordersByDay(orders).map((d) => d.gmv);
  if (points.length < 2) {
    return { points, direction: "flat", changePct: 0 };
  }
  const mid = Math.floor(points.length / 2);
  const firstSum = points.slice(0, mid).reduce((a, b) => a + b, 0);
  const secondSum = points.slice(mid).reduce((a, b) => a + b, 0);
  let changePct: number;
  if (firstSum === 0) {
    changePct = secondSum > 0 ? 100 : 0;
  } else {
    changePct = ((secondSum - firstSum) / firstSum) * 100;
  }
  const direction = changePct > 5 ? "up" : changePct < -5 ? "down" : "flat";
  return { points, direction, changePct };
}

export function revenueByClip(orders: AffiliateOrderRecord[]) {
  const map = new Map<
    string,
    {
      contentId: string;
      productName: string;
      matchedEntryId: string | null;
      orders: number;
      gmv: number;
      paidGmv: number;
      pendingGmv: number;
    }
  >();
  for (const o of orders) {
    const ex = map.get(o.contentId);
    const paid = o.status === PAID_STATUS;
    if (ex) {
      ex.orders++;
      ex.gmv += o.gmv;
      if (paid) ex.paidGmv += o.gmv;
      else ex.pendingGmv += o.gmv;
    } else {
      map.set(o.contentId, {
        contentId: o.contentId,
        productName: o.productName,
        matchedEntryId: o.matchedEntryId,
        orders: 1,
        gmv: o.gmv,
        paidGmv: paid ? o.gmv : 0,
        pendingGmv: paid ? 0 : o.gmv,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.gmv - a.gmv);
}

export function ordersByStatus(orders: AffiliateOrderRecord[]) {
  const map = new Map<string, { status: string; count: number; gmv: number }>();
  for (const o of orders) {
    const ex = map.get(o.status);
    if (ex) {
      ex.count++;
      ex.gmv += o.gmv;
    } else {
      map.set(o.status, { status: o.status, count: 1, gmv: o.gmv });
    }
  }
  return [...map.values()].sort((a, b) => b.gmv - a.gmv);
}

export type ReminderState = {
  daysSinceImport: number | null;
  clipsAwaitingRevenue: number;
  unmatchedSoldProducts: number;
};
