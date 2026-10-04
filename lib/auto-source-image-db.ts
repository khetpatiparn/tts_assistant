/**
 * รูปต้นทางอัตโนมัติในรูปสินค้า (ProductImage) ของ entry — ส่วนที่แตะ DB/ดิสก์ (กฎ + prefix อยู่ lib/auto-source-image.ts)
 * ห้าม import อะไรของ Next (ทดสอบด้วย tsx: scripts/check-product-image-source-db.ts) — ผู้เรียกทำ revalidatePath เอง
 * root = UPLOAD_ROOT ของ lib/upload-paths.ts เสมอในแอป (สคริปต์ทดสอบส่งโฟลเดอร์ชั่วคราว) · ต่อ path ด้วย joinPath ตามกฎ CLAUDE.md
 *
 * ลบแถวในทรานแซกชัน แต่ลบไฟล์ **หลัง commit** เท่านั้น (removeAutoSourceFiles) — ทรานแซกชันล้มแล้วรูปต้นทางต้องยังเปิดได้
 */
import { copyFile, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { AUTO_SOURCE_CAPTION, autoSourceFilename, isAutoSourceImage } from "@/lib/auto-source-image";
import { DEFAULT_CAPTIONS, type FlowRound } from "@/lib/flow-jobs";
import { joinPath } from "@/lib/upload-paths";

type Db = Prisma.TransactionClient;

function extFromMime(mime: string): "png" | "webp" | "jpg" {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

/** ลบแถวรูปต้นทางอัตโนมัติของ entry (กรองด้วย isAutoSourceImage ไม่ใช่ LIKE ของ SQLite ที่ไม่สนตัวพิมพ์) — คืนแถวที่ลบ */
async function deleteAutoSourceRows(db: Db, entryId: string): Promise<{ filename: string; sortOrder: number }[]> {
  const all = await db.productImage.findMany({ where: { entryId }, select: { id: true, filename: true, sortOrder: true } });
  const auto = all.filter((r) => isAutoSourceImage(r.filename));
  if (auto.length > 0) await db.productImage.deleteMany({ where: { id: { in: auto.map((r) => r.id) } } });
  return auto;
}

/** ลบไฟล์รูปต้นทางอัตโนมัติ — เฉพาะชื่อที่ผ่าน isAutoSourceImage ในโฟลเดอร์ของ entry เท่านั้น · ไฟล์หายไปแล้วไม่ถือว่าพัง */
export async function removeAutoSourceFiles(root: string, entryId: string, filenames: string[]): Promise<void> {
  for (const name of filenames) {
    if (!isAutoSourceImage(name)) continue;
    await unlink(joinPath(root, entryId, name)).catch(() => undefined);
  }
}

/**
 * เข้าคิว Flow (Showcase / หน้า entry) → รูปต้นทางเป็นรูปสินค้าของ entry ทันที · มีรูปต้นทางอัตโนมัติอยู่แล้ว = แทนแถวเดิม
 * (ตำแหน่งเดิม) ไม่เพิ่มซ้ำ · แถวอื่นไม่ถูกแตะ
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
      const old = await deleteAutoSourceRows(tx, entryId);
      const sortOrder = old[0]?.sortOrder ?? (await tx.productImage.count({ where: { entryId } }));
      await tx.productImage.create({ data: { entryId, filename, mimeType: image.mimeType, caption: AUTO_SOURCE_CAPTION, sortOrder } });
      return old;
    });
  } catch (err) {
    await unlink(dest).catch(() => undefined);
    throw err;
  }
  await removeAutoSourceFiles(root, entryId, removed.map((r) => r.filename));
}

/**
 * เลือกรูปรอบ 2 (ใน tx ของ chooseFlowCandidate) — ลบแถวรูปต้นทางอัตโนมัติ แล้วก๊อปรูปที่ Flow วาด (รอบ 1 + รอบ 2)
 * จาก `<entry>/flow/` เป็น ProductImage ต่อท้ายแถวที่เหลือ caption ตั้งต้นตาม DEFAULT_CAPTIONS
 * คืนชื่อไฟล์รูปต้นทางที่ลบแถวไปแล้ว — **ผู้เรียกลบไฟล์ด้วย removeAutoSourceFiles หลัง commit**
 * ก๊อปพังกลางทาง = ลบไฟล์ที่ก๊อปไปแล้วของรอบนี้ แล้ว throw (DB rollback ตาม tx)
 */
export async function replaceAutoSourceWithFlowImages(
  tx: Db,
  root: string,
  entryId: string,
  picks: { filename: string; mimeType: string; round: FlowRound }[],
): Promise<string[]> {
  const removed = await deleteAutoSourceRows(tx, entryId);
  const existingCount = await tx.productImage.count({ where: { entryId } });
  // ก๊อปไฟล์ไม่อยู่ใน transaction ของ DB — ถ้า copyFile ของ pick หลังพัง ต้องลบไฟล์ที่ก๊อป
  // สำเร็จไปแล้วของ pick ก่อนหน้าในความพยายามนี้เอง ไม่งั้นจะเหลือไฟล์ค้างดิสก์ที่ไม่มีอะไรอ้างอิง
  const copiedPaths: string[] = [];
  try {
    for (const [i, pick] of picks.entries()) {
      const ext = path.extname(pick.filename).slice(1) || "png";
      const filename = `${crypto.randomUUID()}.${ext}`;
      const destPath = joinPath(root, entryId, filename);
      await copyFile(joinPath(root, entryId, "flow", pick.filename), destPath);
      copiedPaths.push(destPath);
      await tx.productImage.create({
        data: { entryId, filename, mimeType: pick.mimeType, caption: DEFAULT_CAPTIONS[pick.round], sortOrder: existingCount + i },
      });
    }
  } catch (err) {
    // เก็บกวาดไฟล์ที่ก๊อปสำเร็จไปแล้วก่อนพัง — ล้มการเก็บกวาดเองก็ไม่ throw ทับ error เดิม
    for (const copiedPath of copiedPaths) await unlink(copiedPath).catch(() => undefined);
    throw err;
  }
  return removed.map((r) => r.filename);
}
