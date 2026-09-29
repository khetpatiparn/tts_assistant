import { prisma } from "@/lib/prisma";
import {
  buildShowcaseItems,
  SHOWCASE_TRACKING_SINCE,
  showcaseFlowState,
  type ShowcaseItem,
} from "@/lib/showcase";

/** หน้า Showcase — แถวจาก Showcase import เท่านั้น (sourceProductId ไม่ null) · ตรรกะอยู่ใน lib/showcase.ts */
export async function getShowcaseItems(): Promise<ShowcaseItem[]> {
  const rows = await prisma.productCandidate.findMany({
    // ตัดชุดก่อนวันเริ่มนับตั้งแต่ใน DB ไม่ได้ — สินค้าที่เห็นครั้งแรกก่อนวันนั้นแล้วถูกส่งซ้ำทีหลังต้องยังไม่นับ
    // buildShowcaseItems ต้องเห็นทุกแถวของ sourceProductId เดียวกันจึงตัดสินได้ถูก
    where: { sourceProductId: { not: null } },
    include: { images: { orderBy: { sortOrder: "asc" }, select: { id: true, filename: true } } },
  });

  const linkedIds = [...new Set(rows.flatMap((r) => (r.linkedEntryId === null ? [] : [r.linkedEntryId])))];
  const [entries, jobs] =
    linkedIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.promptEntry.findMany({ where: { id: { in: linkedIds } }, select: { id: true, videoUrl: true } }),
          prisma.flowJob.findMany({
            where: { entryId: { in: linkedIds } },
            orderBy: { createdAt: "desc" },
            select: { entryId: true, status: true, errorKind: true },
          }),
        ]);

  const items = buildShowcaseItems(
    rows.map((r) => ({
      id: r.id,
      sourceProductId: r.sourceProductId as string,
      name: r.name,
      price: r.price,
      commission: r.commission,
      capturedOn: r.capturedOn,
      linkedEntryId: r.linkedEntryId,
      dismissedAt: r.dismissedAt,
      images: r.images,
    })),
    new Map(entries.map((e) => [e.id, e.videoUrl])),
    SHOWCASE_TRACKING_SINCE
  );

  // งาน Flow ล่าสุดต่อ Entry (jobs เรียงใหม่→เก่า ตัวแรกที่เจอคือล่าสุด)
  const latestJob = new Map<string, { status: string; errorKind: string }>();
  for (const j of jobs) if (!latestJob.has(j.entryId)) latestJob.set(j.entryId, j);
  return items.map((i) =>
    i.status === "in_progress" && i.linkedEntryId !== null
      ? { ...i, flowState: showcaseFlowState(latestJob.get(i.linkedEntryId) ?? null) }
      : i
  );
}
