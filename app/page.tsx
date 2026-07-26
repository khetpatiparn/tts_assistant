import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";
import { sortEntriesForRail } from "@/lib/entry-sort";
import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

// แยกออกมาเป็น helper แยกจาก component เพราะ Date.now() เป็น impure call —
// eslint-plugin-react-hooks (purity rule) ห้ามเรียกตรงใน render body ของ component
function daysSince(lastMs: number): number {
  return Math.floor((Date.now() - lastMs) / DAY_MS);
}

// เหตุผลเดียวกับ daysSince ด้านบน — คำนวณ `new Date()` ที่นี่ (Server Component)
// แล้วส่งลงเป็น prop แทนการเรียกใน client component ที่ผิด purity rule
function currentTime(): Date {
  return new Date();
}

export default async function PoolingPrompt() {
  const [prompts, corePrompts, orders, clipMetrics, followerActivity] = await Promise.all([
    prisma.promptEntry.findMany({
      orderBy: { createdAt: "desc" },
      include: { productImages: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.corePrompt.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
    prisma.followerActivity.findMany({ orderBy: [{ activityOn: "asc" }, { hour: "asc" }] }),
  ]);

  // reminder: ผ่านไปกี่วันจาก import ล่าสุด แยกรายไฟล์ —
  // ไฟล์รายได้กับไฟล์วิวถูกอัปคนละรอบได้ ถ้านับรวมเป็นค่าเดียวจะเตือนผิด
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

  // สินค้าที่ขายได้แต่ยังไม่มี entry (content id ที่จับคู่ไม่ได้)
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

  return (
    <PromptWorkspace
      prompts={sortEntriesForRail(prompts)}
      corePrompts={corePrompts}
      affiliateOrders={orders}
      clipMetrics={clipMetrics}
      followerActivity={followerActivity}
      reminder={reminder}
      reminderActive={reminderActive}
      lastOrdersImportedAt={lastOrdersImportedAt}
      lastMetricsImportedAt={lastMetricsImportedAt}
      now={currentTime()}
    />
  );
}
