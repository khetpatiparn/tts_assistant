import { prisma } from "@/lib/prisma";
import { sortEntriesForRail } from "@/lib/entry-sort";
import { entryStatus, type EntryRow } from "@/lib/entry-rows";
import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";
import { collectFamily, collectUsedAngles, summarizeEntryOutcome } from "@/lib/angle";
import type { UsedAngleWithOutcome } from "@/components/angle-panel";

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

/**
 * ข้อความที่ใช้ค้นหา — คิวรีแยกและเรียกเฉพาะตอนมีคำค้นจริงเท่านั้น
 *
 * productInfo หนักราว 2 KB/แถว (~3.6 MB ที่ 1,800 แถว) แต่อยู่ในหน่วยความจำ server
 * เท่านั้น ไม่ได้ถูกส่งลง client — client ได้แค่ 30 แถวเบาของหน้านั้น
 * ถ้าวันหนึ่งช้าเกินไป ทางแก้คือ SQLite FTS5 ไม่ใช่การเปลี่ยนดีไซน์
 */
export async function getSearchText(): Promise<
  Map<string, { productName: string; productInfo: string; extraNotes: string }>
> {
  const rows = await prisma.promptEntry.findMany({
    select: { id: true, productName: true, productInfo: true, extraNotes: true },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        productName: r.productName,
        productInfo: r.productInfo,
        extraNotes: r.extraNotes,
      },
    ])
  );
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

export type EntryDetail = NonNullable<Awaited<ReturnType<typeof getEntryDetail>>>;

/** entry ตัวเดียวแบบเต็ม (รวม chatgptOutput) — โหลดเฉพาะตัวที่เปิดอยู่เท่านั้น */
export async function getEntryDetail(id: string) {
  return prisma.promptEntry.findUnique({
    where: { id },
    include: { productImages: { orderBy: { sortOrder: "asc" } } },
  });
}

/**
 * angle ที่เคยใช้กับสินค้าเดียวกัน พร้อมผลลัพธ์ของแต่ละ angle
 *
 * คำนวณฝั่ง server ทั้งหมดเพื่อไม่ต้องส่ง affiliateOrders กับ clipMetrics ลง client —
 * ผลลัพธ์คือ angle ไม่กี่ตัว ส่วนวัตถุดิบคือทั้งตาราง
 *
 * จับกลุ่ม "สินค้าเดียวกัน" ด้วยสายเลือด duplicatedFromId ไม่ใช่ชื่อสินค้า
 * (dev.db มีสินค้าคนละชิ้นที่ชื่อซ้ำกัน จับด้วยชื่อจะเอา angle ของสินค้าอื่นมาปน)
 */
export async function getUsedAngles(entryId: string): Promise<UsedAngleWithOutcome[]> {
  const [lineageRows, withOutput, orders, metrics] = await Promise.all([
    prisma.promptEntry.findMany({
      select: {
        id: true,
        duplicatedFromId: true,
        angle: true,
        videoUrl: true,
        postedAt: true,
      },
    }),
    prisma.promptEntry.findMany({
      where: { NOT: { chatgptOutput: "" } },
      select: { id: true },
    }),
    prisma.affiliateOrder.findMany(),
    prisma.clipMetric.findMany(),
  ]);

  const hasOutputIds = new Set(withOutput.map((r) => r.id));
  // collectUsedAngles อ่าน chatgptOutput เพื่อข้าม "ร่างเปล่า" เท่านั้น จึงเติมค่าตัวแทน
  // ที่ว่าง/ไม่ว่างให้ตรงความจริงพอ ไม่ต้องโหลดข้อความจริง 8.7 KB ต่อแถว
  const lineage = lineageRows.map((r) => ({
    ...r,
    chatgptOutput: hasOutputIds.has(r.id) ? "x" : "",
  }));

  const family = collectFamily(lineage, entryId);
  return collectUsedAngles(family, entryId).map((u) => ({
    ...u,
    outcome: summarizeEntryOutcome({ entryId: u.entryId, orders, metrics }),
  }));
}

/** default ของ toggle "ตั้งเวลาโพสต์" = แบบที่ผู้ใช้ทำบ่อยกว่า */
export async function getDefaultScheduled(): Promise<boolean> {
  const [posted, scheduled] = await Promise.all([
    prisma.promptEntry.count({ where: { NOT: { videoUrl: "" } } }),
    prisma.promptEntry.count({
      where: { NOT: { videoUrl: "" }, isScheduledPost: true },
    }),
  ]);
  if (posted === 0) return false;
  return scheduled > posted / 2;
}
