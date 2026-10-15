import { prisma } from "@/lib/prisma";
import { parseStoredHashtags } from "@/lib/required-hashtag";

/**
 * แฮชแท็กที่ต้องลงต่อ sourceProductId · ไม่ส่ง productIds = ทั้งตาราง (หน้า Showcase) · มีแถวแต่รายการว่าง = ไม่ใส่ใน map
 * DB ที่ยังไม่ migrate (ไม่มีตาราง ProductHashtag) ต้องไม่ทำให้ /flow กับหน้า entry ล่ม — คืน map ว่างแทน
 * (แบบเดียวกับ FlowActivity ใน lib/flow-queries.ts)
 */
export async function loadHashtagsByProduct(productIds?: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (productIds !== undefined && productIds.length === 0) return map;
  const rows = await prisma.productHashtag
    .findMany({
      where: productIds === undefined ? undefined : { sourceProductId: { in: productIds } },
      orderBy: { updatedAt: "desc" },
      select: { sourceProductId: true, hashtags: true },
    })
    .catch((e: unknown) => {
      console.error("อ่าน ProductHashtag ไม่ได้ (ยังไม่ได้ migrate?):", e instanceof Error ? e.message : e);
      return [] as { sourceProductId: string; hashtags: string }[];
    });
  for (const r of rows) {
    const tags = parseStoredHashtags(r.hashtags);
    if (tags.length > 0) map.set(r.sourceProductId, tags);
  }
  return map;
}
