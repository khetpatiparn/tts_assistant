/**
 * รูปอัตโนมัติในรูปสินค้า (ProductImage) ของ entry — รูปต้นทาง (`auto-source-`) และรูปที่ Flow วาดซึ่งเลือกรอบ 2 (`auto-flow-`)
 * ส่วนที่แตะ DB/ดิสก์ (กฎ + prefix อยู่ lib/auto-source-image.ts)
 * ห้าม import อะไรของ Next (ทดสอบด้วย tsx: scripts/check-product-image-source-db.ts) — ผู้เรียกทำ revalidatePath เอง
 * root = UPLOAD_ROOT ของ lib/upload-paths.ts เสมอในแอป (สคริปต์ทดสอบส่งโฟลเดอร์ชั่วคราว) · ต่อ path ด้วย joinPath ตามกฎ CLAUDE.md
 *
 * ลบแถวในทรานแซกชัน แต่ลบไฟล์ **หลัง commit** เท่านั้น (removeAutomaticImageFiles) — ทรานแซกชันล้มแล้วรูปเดิมต้องยังเปิดได้
 */
import { copyFile, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { AUTO_SOURCE_CAPTION, autoFlowFilename, autoSourceFilename, isAutomaticProductImage } from "@/lib/auto-source-image";
import { DEFAULT_CAPTIONS, type FlowRound } from "@/lib/flow-jobs";
import { joinPath } from "@/lib/upload-paths";

type Db = Prisma.TransactionClient;

function extFromMime(mime: string): "png" | "webp" | "jpg" {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

/**
 * ลบแถวรูปอัตโนมัติทั้งสองแบบของ entry (กรองด้วย isAutomaticProductImage ไม่ใช่ LIKE ของ SQLite ที่ไม่สนตัวพิมพ์)
 * — คืนแถวที่ลบ เรียงตาม sortOrder
 */
async function deleteAutomaticRows(db: Db, entryId: string): Promise<{ filename: string; sortOrder: number }[]> {
  const all = await db.productImage.findMany({ where: { entryId }, select: { id: true, filename: true, sortOrder: true }, orderBy: { sortOrder: "asc" } });
  const auto = all.filter((r) => isAutomaticProductImage(r.filename));
  if (auto.length > 0) await db.productImage.deleteMany({ where: { id: { in: auto.map((r) => r.id) } } });
  return auto;
}

/** ต่อท้ายรูปสินค้าของ entry = sortOrder สูงสุด + 1 (ไม่ใช่จำนวนแถว — ลบแถวกลางแล้ว sortOrder มีช่องว่าง นับแถวจะได้ค่าที่ชนแถวเดิม) */
export async function nextSortOrder(db: Db, entryId: string): Promise<number> {
  const agg = await db.productImage.aggregate({ where: { entryId }, _max: { sortOrder: true } });
  return agg._max.sortOrder === null ? 0 : agg._max.sortOrder + 1;
}

/** ลบไฟล์รูปอัตโนมัติ — เฉพาะชื่อที่ผ่าน isAutomaticProductImage ในโฟลเดอร์ของ entry เท่านั้น · ไฟล์หายไปแล้วไม่ถือว่าพัง */
export async function removeAutomaticImageFiles(root: string, entryId: string, filenames: string[]): Promise<void> {
  for (const name of filenames) {
    if (!isAutomaticProductImage(name)) continue;
    await unlink(joinPath(root, entryId, name)).catch(() => undefined);
  }
}

/**
 * เข้าคิว Flow (Showcase / หน้า entry) และเปลี่ยนรูปต้นทาง → รูปต้นทางเป็นรูปสินค้าของ entry ทันที · รูปอัตโนมัติเดิมทั้งสองแบบ
 * (รูปต้นทางเก่า / รูปที่ Flow วาดจากรูปต้นทางเก่าซึ่งเลือกรอบ 2 ไปแล้ว) ออก รูปใหม่เข้าที่ตำแหน่งของรูปอัตโนมัติแรก ไม่เพิ่มซ้ำ
 * · แถวที่ไม่มี prefix ไม่ถูกแตะ
 */
export async function replaceAutoSourceImage(
  root: string,
  entryId: string,
  image: { buffer: Buffer; mimeType: string },
): Promise<void> {
  const filename = autoSourceFilename(extFromMime(image.mimeType));
  await mkdir(path.join(root, entryId), { recursive: true });
  const dest = joinPath(root, entryId, filename);
  await writeFile(dest, image.buffer);
  let removed: { filename: string }[];
  try {
    removed = await prisma.$transaction(async (tx) => {
      const old = await deleteAutomaticRows(tx, entryId);
      const sortOrder = old[0]?.sortOrder ?? (await nextSortOrder(tx, entryId));
      await tx.productImage.create({ data: { entryId, filename, mimeType: image.mimeType, caption: AUTO_SOURCE_CAPTION, sortOrder } });
      return old;
    });
  } catch (err) {
    await unlink(dest).catch(() => undefined);
    throw err;
  }
  await removeAutomaticImageFiles(root, entryId, removed.map((r) => r.filename));
}

/**
 * เลือกรูปรอบ 2 (ใน tx ของ chooseFlowCandidate) — ลบแถวรูปอัตโนมัติทั้งสองแบบ (รูปต้นทาง + รูปที่ Flow วาดชุดก่อน) แล้วก๊อป
 * รูปที่ Flow วาด (รอบ 1 + รอบ 2) จาก `<entry>/flow/` เป็น ProductImage ชื่อ `auto-flow-…` ต่อท้ายแถวที่เหลือ caption ตั้งต้นตาม DEFAULT_CAPTIONS
 * คืนชื่อไฟล์ของแถวอัตโนมัติที่ลบไปแล้ว — **ผู้เรียกลบไฟล์ด้วย removeAutomaticImageFiles หลัง commit**
 * ก๊อปพังกลางทาง = ลบไฟล์ที่ก๊อปไปแล้วของรอบนี้ แล้ว throw (DB rollback ตาม tx)
 */
export async function replaceAutoSourceWithFlowImages(
  tx: Db,
  root: string,
  entryId: string,
  picks: { filename: string; mimeType: string; round: FlowRound }[],
): Promise<string[]> {
  const removed = await deleteAutomaticRows(tx, entryId);
  const start = await nextSortOrder(tx, entryId);
  // ก๊อปไฟล์ไม่อยู่ใน transaction ของ DB — ถ้า copyFile ของ pick หลังพัง ต้องลบไฟล์ที่ก๊อป
  // สำเร็จไปแล้วของ pick ก่อนหน้าในความพยายามนี้เอง ไม่งั้นจะเหลือไฟล์ค้างดิสก์ที่ไม่มีอะไรอ้างอิง
  const copiedPaths: string[] = [];
  try {
    for (const [i, pick] of picks.entries()) {
      const ext = path.extname(pick.filename).slice(1) || "png";
      const filename = autoFlowFilename(ext);
      const destPath = joinPath(root, entryId, filename);
      await copyFile(joinPath(root, entryId, "flow", pick.filename), destPath);
      copiedPaths.push(destPath);
      await tx.productImage.create({
        data: { entryId, filename, mimeType: pick.mimeType, caption: DEFAULT_CAPTIONS[pick.round], sortOrder: start + i },
      });
    }
  } catch (err) {
    // เก็บกวาดไฟล์ที่ก๊อปสำเร็จไปแล้วก่อนพัง — ล้มการเก็บกวาดเองก็ไม่ throw ทับ error เดิม
    for (const copiedPath of copiedPaths) await unlink(copiedPath).catch(() => undefined);
    throw err;
  }
  return removed.map((r) => r.filename);
}
