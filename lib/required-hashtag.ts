/**
 * แฮชแท็กที่ต้องลง (Required hashtag — CONTEXT.md) · pure ไม่แตะ DB ไม่ import อะไร
 * ตรวจด้วย node scripts/check-required-hashtag.mjs
 *
 * ผู้ใช้พิมพ์ข้อความเดียว ("#trendyselected #อื่น") ได้รายการแฮชแท็กที่เก็บต่อสินค้า · เก็บใน DB เป็นข้อความคั่นด้วย
 * ช่องว่าง (แฮชแท็กไม่มีช่องว่างอยู่แล้ว) · ใส่ใหม่ = ทับของเดิม · ปล่อยว่างไม่ใช่การลบ (ลบมีปุ่มของตัวเอง)
 */

export const MAX_HASHTAGS = 10;
/** นับรวม # */
export const MAX_HASHTAG_LENGTH = 100;

export type HashtagParse = { ok: true; tags: string[] } | { ok: false; message: string };

/**
 * ตัวแยก = ช่องว่าง/ขึ้นบรรทัด/แท็บ และจุลภาค (ทั้ง , และ ，) · แต่ละก้อนแตกต่อที่ # (พิมพ์ติดกัน #a#b = 2 อัน)
 * ก้อนที่ไม่มี # นำหน้าเติมให้ · ซ้ำกันโดยไม่สนตัวพิมพ์ = เหลืออันเดียว ตำแหน่งของที่พิมพ์ก่อน ตัวพิมพ์ของที่พิมพ์ทีหลัง
 * ไม่มีสักอัน = ปฏิเสธ (ห้ามกลายเป็นการลบเงียบๆ)
 */
export function normalizeHashtags(input: string): HashtagParse {
  const order: string[] = [];
  const shown = new Map<string, string>();
  for (const token of input.split(/[\s,，]+/)) {
    for (const piece of token.split("#")) {
      if (piece === "") continue;
      const tag = `#${piece}`;
      if ([...tag].length > MAX_HASHTAG_LENGTH) {
        return { ok: false, message: `แฮชแท็กยาวเกิน ${MAX_HASHTAG_LENGTH} ตัวอักษร: ${[...tag].slice(0, 20).join("")}…` };
      }
      const key = tag.toLowerCase();
      if (!shown.has(key)) order.push(key);
      shown.set(key, tag);
    }
  }
  if (order.length === 0) {
    return { ok: false, message: "พิมพ์แฮชแท็กอย่างน้อย 1 อัน — ถ้าต้องการลบ ให้กดปุ่ม \"ลบแฮชแท็ก\"" };
  }
  if (order.length > MAX_HASHTAGS) {
    return { ok: false, message: `ใส่ได้ไม่เกิน ${MAX_HASHTAGS} อันต่อสินค้า` };
  }
  return { ok: true, tags: order.map((k) => shown.get(k) as string) };
}

/** รูปแบบที่เก็บใน DB */
export function serializeHashtags(tags: string[]): string {
  return tags.join(" ");
}

export function parseStoredHashtags(stored: string): string[] {
  return stored.split(/\s+/).filter((t) => t !== "");
}

/**
 * ตัวเลือกให้กดแทนการพิมพ์ใหม่ — อันที่สินค้าใช้อยู่บ่อยสุดก่อน (เท่ากัน = ที่เจอก่อน) นับต่างตัวพิมพ์เป็นอันเดียว
 * ไม่มีตารางรายการแยก: คิดจากที่สินค้าถืออยู่ตอนนี้เท่านั้น
 */
export function suggestHashtags(all: string[][], limit = 8): string[] {
  const counts = new Map<string, { tag: string; n: number }>();
  for (const tags of all) {
    for (const tag of tags) {
      const key = tag.toLowerCase();
      const cur = counts.get(key);
      if (cur === undefined) counts.set(key, { tag, n: 1 });
      else cur.n++;
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((c) => c.tag);
}

/**
 * แฮชแท็กของแต่ละ entry ผ่านสินค้า Showcase ที่ผูกอยู่ (entry → sourceProductId มาจาก getProductIdsByEntry)
 * entry ที่ไม่ได้มาจาก Showcase หรือสินค้าไม่มีแฮชแท็ก = ไม่อยู่ในผลลัพธ์ (หน้าจอไม่ต้องแสดงอะไร)
 */
export function hashtagsForEntries(
  productIdByEntry: Map<string, string>,
  tagsByProduct: Map<string, string[]>
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [entryId, productId] of productIdByEntry) {
    const tags = tagsByProduct.get(productId);
    if (tags !== undefined && tags.length > 0) map.set(entryId, tags);
  }
  return map;
}
