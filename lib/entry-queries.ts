import { prisma } from "@/lib/prisma";
import { sortEntriesForRail } from "@/lib/entry-sort";
import { entryStatus, type EntryRow } from "@/lib/entry-rows";
import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ฟิลด์ที่ดึงมาทำแถวเบา — ห้ามเพิ่ม chatgptOutput / productInfo / productSpec /
 * riskModule / caption / hashtags เข้ามา (ดูคอมเมนต์ที่ EntryRow ใน lib/entry-rows.ts)
 */
const ROW_SELECT = {
  id: true,
  productName: true,
  angle: true,
  videoUrl: true,
  postedAt: true,
  createdAt: true,
  duplicatedFromId: true,
  postedTimeOfDay: true,
  postedTimeSource: true,
  isScheduledPost: true,
  productImages: {
    select: { filename: true },
    orderBy: { sortOrder: "asc" },
    take: 1,
  },
} as const;

/**
 * แถวเบาทุกแถว เรียงตามลำดับเดียวกับแถบข้างเดิม (ยังไม่ลงคลิปบนสุด แล้วใหม่ไปเก่า)
 *
 * ทำสองคิวรี: อันแรกเอาฟิลด์ที่ต้องแสดง อันที่สองเอาแค่ id ของแถวที่มี chatgptOutput
 * เพื่อรู้สถานะโดยไม่ต้องโหลดข้อความ 8.7 KB/แถวมาทั้งก้อน
 */
export async function getEntryRows(): Promise<EntryRow[]> {
  const [rows, withOutput] = await Promise.all([
    prisma.promptEntry.findMany({ select: ROW_SELECT }),
    prisma.promptEntry.findMany({
      where: { NOT: { chatgptOutput: "" } },
      select: { id: true },
    }),
  ]);

  const hasOutputIds = new Set(withOutput.map((r) => r.id));

  return sortEntriesForRail(rows).map((r) => ({
    id: r.id,
    productName: r.productName,
    angle: r.angle,
    videoUrl: r.videoUrl,
    postedAt: r.postedAt,
    createdAt: r.createdAt,
    duplicatedFromId: r.duplicatedFromId,
    status: entryStatus({ hasOutput: hasOutputIds.has(r.id), videoUrl: r.videoUrl }),
    thumbnailFilename: r.productImages[0]?.filename ?? null,
    postedTimeOfDay: r.postedTimeOfDay,
    postedTimeSource: r.postedTimeSource,
    isScheduledPost: r.isScheduledPost,
  }));
}

function daysSince(lastMs: number): number {
  return Math.floor((Date.now() - lastMs) / DAY_MS);
}

/** ข้อมูลทั้งหมดที่หน้า /dashboard ใช้ — ย้ายมาจาก app/page.tsx เดิมทั้งดุ้น */
export async function getDashboardData() {
  const [orders, clipMetrics, followerActivity] = await Promise.all([
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
    prisma.followerActivity.findMany({
      orderBy: [{ activityOn: "asc" }, { hour: "asc" }],
    }),
  ]);

  let daysSinceOrdersImport: number | null = null;
  let lastOrdersImportedAt: Date | null = null;
  if (orders.length > 0) {
    const last = Math.max(...orders.map((o) => o.importedAt.getTime()));
    lastOrdersImportedAt = new Date(last);
    daysSinceOrdersImport = daysSince(last);
  }

  let daysSinceMetricsImport: number | null = null;
  let lastMetricsImportedAt: Date | null = null;
  if (clipMetrics.length > 0) {
    const last = Math.max(...clipMetrics.map((m) => m.importedAt.getTime()));
    lastMetricsImportedAt = new Date(last);
    daysSinceMetricsImport = daysSince(last);
  }

  const unmatchedSoldProducts = new Set(
    orders.filter((o) => o.matchedEntryId === null).map((o) => o.contentId)
  ).size;

  const reminder: ReminderState = {
    daysSinceOrdersImport,
    daysSinceMetricsImport,
    unmatchedSoldProducts,
  };

  const reminderActive =
    (daysSinceOrdersImport !== null && daysSinceOrdersImport > IMPORT_STALE_DAYS) ||
    (daysSinceMetricsImport !== null && daysSinceMetricsImport > IMPORT_STALE_DAYS) ||
    unmatchedSoldProducts > 0;

  return {
    orders,
    clipMetrics,
    followerActivity,
    reminder,
    reminderActive,
    lastOrdersImportedAt,
    lastMetricsImportedAt,
  };
}
