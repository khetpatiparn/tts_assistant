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

export function summarizeOrders(orders: AffiliateOrderRecord[]) {
  let totalGmv = 0;
  let settledRevenue = 0;
  let itemCount = 0;
  let paidOrderCount = 0;
  for (const o of orders) {
    totalGmv += o.gmv;
    settledRevenue += o.finalRevenue ?? 0;
    itemCount += o.itemsSold;
    if (o.status === PAID_STATUS) paidOrderCount++;
  }
  return { totalGmv, settledRevenue, orderCount: orders.length, itemCount, paidOrderCount };
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
