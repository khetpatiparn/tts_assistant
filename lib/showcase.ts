/**
 * ตรรกะของหน้า Showcase (pure — ไม่แตะ DB) · คำศัพท์ดู CONTEXT.md หัวข้อ Showcase
 *
 * Showcase = รายการงานที่ต้องทำ: เพิ่มสินค้าเข้า Showcase ใน TikTok แปลว่าจะทำคลิปแน่นอน
 * สถานะคิดจากข้อมูลที่มีอยู่แล้วทั้งหมด ผู้ใช้ไม่ต้องติ๊กเอง ยกเว้น "ไม่ทำแล้ว"
 */
import { canChangeSource } from "@/lib/flow-lifecycle";

/**
 * สินค้าที่เข้ามาก่อนวันนี้ไม่นับเป็นงาน — ชุดแรก 197 ตัว (24 ก.ย.) ดึงมาทั้ง Showcase รวมตัวที่ทำคลิปไปแล้ว
 * ด้วยวิธีเดิมซึ่งระบบไม่มีทางรู้ ผู้ใช้เลือกให้เริ่มนับใหม่จากชุดที่เข้ามาหลังเปิดใช้หน้านี้ (2026-09-29)
 */
export const SHOWCASE_TRACKING_SINCE = new Date("2026-09-29T00:00:00+07:00");

export type ShowcaseStatus = "todo" | "in_progress" | "posted" | "dismissed";

/**
 * สถานะงาน Flow ล่าสุดของ Entry ที่ผูกอยู่ — ใช้ตัดสินว่าโชว์ปุ่ม "เลือกรูปใหม่" ได้ไหม · กติกาเดียวกับ "เปลี่ยนรูปต้นทาง" ของหน้า /flow
 * (canChangeSource ใน lib/flow-lifecycle.ts) — มีงานอยู่แล้ว = เปลี่ยนรูปต้นทางของงานเดิม ไม่สร้างงานใหม่ (ticket 05)
 * - `retry`   = ไม่มีงาน Flow (สร้างงานใหม่) / ถูกข้าม / Flow วาดไม่สำเร็จเอง (flow_error) รอบ 1–2 → ป้ายแดง + ปุ่ม
 * - `change`  = งานยังเปิดอยู่ก่อนเริ่มเรนเดอร์ (รอวาด/รอเลือกรูป/รอพรอมต์/รอคิวเรนเดอร์) → ปุ่มเฉยๆ ไม่มีป้ายแดง
 * - `blocked` = พังด้วยเหตุผลอื่น (captcha/login/selector ฯลฯ) → ต้องไปจัดการที่หน้าคิว Flow ก่อน
 *   **ห้ามเปิดทางลัดให้ captcha** เพราะการส่งรูปใหม่เท่ากับเข้าคิวใหม่ทันที (และปลดการหยุดของบอท) ข้ามกฎพัก 1 ชั่วโมง
 *   รวมถึง**งาน Render/โหลด 1080p (round 3-4) ที่พังทุกกรณี** แม้เป็น flow_error — เริ่มเรนเดอร์แล้ว ทางที่ถูกคือ "รันต่อ"/"ทำต่อเอง" ที่หน้าคิว Flow
 * - `busy`    = บอทกำลังทำ / เริ่มเรนเดอร์แล้ว / เสร็จแล้ว → ไม่มีปุ่ม
 */
export type ShowcaseFlowState = "retry" | "change" | "blocked" | "busy";

export function showcaseFlowState(
  latestJob: { status: string; errorKind: string; round: number } | null
): ShowcaseFlowState {
  if (latestJob === null) return "retry";
  if (latestJob.status === "failed") {
    if (latestJob.round >= 3) return "blocked";
    return latestJob.errorKind === "flow_error" ? "retry" : "blocked";
  }
  if (!canChangeSource(latestJob.status, latestJob.round)) return "busy";
  return latestJob.status === "skipped" ? "retry" : "change";
}

/** รูปจากร้าน 1 รูป — ไฟล์อยู่ uploads/_candidates/<candidateId>/<filename> */
export type ShopPhoto = { id: string; candidateId: string; filename: string };

/**
 * รูปจากร้าน (Shop photos) ของ entry — ตัวเลือกรูปต้นทางของหน้า /flow · สินค้าที่ผูกกับ entry (linkedEntryId) ต่อ sourceProductId
 * ใช้รูปชุดเดียว (สแกนซ้ำ = หลายแถวมีรูปชุดเดียวกัน): แถวที่ผูกและมีรูปชนะ ไม่งั้นแถวเก่าสุดของสินค้าเดียวกันที่มีรูป
 * @param rows แถวของสินค้าที่ผูกกับ entry และแถวอื่นที่ sourceProductId เดียวกัน (ผู้เรียกคิวรีมา)
 */
export function shopPhotosForEntry(
  rows: { id: string; sourceProductId: string; linkedEntryId: string | null; capturedOn: Date; images: { id: string; filename: string }[] }[],
  entryId: string,
): ShopPhoto[] {
  const products = [...new Set(rows.filter((r) => r.linkedEntryId === entryId).map((r) => r.sourceProductId))];
  return products.flatMap((pid) => {
    const withImages = rows
      .filter((r) => r.sourceProductId === pid && r.images.length > 0)
      .sort((a, b) =>
        Number(b.linkedEntryId === entryId) - Number(a.linkedEntryId === entryId) || a.capturedOn.getTime() - b.capturedOn.getTime(),
      );
    const best = withImages[0];
    return best === undefined ? [] : best.images.map((im) => ({ id: im.id, candidateId: best.id, filename: im.filename }));
  });
}

export const SHOWCASE_STATUS_LABEL: Record<ShowcaseStatus, string> = {
  todo: "ยังไม่เริ่ม",
  in_progress: "กำลังทำ",
  posted: "โพสต์แล้ว",
  dismissed: "ไม่ทำแล้ว",
};

export type ShowcaseSourceRow = {
  id: string;
  sourceProductId: string;
  name: string;
  price: number;
  commission: number;
  capturedOn: Date;
  linkedEntryId: string | null;
  dismissedAt: Date | null;
  images: { id: string; filename: string }[];
};

export type ShowcaseItem = {
  /** แถวที่ใช้แทนสินค้าตัวนี้ (มีรูป/ผูกงาน) — action ทุกตัวอ้าง id นี้ */
  id: string;
  sourceProductId: string;
  name: string;
  price: number;
  commission: number;
  /** ครั้งแรกที่สินค้าตัวนี้เข้ามาใน Angle — ใช้เรียง "ค้างนานสุดขึ้นก่อน" */
  firstSeen: Date;
  linkedEntryId: string | null;
  images: { id: string; filename: string }[];
  status: ShowcaseStatus;
  /** มีความหมายเฉพาะ status "in_progress" — เติมทีหลังโดยผู้เรียก (ต้องอ่าน FlowJob) ค่าเริ่มต้น busy */
  flowState: ShowcaseFlowState;
  /** แฮชแท็กที่ต้องลง (CONTEXT.md) ของสินค้านี้ · ว่าง = ไม่ต้องลงอะไร */
  hashtags: string[];
};

export function showcaseStatus(
  row: { linkedEntryId: string | null; dismissedAt: Date | null },
  entryVideoUrl: string | undefined
): ShowcaseStatus {
  // ผูกงานแล้วชนะ "ไม่ทำแล้ว" — งานที่สร้างไปแล้วคืองานจริง ไม่ควรหายไปอยู่แท็บเลิกทำ
  if (row.linkedEntryId !== null) {
    return entryVideoUrl !== undefined && entryVideoUrl.trim() !== "" ? "posted" : "in_progress";
  }
  return row.dismissedAt !== null ? "dismissed" : "todo";
}

/**
 * สินค้าตัวเดียวอยู่ได้หลายชุด (ล้างความจำของ extension แล้วสแกนใหม่ = ส่ง ID เดิมมาอีก) — ยุบเหลือแถวเดียว
 * ต่อ sourceProductId: แถวที่ผูกงานแล้วชนะ รองลงมาคือแถวที่มีรูป แล้วจึงแถวเก่าสุด
 * สินค้าที่เห็นครั้งแรกก่อน SHOWCASE_TRACKING_SINCE ถูกตัดทิ้งทั้งตัว แม้จะถูกส่งซ้ำมาหลังวันนั้น
 *
 * @param entryVideoUrls videoUrl ของ Entry ที่ผูกอยู่ (key = entry id) — Entry ที่ถูกลบไปแล้วจะไม่มี key
 * @param hashtagsByProduct แฮชแท็กที่ต้องลงต่อ sourceProductId (ผู้เรียกอ่านจากตาราง ProductHashtag) — ผูกกับสินค้า
 *   ไม่ใช่แถว จึงเหมือนกันทุกชุดที่ส่งซ้ำ
 */
export function buildShowcaseItems(
  rows: ShowcaseSourceRow[],
  entryVideoUrls: Map<string, string>,
  since: Date = SHOWCASE_TRACKING_SINCE,
  hashtagsByProduct: Map<string, string[]> = new Map()
): ShowcaseItem[] {
  const byProduct = new Map<string, ShowcaseSourceRow[]>();
  for (const r of rows) {
    const list = byProduct.get(r.sourceProductId);
    if (list === undefined) byProduct.set(r.sourceProductId, [r]);
    else list.push(r);
  }

  const items: ShowcaseItem[] = [];
  for (const [sourceProductId, group] of byProduct) {
    const firstSeen = new Date(Math.min(...group.map((r) => r.capturedOn.getTime())));
    if (firstSeen.getTime() < since.getTime()) continue;

    const rank = (r: ShowcaseSourceRow): number =>
      (r.linkedEntryId !== null ? 2 : 0) + (r.images.length > 0 ? 1 : 0);
    const best = [...group].sort(
      (a, b) => rank(b) - rank(a) || a.capturedOn.getTime() - b.capturedOn.getTime()
    )[0];
    // Entry ที่ถูกลบไปแล้ว = ลิงก์ค้าง ถือว่ายังไม่ได้ผูกงาน สินค้ากลับไปเป็นงานที่ต้องทำ
    const linkedEntryId =
      best.linkedEntryId !== null && entryVideoUrls.has(best.linkedEntryId) ? best.linkedEntryId : null;
    // "ไม่ทำแล้ว" เซ็ตทุกแถวของสินค้าพร้อมกัน แต่ชุดที่ส่งซ้ำมาทีหลังจะมีแถวใหม่ที่ยังว่าง — แถวไหนเซ็ตไว้ก็นับ
    const dismissedAt = group.find((r) => r.dismissedAt !== null)?.dismissedAt ?? null;

    items.push({
      id: best.id,
      sourceProductId,
      name: best.name,
      price: best.price,
      commission: best.commission,
      firstSeen,
      linkedEntryId,
      images: best.images,
      status: showcaseStatus(
        { linkedEntryId, dismissedAt },
        linkedEntryId === null ? undefined : entryVideoUrls.get(linkedEntryId)
      ),
      flowState: "busy",
      hashtags: hashtagsByProduct.get(sourceProductId) ?? [],
    });
  }

  return items;
}

/** ยังไม่เริ่ม = คิวงาน ค้างนานสุดขึ้นก่อน · แท็บอื่นเป็นประวัติ ใหม่สุดขึ้นก่อน */
export function itemsForTab(items: ShowcaseItem[], status: ShowcaseStatus): ShowcaseItem[] {
  const direction = status === "todo" ? 1 : -1;
  return items
    .filter((i) => i.status === status)
    .sort((a, b) => direction * (a.firstSeen.getTime() - b.firstSeen.getTime()));
}
