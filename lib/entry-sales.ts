/**
 * รวมยอดขาย/ยอดวิวต่อ entry — ครั้งเดียวต่อ request ไม่ query ซ้ำต่อแถวที่แสดง
 *
 * ไม่มี dependency ใดๆ ตั้งใจ (ไม่ import PAID_STATUS/INELIGIBLE_STATUS จาก
 * lib/affiliate.ts หรือ lib/dashboard.ts) — ตรวจกับข้อมูลจริงแล้วว่า finalRevenue
 * เป็น null ก็ต่อเมื่อออเดอร์ยังไม่ถึงรอบจ่ายเท่านั้น ("ไม่มีสิทธิ์" มี finalRevenue: 0
 * อยู่แล้ว ไม่ใช่ null) การใช้ finalRevenue === null ตรงๆ จึงถูกต้องและตรงกับที่
 * summarizeOrders (lib/dashboard.ts) ใช้อยู่แล้วโดยไม่ต้องพึ่งสถานะออเดอร์เลย
 */

export type EntrySalesSummary = {
  /** เงินที่ได้จริง — sum(finalRevenue) เฉพาะออเดอร์ที่ finalRevenue ไม่ null */
  settledRevenue: number;
  /** ยอดขายตั้งต้นของออเดอร์ที่ยังไม่ถึงรอบจ่าย (finalRevenue เป็น null) */
  pendingGmv: number;
  orderCount: number;
  /** จำนวนวิวจาก ClipMetric ที่ capturedOn ล่าสุด — null ถ้าไม่มี metric match เลย */
  views: number | null;
};

type OrderInput = {
  matchedEntryId: string | null;
  gmv: number;
  finalRevenue: number | null;
};

type MetricInput = {
  matchedEntryId: string | null;
  views: number;
  capturedOn: Date;
};

function ensure(
  map: Map<string, EntrySalesSummary>,
  entryId: string
): EntrySalesSummary {
  let s = map.get(entryId);
  if (!s) {
    s = { settledRevenue: 0, pendingGmv: 0, orderCount: 0, views: null };
    map.set(entryId, s);
  }
  return s;
}

export function summarizeEntrySales(
  orders: OrderInput[],
  metrics: MetricInput[]
): Map<string, EntrySalesSummary> {
  const map = new Map<string, EntrySalesSummary>();

  for (const o of orders) {
    if (o.matchedEntryId === null) continue;
    const s = ensure(map, o.matchedEntryId);
    s.orderCount++;
    if (o.finalRevenue !== null) {
      s.settledRevenue += o.finalRevenue;
    } else {
      s.pendingGmv += o.gmv;
    }
  }

  // เก็บ views ของ capturedOn ล่าสุดต่อ entry — ต้องเทียบทีละแถว ไม่ใช่ใช้ค่าสุดท้าย
  // ที่เจอในอาร์เรย์ (อาร์เรย์อาจไม่ได้เรียงตามเวลา)
  const latestCapturedOnMs = new Map<string, number>();
  for (const m of metrics) {
    if (m.matchedEntryId === null) continue;
    const at = m.capturedOn.getTime();
    const prevAt = latestCapturedOnMs.get(m.matchedEntryId) ?? -Infinity;
    if (at > prevAt) {
      latestCapturedOnMs.set(m.matchedEntryId, at);
      const s = ensure(map, m.matchedEntryId);
      s.views = m.views;
    }
  }

  return map;
}
