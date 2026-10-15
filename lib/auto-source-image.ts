/**
 * รูปสินค้า (ProductImage) ที่ Flow ใส่ให้ entry อัตโนมัติ — ระบุด้วย prefix ของชื่อไฟล์ (ไม่มีคอลัมน์ใหม่) มีสองแบบ:
 *   - รูปต้นทางอัตโนมัติ (`auto-source-`): เข้าคิว / เปลี่ยนรูปต้นทาง ใส่รูปต้นทางทันที
 *   - รูป Flow อัตโนมัติ (`auto-flow-`): เลือกรูปรอบ 2 ก๊อปรูปที่ Flow วาด 2 รูป (รูปที่เลือกรอบ 1 + รอบ 2)
 * เข้าคิว / เปลี่ยนรูปต้นทาง = รูปอัตโนมัติทั้งสองแบบออก รูปต้นทางใหม่เข้า · เลือกรอบ 2 = รูปอัตโนมัติทั้งสองแบบออก รูปที่ Flow วาด 2 รูปเข้า
 * แถวที่ไม่มี prefix (ผู้ใช้เพิ่มเอง / เพิ่มจากคลังรูป / รูปรอบ 2 ที่ก๊อปก่อนมี `auto-flow-` 2026-10-04) ไม่ถูกแตะอัตโนมัติเด็ดขาด
 * — รุ่นเก่าแยกจากรูปที่ผู้ใช้เพิ่มเองไม่ได้ (caption แก้ได้ เนื้อไฟล์ก็ตรงกับรูปที่เพิ่มจากคลังรูปได้) จึงปล่อยไว้ ผู้ใช้ลบเองในหน้า entry
 * ส่วนที่แตะ DB/ดิสก์อยู่ lib/auto-source-image-db.ts
 * ไฟล์นี้ pure (ทดสอบด้วย scripts/check-product-image-source.mjs) — ห้าม import อะไรที่แตะ DB/ดิสก์/Next
 */
import { currentSourceImage } from "@/lib/flow-jobs";

/** ชื่อไฟล์อื่นของ ProductImage คือ `<uuid>.<ext>` เสมอ (อัปโหลดเอง / เพิ่มจากคลังรูป / ทำซ้ำ entry) จึงไม่มีทางชนกัน */
export const AUTO_SOURCE_PREFIX = "auto-source-";
/** รูปที่ Flow วาดซึ่งเลือกรอบ 2 ก๊อปเข้ารูปสินค้า */
export const AUTO_FLOW_PREFIX = "auto-flow-";

/**
 * caption ตั้งต้นของรูปต้นทางอัตโนมัติ — **ถูกส่งให้ Gemini เป็นคำกำกับรูป** (interleave กับรูป ดู gemini-prompting.md)
 * รูปของร้านมักมีราคา/ข้อความโฆษณาทับ บอกไว้ว่าไม่ใช่ส่วนของสินค้า ไม่งั้นโมเดลบรรยายตัวหนังสือเป็นลายบนสินค้า
 * (ปัญหาเดียวกับที่ทำให้ต้องใช้รูปที่ Flow วาดแทนหลังเลือกรอบ 2) · ผู้ใช้แก้ caption ได้ในหน้า entry เหมือนรูปอื่น
 */
export const AUTO_SOURCE_CAPTION = "รูปสินค้าจริงจากร้าน (ราคา/ข้อความโฆษณาที่ร้านใส่ทับรูปไม่ใช่ส่วนของสินค้า)";

export function autoSourceFilename(ext: string): string {
  return `${AUTO_SOURCE_PREFIX}${crypto.randomUUID()}.${ext}`;
}

export function autoFlowFilename(ext: string): string {
  return `${AUTO_FLOW_PREFIX}${crypto.randomUUID()}.${ext}`;
}

/**
 * ใช้ตัดสินว่าลบแถว+ไฟล์ได้ จึงเข้มงวด: ขึ้นต้นด้วย prefix ตรงตัวพิมพ์ มีชื่อต่อท้าย และไม่มี path (`/` `\` `..`)
 * — ลบได้เฉพาะไฟล์นั้นตัวเดียวในโฟลเดอร์ของ entry
 */
function hasReservedPrefix(filename: string, prefix: string): boolean {
  return filename.startsWith(prefix) && filename.length > prefix.length && !/[\\/]/.test(filename) && !filename.includes("..");
}

/** รูปต้นทางอัตโนมัติ (เข้าคิว / เปลี่ยนรูปต้นทาง) */
export function isAutoSourceImage(filename: string): boolean {
  return hasReservedPrefix(filename, AUTO_SOURCE_PREFIX);
}

/** รูปที่ Flow วาดซึ่งเลือกรอบ 2 ก๊อปเข้ามาให้อัตโนมัติ */
export function isAutoFlowImage(filename: string): boolean {
  return hasReservedPrefix(filename, AUTO_FLOW_PREFIX);
}

/** รูปสินค้าที่ Flow ใส่ให้อัตโนมัติ (แบบไหนก็ได้) — แทนที่/ลบได้ · ที่เหลือคือของผู้ใช้ ห้ามแตะ */
export function isAutomaticProductImage(filename: string): boolean {
  return isAutoSourceImage(filename) || isAutoFlowImage(filename);
}

/**
 * สคริปต์ย้อนหลัง (scripts/backfill-short-names-and-photos.ts, ticket 07): งานที่เข้าคิวก่อนมีรูปต้นทางอัตโนมัติ (ticket 04)
 * ควรได้รูปไหน — งานยังเปิด (ไม่ใช่ done/skipped) · ยังไม่ได้เลือกรอบ 2 (เลือกแล้ว = รูปที่ Flow วาดเป็นรูปสินค้าแทนแล้ว ซึ่งรวม
 * awaiting_prompt และขั้น Render) · entry ยังไม่มีรูปต้นทางอัตโนมัติ (รันซ้ำไม่เพิ่ม) → รูปต้นทางปัจจุบันของงาน (currentSourceImage —
 * หลังเปลี่ยนรูปต้นทางคือแถวล่าสุด ไม่ใช่ index ต่ำสุด) · ไม่เข้าข่าย = null
 */
export function autoSourceBackfillPick(
  job: { status: string; images: { kind: string; round: number; attempt: number; index: number; chosen: boolean; filename: string; mimeType: string }[] },
  productImageFilenames: string[],
): { filename: string; mimeType: string } | null {
  if (job.status === "done" || job.status === "skipped") return null;
  if (job.images.some((i) => i.kind === "candidate" && i.round === 2 && i.chosen)) return null;
  if (productImageFilenames.some(isAutoSourceImage)) return null;
  const current = currentSourceImage(job.images);
  return current === null ? null : { filename: current.filename, mimeType: current.mimeType };
}
