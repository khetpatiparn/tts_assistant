import { prisma } from "@/lib/prisma";
import { PromptWorkspace } from "@/components/prompt-workspace";
import { sortEntriesForRail } from "@/lib/entry-sort";
import { videoIdFromUrl } from "@/lib/affiliate";
import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;
const CLIP_AWAITING_THRESHOLD = 3;

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
  const [prompts, corePrompts, orders, clipMetrics] = await Promise.all([
    prisma.promptEntry.findMany({
      orderBy: { createdAt: "desc" },
      include: { productImages: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.corePrompt.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.affiliateOrder.findMany({ orderBy: { orderDate: "asc" } }),
    prisma.clipMetric.findMany({ orderBy: { capturedOn: "asc" } }),
  ]);

  // reminder: ผ่านไปกี่วันจาก import ล่าสุด (เก็บ Date จริงไว้ให้บรรทัดสถานะใน dashboard ด้วย)
  let daysSinceImport: number | null = null;
  let lastImportedAt: Date | null = null;
  if (orders.length > 0) {
    const last = Math.max(...orders.map((o) => o.importedAt.getTime()));
    lastImportedAt = new Date(last);
    daysSinceImport = daysSince(last);
  }

  // คลิปที่มี videoUrl แต่ยังไม่มีออเดอร์จับคู่
  const matchedEntryIds = new Set(
    orders.map((o) => o.matchedEntryId).filter((v): v is string => v !== null)
  );
  const awaitingClips = prompts
    .filter((p) => videoIdFromUrl(p.videoUrl) !== null && !matchedEntryIds.has(p.id))
    .map((p) => ({ id: p.id, productName: p.productName }));
  const clipsAwaitingRevenue = awaitingClips.length;

  // สินค้าที่ขายได้แต่ยังไม่มี entry (content id ที่จับคู่ไม่ได้)
  const unmatchedSoldProducts = new Set(
    orders.filter((o) => o.matchedEntryId === null).map((o) => o.contentId)
  ).size;

  const reminder: ReminderState = {
    daysSinceImport,
    clipsAwaitingRevenue,
    unmatchedSoldProducts,
  };

  const reminderActive =
    (daysSinceImport !== null && daysSinceImport > IMPORT_STALE_DAYS) ||
    clipsAwaitingRevenue >= CLIP_AWAITING_THRESHOLD ||
    unmatchedSoldProducts > 0;

  return (
    <PromptWorkspace
      prompts={sortEntriesForRail(prompts)}
      corePrompts={corePrompts}
      affiliateOrders={orders}
      clipMetrics={clipMetrics}
      reminder={reminder}
      reminderActive={reminderActive}
      awaitingClips={awaitingClips}
      lastImportedAt={lastImportedAt}
      now={currentTime()}
    />
  );
}
