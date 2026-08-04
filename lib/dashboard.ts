import { PAID_STATUS } from "@/lib/affiliate";

/** รอบนำเข้าไฟล์รายได้ — อิงรอบ settle ของ TikTok (~สัปดาห์) ใช้ทั้งแถบเตือนและบรรทัดสถานะ */
export const IMPORT_STALE_DAYS = 7;

export type AffiliateOrderRecord = {
  orderId: string;
  productName: string;
  contentId: string;
  status: string;
  gmv: number;
  itemsSold: number;
  itemsRefunded: number;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** ตัดเวลาออก เหลือแค่วันตามปฏิทินท้องถิ่น — ใช้ตัดขอบหน้าต่าง 7 วัน */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * แนวโน้มยอดขาย (GMV) rolling 7 วัน: เทียบ "7 วันล่าสุดที่มีข้อมูลจริง" กับ "7 วันก่อนหน้านั้น"
 *
 * จุดยึดคือวันที่ล่าสุดที่มีออเดอร์จริงในระบบ ไม่ใช่ new Date() วันนี้ตามนาฬิกา — เหตุผลเดียวกับ
 * filterByRange ใน components/revenue-charts.tsx: ข้อมูลนำเข้ามือมักค้างหลายวัน ถ้านับจากวันนี้จริง
 * ช่วง 7 วันอาจว่างเปล่าทั้งที่มีข้อมูล และผู้ใช้อัปข้อมูลไม่ตรงรอบตายตัว (5-7 วัน) จึงใช้ rolling
 * ไม่ใช่ปฏิทินจันทร์-อาทิตย์ — ปฏิทินจะทำให้สัปดาห์ปัจจุบัน "ยังไม่จบ" เกือบทุกครั้งที่อัปข้อมูล
 *
 * ใช้ GMV ไม่ใช่ settledRevenue (`finalRevenue ?? 0`): การ settle ใช้เวลา ~7-14 วัน นานกว่าหน้าต่าง
 * 7 วันเอง ทำให้ช่วง "ปัจจุบัน" เป็นช่วงที่ settle น้อยที่สุดเสมอและโชว์แนวโน้มกลับด้านหลอกๆ — GMV
 * บันทึกทันทีตอนสั่งซื้อ จึงไม่มีปัญหา settlement lag นี้
 */
export function revenueTrend(orders: AffiliateOrderRecord[]): {
  currentWindowGmv: number;
  previousWindowGmv: number;
  changePct: number;
  direction: "up" | "down" | "flat";
} {
  if (orders.length === 0) {
    return { currentWindowGmv: 0, previousWindowGmv: 0, changePct: 0, direction: "flat" };
  }

  const latestOrderDate = new Date(Math.max(...orders.map((o) => o.orderDate.getTime())));
  const windowAEnd = startOfLocalDay(latestOrderDate).getTime() + DAY_MS; // exclusive
  const windowAStart = windowAEnd - 7 * DAY_MS;
  const windowBStart = windowAStart - 7 * DAY_MS;

  let currentWindowGmv = 0;
  let previousWindowGmv = 0;

  for (const o of orders) {
    const t = o.orderDate.getTime();
    if (t < windowBStart || t >= windowAEnd) continue;
    if (t >= windowAStart) currentWindowGmv += o.gmv;
    else previousWindowGmv += o.gmv;
  }

  let changePct: number;
  if (previousWindowGmv === 0) {
    changePct = currentWindowGmv > 0 ? 100 : 0;
  } else {
    changePct = ((currentWindowGmv - previousWindowGmv) / previousWindowGmv) * 100;
  }
  const direction = changePct > 5 ? "up" : changePct < -5 ? "down" : "flat";

  return { currentWindowGmv, previousWindowGmv, changePct, direction };
}

/**
 * ยอดขาย (GMV) รวมรายสัปดาห์ (rolling 7 วัน ไม่ทับซ้อนกัน) ย้อนหลัง `weeks` สัปดาห์ เรียงเก่า→ใหม่
 *
 * ต่างจาก revenueTrend() ตรงที่นี่คือ "ภาพรวมยาว" ไม่ใช่แค่ 2 จุดล่าสุด — ใช้ยอดรวมต่อสัปดาห์
 * (ไม่ใช่ค่าเฉลี่ยรายวัน) เพราะ sum ไม่ถูกบิดเบือนจากคลิป/วันที่ขายดีผิดปกติแบบที่ average เจอ
 * จุดยึดเดียวกับ revenueTrend(): วันที่ล่าสุดที่มีออเดอร์จริง ไม่ใช่ new Date()
 */
export function weeklyGmvTrend(
  orders: AffiliateOrderRecord[],
  weeks: number = 8
): { weekStart: string; gmv: number }[] {
  if (orders.length === 0) return [];

  const latestOrderDate = new Date(Math.max(...orders.map((o) => o.orderDate.getTime())));
  const anchorEnd = startOfLocalDay(latestOrderDate).getTime() + DAY_MS;

  const result: { weekStart: string; gmv: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = anchorEnd - i * 7 * DAY_MS;
    const start = end - 7 * DAY_MS;
    let gmv = 0;
    for (const o of orders) {
      const t = o.orderDate.getTime();
      if (t >= start && t < end) gmv += o.gmv;
    }
    result.push({ weekStart: dayKey(new Date(start)), gmv });
  }
  return result;
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
      ineligibleGmv: number;
    }
  >();
  for (const o of orders) {
    const ex = map.get(o.contentId);
    const paid = o.status === PAID_STATUS;
    const ineligible = o.status === INELIGIBLE_STATUS;
    if (ex) {
      ex.orders++;
      ex.gmv += o.gmv;
      if (paid) ex.paidGmv += o.gmv;
      else if (ineligible) ex.ineligibleGmv += o.gmv;
      else ex.pendingGmv += o.gmv;
    } else {
      map.set(o.contentId, {
        contentId: o.contentId,
        productName: o.productName,
        matchedEntryId: o.matchedEntryId,
        orders: 1,
        gmv: o.gmv,
        paidGmv: paid ? o.gmv : 0,
        pendingGmv: !paid && !ineligible ? o.gmv : 0,
        ineligibleGmv: ineligible ? o.gmv : 0,
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
  /** ไฟล์รายได้ (xlsx) — ตัววัดผลหลัก */
  daysSinceOrdersImport: number | null;
  /** ไฟล์วิวคลิป (Content.csv) — เดิมไม่ถูกติดตามเลย ทำให้เตือนผิดเมื่ออัปแค่ไฟล์เดียว */
  daysSinceMetricsImport: number | null;
  unmatchedSoldProducts: number;
};
