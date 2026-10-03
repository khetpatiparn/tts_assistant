import {
  REVENUE_RANGES,
  filterByRange,
  ordersByDay,
  revenueByClip,
  revenueTrend,
  summarizeOrders,
  unmatchedProducts,
  weeklyGmvTrend,
  type AffiliateOrderRecord,
  type RevenueRangeKey,
} from "@/lib/dashboard";
import { buildClipStats, detectTasks, type ClipMetricRecord, type ClipTask } from "@/lib/recommender";
import { repeatStatus, type RepeatStatus } from "@/lib/angle";
import { groupLatestRound, type ImportLogRecord, type RoundSummary } from "@/lib/import-log";

/**
 * ทุกอย่างที่หน้า /dashboard แสดง สรุปเสร็จแล้วฝั่ง server
 *
 * เดิมหน้านี้ส่งออเดอร์ดิบทั้งตาราง (~3,900 แถว) + ClipMetric + entry ลง client แล้วให้
 * เบราว์เซอร์คำนวณเอง (HTML ~3.7 MB) — ตอนนี้ client ได้เฉพาะ shape ที่หน้าจอใช้จริง
 * ตัวคำนวณยังเป็นฟังก์ชัน pure ตัวเดิมใน lib/dashboard.ts / lib/recommender.ts / lib/angle.ts /
 * lib/import-log.ts ไฟล์นี้แค่เรียกต่อกัน (ตรวจด้วย scripts/check-dashboard-view.ts)
 */
export type DashboardView = {
  summary: ReturnType<typeof summarizeOrders>;
  /** revenueByClip ทั้งหมด (ปุ่ม "ดูทั้งหมด" สลับฝั่ง client) */
  clips: ReturnType<typeof revenueByClip>;
  trend: ReturnType<typeof revenueTrend>;
  weekly: ReturnType<typeof weeklyGmvTrend>;
  /** กราฟรายวันคำนวณไว้ครบทุกช่วง — ปุ่มเลือกช่วงแค่สลับว่าโชว์อันไหน */
  daily: {
    key: RevenueRangeKey;
    label: string;
    points: ReturnType<typeof ordersByDay>;
  }[];
  unmatched: ReturnType<typeof unmatchedProducts>;
  recommendations: {
    tasks: (ClipTask & { repeat: RepeatStatus })[];
    /** คลิปที่มีข้อมูลวิว > 0 ที่ถูกตรวจ */
    checkedClips: number;
    /** entry ที่ยังไม่มีข้อมูลวิวเลย */
    missingMetrics: number;
    /** มี snapshot วิวอย่างน้อย 2 วัน — สัญญาณความเคลื่อนไหวใช้ได้ */
    hasDelta: boolean;
  };
  importRounds: RoundSummary[];
};

export function buildDashboardView(args: {
  orders: AffiliateOrderRecord[];
  clipMetrics: ClipMetricRecord[];
  importLogs: ImportLogRecord[];
  /** ลำดับมีผล: detectTasks เรียงแบบ stable ตัวที่คะแนนเท่ากันจึงคงลำดับ entry เดิม (sortEntriesForRail) */
  entries: {
    id: string;
    productName: string;
    duplicatedFromId: string | null;
    videoUrl: string;
    postedAt: Date | null;
  }[];
  now: Date;
}): DashboardView {
  const { orders, clipMetrics, importLogs, entries, now } = args;

  const stats = buildClipStats({ entries, metrics: clipMetrics, orders, now });
  const tasks = detectTasks(stats).map((t) => ({ ...t, repeat: repeatStatus(entries, t.entryId) }));

  const withMetrics = new Set(
    clipMetrics.filter((m) => m.matchedEntryId !== null).map((m) => m.matchedEntryId)
  );

  return {
    summary: summarizeOrders(orders),
    clips: revenueByClip(orders),
    trend: revenueTrend(orders),
    weekly: weeklyGmvTrend(orders, 8),
    daily: REVENUE_RANGES.map((r) => ({
      key: r.key,
      label: r.label,
      points: ordersByDay(filterByRange(orders, r.days)),
    })),
    unmatched: unmatchedProducts(orders),
    recommendations: {
      tasks,
      checkedClips: stats.filter((s) => s.views > 0).length,
      missingMetrics: entries.filter((e) => !withMetrics.has(e.id)).length,
      hasDelta:
        clipMetrics.length > 0 &&
        new Set(clipMetrics.map((m) => m.capturedOn.getTime())).size >= 2,
    },
    importRounds: groupLatestRound(importLogs),
  };
}
