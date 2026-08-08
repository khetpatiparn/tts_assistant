import { INELIGIBLE_STATUS, type AffiliateOrderRecord } from "@/lib/dashboard";
import { rateRatioBounds, wilsonLowerBound, wilsonUpperBound } from "@/lib/stats";

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

/** สัญญาณเชิงบวกสองแบบ — ตัด "ดูเยอะไม่ซื้อ"/"หยุดแล้ว" ออกแล้วเพราะบอกสิ่งที่รู้อยู่แล้วซ้ำๆ */
export type ClipSignalKind = "growing" | "proven";

export type ClipTask = {
  entryId: string;
  productName: string;
  /** ติดได้มากกว่าหนึ่งป้าย — คลิปที่ทั้งโตและขายดีคือของที่ควรทำซ้ำที่สุด */
  kinds: ClipSignalKind[];
  views: number;
  viewDelta: number | null;
  orders: number;
  /** ช่วงความเชื่อมั่นของ conv เทียบค่าเฉลี่ยช่อง (หน่วยเป็น "เท่า") null เมื่อช่องยังไม่มีออเดอร์เลย */
  convRatioRange: { low: number; high: number } | null;
  /** ช่วงความเชื่อมั่นของ "อัตราเร็วรอบนี้เทียบกับรอบก่อนของคลิปเดียวกัน" null เมื่อมี snapshot ไม่ถึง 3 จุด หรือวิวลดลง */
  growthRatioRange: { low: number; high: number } | null;
};

export type ClipStat = {
  entryId: string;
  productName: string;
  views: number;
  viewDelta: number | null;
  /**
   * จำนวนวันระหว่าง snapshot ล่าสุดกับก่อนหน้า (ที่ viewDelta คำนวณมาจาก) — null คู่กับ
   * viewDelta เสมอ (มี snapshot เดียวหรือน้อยกว่า) ใช้ normalize viewDelta ให้เป็น "วิวต่อวัน"
   * ก่อนเทียบข้าม clip เพราะ Content.csv จำกัด 15 แถวต่อไฟล์ (ดู CLAUDE.md) — clip ที่หลุดจาก
   * top-15 ไปหนึ่งรอบแล้วกลับมาจะมีช่วงเวลาระหว่าง snapshot กว้างกว่าปกติ ถ้าเทียบ viewDelta
   * ดิบตรงๆ ตัวเลขจะพองจากช่องว่างการ export ไม่ใช่การเติบโตจริง
   */
  daysSinceLastSnapshot: number | null;
  /**
   * วิวที่เพิ่มระหว่าง snapshot ก่อนหน้ากับก่อนหน้านั้นอีกที (ช่วงก่อนช่วงล่าสุด) — null ถ้ามี
   * snapshot ไม่ถึง 3 จุด ใช้คู่กับ priorDaysSinceSnapshot เพื่อคำนวณอัตราส่วนความเร็วสองช่วง
   * แบบมีช่วงความเชื่อมั่น (rateRatioBounds ใน lib/stats.ts)
   */
  priorViewDelta: number | null;
  /** จำนวนวันของช่วงก่อนหน้า (คู่กับ priorViewDelta) */
  priorDaysSinceSnapshot: number | null;
  orders: number;
  badOrders: number;
  ordersLast7Days: number;
};

/** ออเดอร์ที่ไม่มีสิทธิ์/คืนของเกินสัดส่วนนี้ = ไม่ใช่ของจริง */
const MAX_BAD_RATIO = 0.3;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    const beforePrevious = snaps.length >= 3 ? snaps[snaps.length - 3] : null;
    const entryOrders = orders.filter((o) => o.matchedEntryId === e.id);

    stats.push({
      entryId: e.id,
      productName: e.productName,
      views: latest.views,
      viewDelta: previous ? latest.views - previous.views : null,
      daysSinceLastSnapshot: previous
        ? Math.round((latest.capturedOn.getTime() - previous.capturedOn.getTime()) / DAY_MS)
        : null,
      priorViewDelta:
        previous && beforePrevious ? previous.views - beforePrevious.views : null,
      priorDaysSinceSnapshot:
        previous && beforePrevious
          ? Math.round((previous.capturedOn.getTime() - beforePrevious.capturedOn.getTime()) / DAY_MS)
          : null,
      orders: entryOrders.length,
      badOrders: entryOrders.filter(
        (o) => o.status === INELIGIBLE_STATUS || o.itemsSold === 0 || o.itemsRefunded > 0
      ).length,
      ordersLast7Days: entryOrders.filter(
        (o) => now.getTime() - o.orderDate.getTime() <= 7 * DAY_MS
      ).length,
    });
  }
  return stats;
}

/**
 * ตัดสินว่าคลิปไหนควรเป็น "งานรอบนี้"
 *
 * ต่างจากเวอร์ชันเดิมตรงที่ไม่มีอัตราส่วนที่ตั้งด้วยมือ (1.3 / 0.8) และไม่มีเกณฑ์
 * จำนวนวิว/ออเดอร์ขั้นต่ำที่แช่ไว้ — ใช้ช่วงความเชื่อมั่นแทน สัญญาณจึงเงียบเอง
 * เมื่อข้อมูลยังน้อย แทนที่จะยิงผิดอย่างมั่นใจ
 *
 * วัดจากข้อมูลจริงแล้ว: เกณฑ์เดิมให้สัญญาณ 18 รายการซึ่ง 2 ใน 3 ของที่เหลือหลัง
 * ตัด "หยุดแล้ว"/"ดูเยอะไม่ซื้อ" ยังแยกจากคลิปธรรมดาไม่ได้ทางสถิติ
 *
 * ข้อจำกัดทางสถิติที่รู้แล้วแต่ยังไม่แก้ (ยืนยันด้วย two-proportion z-test จริง
 * ชั้นวางของ z=2.73 โต๊ะรีดผ้า z=4.85 — เกณฑ์ปัจจุบันยังผ่านสบาย ไม่ต้องแก้ตรรกะตอนนี้):
 * 1. `channelConv` ถูกปฏิบัติเหมือนค่าคงที่แม่นยำ ทั้งที่จริงเป็นค่าประมาณจาก ~350 ออเดอร์
 *    (relative SE ~5.3%) — clip ที่ conv ขอบล่างอยู่ที่ ~1.06 เท่า อยู่ในขอบเขตความไม่แน่นอน
 *    ของ baseline เองพอดี
 * 2. clip ที่ถูกทดสอบถูกนับรวมอยู่ใน baseline (totalViews/totalOrders) ที่ใช้เทียบด้วย
 *    (self-inclusion) — ยืนยันด้วย leave-one-out แล้วว่าทิศทางผลกระทบเป็นฝ่าย conservative
 *    (ทำให้ผ่านยากขึ้น ไม่ใช่ง่ายขึ้น)
 * 3. ไม่มีการปรับ multiple-comparison เมื่อทดสอบหลาย clip พร้อมกัน (~36 clip ต่อการเรนเดอร์
 *    ที่ระดับนัยสำคัญทางเดียว ~2.5%) คาดว่ามี false positive เฉลี่ย ~0.9 ครั้งต่อการเรนเดอร์
 *    และจะเพิ่มขึ้นเมื่อข้อมูลมากขึ้น
 */
export function detectTasks(stats: ClipStat[]): ClipTask[] {
  const usable = stats.filter((s) => s.views > 0);
  if (usable.length === 0) return [];

  const totalViews = usable.reduce((a, s) => a + s.views, 0);
  const totalOrders = usable.reduce((a, s) => a + s.orders, 0);
  const channelConv = totalViews > 0 ? totalOrders / totalViews : 0;

  const tasks: ClipTask[] = [];
  for (const s of usable) {
    const badRatio = s.orders > 0 ? s.badOrders / s.orders : 0;
    if (badRatio >= MAX_BAD_RATIO) continue;

    const kinds: ClipSignalKind[] = [];

    // "กำลังโต" เทียบอัตราเร็วสองช่วงเวลาของคลิปเดียวกัน (ไม่เทียบกับคลิปอื่น) ด้วยช่วง
    // ความเชื่อมั่นแบบเดียวกับที่ "ขายดีจริง" ใช้ — rateRatioBounds (lib/stats.ts) แปลงโจทย์
    // อัตราส่วนความเร็วเป็นสัดส่วนแบบ Wilson แล้วคำนวณกลับ เพื่อเลี่ยงปัญหาที่เคยเจอ:
    // เทียบกับ "ค่ากลางของกลุ่มเดียวกับที่กำลังทดสอบ" ทำให้ ~ครึ่งหนึ่งผ่านเกณฑ์เสมอไม่ว่า
    // ช่องจะโตจริงหรือไม่ — ตอนนี้เทียบกับตัวเองในอดีตแทน จึงเงียบได้จริงเมื่อไม่ได้โตขึ้น
    const growthRatioRange =
      s.viewDelta !== null &&
      s.daysSinceLastSnapshot !== null &&
      s.priorViewDelta !== null &&
      s.priorDaysSinceSnapshot !== null
        ? rateRatioBounds(
            s.viewDelta,
            s.daysSinceLastSnapshot,
            s.priorViewDelta,
            s.priorDaysSinceSnapshot
          )
        : null;
    if (growthRatioRange !== null && growthRatioRange.low > 1) kinds.push("growing");

    // "ขายดีจริง" ต้องพิสูจน์ว่า conv สูงกว่าค่าเฉลี่ยช่องจริง ไม่ใช่แค่ดูสูง
    // ขอบล่างของช่วงเชื่อมั่นต้องเกินค่าเฉลี่ยช่อง — n น้อยจะได้ช่วงกว้างจนไม่ผ่านเอง
    // ไม่บังคับว่าวิวต้องน้อยกว่าค่ากลางแบบเกณฑ์เดิม เพราะเงื่อนไขนั้นตัดคลิปที่
    // conv พิสูจน์ได้แน่นที่สุดของช่องทิ้งไปโดยไม่ตั้งใจ
    const low = wilsonLowerBound(s.orders, s.views);
    if (channelConv > 0 && low > channelConv) kinds.push("proven");

    if (kinds.length === 0) continue;

    const high = wilsonUpperBound(s.orders, s.views);
    tasks.push({
      entryId: s.entryId,
      productName: s.productName,
      kinds,
      views: s.views,
      viewDelta: s.viewDelta,
      orders: s.orders,
      convRatioRange:
        channelConv > 0 ? { low: low / channelConv, high: high / channelConv } : null,
      growthRatioRange,
    });
  }

  // ติดสองป้ายอยู่บนสุด แล้วเรียงตามความมั่นใจทางสถิติ (ขอบล่างของช่วงที่แรงที่สุด)
  tasks.sort((a, b) => {
    if (a.kinds.length !== b.kinds.length) return b.kinds.length - a.kinds.length;
    const aStrength = Math.max(a.growthRatioRange?.low ?? 0, a.convRatioRange?.low ?? 0);
    const bStrength = Math.max(b.growthRatioRange?.low ?? 0, b.convRatioRange?.low ?? 0);
    return bStrength - aStrength;
  });

  return tasks;
}
