import { INELIGIBLE_STATUS, type AffiliateOrderRecord } from "@/lib/dashboard";

export type ClipMetricRecord = {
  id: string;
  videoId: string;
  matchedEntryId: string | null;
  title: string;
  postedDate: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  capturedOn: Date;
  importedAt: Date;
};

export type ClipSignalKind = "emerging" | "hidden-gem" | "reach-no-convert" | "fading";

export type ClipSignal = {
  kind: ClipSignalKind;
  entryId: string;
  productName: string;
  headline: string;
  detail: string;
  strength: number;
};

export type ClipStat = {
  entryId: string;
  productName: string;
  views: number;
  viewDelta: number | null;
  orders: number;
  badOrders: number;
  ordersLast7Days: number;
};

/** ต้องมีวิวถึงเกณฑ์ก่อนจึงเชื่อ conversion ได้ — 1 ออเดอร์บน 50 วิว = 2% ซึ่งหลอกตา */
const MIN_VIEWS_FOR_CONV = 500;
/** เคลม "conv สูง" ด้วยออเดอร์เดียวไม่ได้ */
const MIN_ORDERS_FOR_CONV = 2;
/** ออเดอร์ที่ไม่มีสิทธิ์/คืนของเกินสัดส่วนนี้ = ไม่ใช่ของจริง */
const MAX_BAD_RATIO = 0.3;
const DAY_MS = 24 * 60 * 60 * 1000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * รวม metric snapshot + ออเดอร์ ให้เป็นสถิติต่อคลิป
 * viewDelta = ผลต่างวิวระหว่าง snapshot ล่าสุดกับก่อนหน้า (null ถ้ามี snapshot เดียว)
 */
export function buildClipStats(args: {
  entries: { id: string; productName: string }[];
  metrics: ClipMetricRecord[];
  orders: AffiliateOrderRecord[];
  now: Date;
}): ClipStat[] {
  const { entries, metrics, orders, now } = args;

  const metricsByEntry = new Map<string, ClipMetricRecord[]>();
  for (const m of metrics) {
    if (!m.matchedEntryId) continue;
    const list = metricsByEntry.get(m.matchedEntryId);
    if (list) list.push(m);
    else metricsByEntry.set(m.matchedEntryId, [m]);
  }

  const stats: ClipStat[] = [];
  for (const e of entries) {
    const snaps = (metricsByEntry.get(e.id) ?? []).sort(
      (a, b) => a.capturedOn.getTime() - b.capturedOn.getTime()
    );
    if (snaps.length === 0) continue;

    const latest = snaps[snaps.length - 1];
    const previous = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
    const entryOrders = orders.filter((o) => o.matchedEntryId === e.id);

    stats.push({
      entryId: e.id,
      productName: e.productName,
      views: latest.views,
      viewDelta: previous ? latest.views - previous.views : null,
      orders: entryOrders.length,
      badOrders: entryOrders.filter(
        (o) => o.status === INELIGIBLE_STATUS || o.itemsSold === 0
      ).length,
      ordersLast7Days: entryOrders.filter(
        (o) => now.getTime() - o.orderDate.getTime() <= 7 * DAY_MS
      ).length,
    });
  }
  return stats;
}

export function detectSignals(stats: ClipStat[]): ClipSignal[] {
  const usable = stats.filter((s) => s.views > 0);
  if (usable.length === 0) return [];

  const totalViews = usable.reduce((a, s) => a + s.views, 0);
  const totalOrders = usable.reduce((a, s) => a + s.orders, 0);
  const channelConv = totalViews > 0 ? totalOrders / totalViews : 0;
  const medianViews = median(usable.map((s) => s.views));

  const pct = (n: number) => (n * 100).toFixed(3) + "%";
  const signals: ClipSignal[] = [];

  for (const s of usable) {
    const badRatio = s.orders > 0 ? s.badOrders / s.orders : 0;
    if (badRatio >= MAX_BAD_RATIO) continue;

    const conv = s.views > 0 ? s.orders / s.views : 0;
    const convTrusted = s.views >= MIN_VIEWS_FOR_CONV && s.orders >= MIN_ORDERS_FOR_CONV;
    const reachEnough = s.views >= Math.max(MIN_VIEWS_FOR_CONV, medianViews * 2);

    if (
      s.viewDelta !== null &&
      s.viewDelta >= medianViews &&
      convTrusted &&
      conv >= channelConv * 0.8
    ) {
      signals.push({
        kind: "emerging",
        entryId: s.entryId,
        productName: s.productName,
        headline: "กำลังมา — ทำ angle ใหม่ซ้ำตอนนี้",
        detail: `วิวเพิ่ม ${s.viewDelta.toLocaleString()} ในรอบล่าสุด · ${s.orders} ออเดอร์ · conv ${pct(conv)}`,
        strength: s.viewDelta,
      });
    } else if (convTrusted && conv >= channelConv * 1.3 && s.views < medianViews) {
      signals.push({
        kind: "hidden-gem",
        entryId: s.entryId,
        productName: s.productName,
        headline: "ของดีแต่คนไม่เห็น — ทำใหม่หรือดันด้วยแอด",
        detail: `conv ${pct(conv)} (สูงกว่าค่าเฉลี่ยช่อง ${pct(channelConv)}) แต่ได้แค่ ${s.views.toLocaleString()} วิว`,
        strength: conv / (channelConv || 1),
      });
    } else if (reachEnough && conv <= channelConv * 0.5) {
      signals.push({
        kind: "reach-no-convert",
        entryId: s.entryId,
        productName: s.productName,
        headline: "คนดูเยอะแต่ไม่ซื้อ — คอนเทนต์ใช้ได้ ลองเปลี่ยนสินค้า",
        detail: `${s.views.toLocaleString()} วิว แต่ conv แค่ ${pct(conv)} (ค่าเฉลี่ยช่อง ${pct(channelConv)})`,
        strength: s.views,
      });
    } else if (
      s.viewDelta !== null &&
      s.viewDelta < s.views * 0.05 &&
      s.ordersLast7Days === 0 &&
      s.orders >= 1
    ) {
      signals.push({
        kind: "fading",
        entryId: s.entryId,
        productName: s.productName,
        headline: "หยุดแล้ว — ไม่ต้องลงแรงต่อ",
        detail: `วิวแทบไม่ขยับ (+${s.viewDelta.toLocaleString()}) และไม่มีออเดอร์ใน 7 วัน`,
        strength: 0,
      });
    }
  }

  return signals.sort((a, b) => b.strength - a.strength);
}
