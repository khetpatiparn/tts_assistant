/**
 * คลังรูปของ entry — ส่วนที่อ่าน DB/ดิสก์ (ตรรกะเรียง/ป้าย/ธงอยู่ lib/photo-library.ts) และ "เพิ่มเข้ารูปสินค้า"
 * ห้าม import อะไรของ Next (ทดสอบด้วย tsx: scripts/check-flow-lifecycle-db.ts หัวข้อ "คลังรูป" บนสำเนา DB + โฟลเดอร์ชั่วคราว)
 * root = UPLOAD_ROOT ของ lib/upload-paths.ts เสมอในแอป · ต่อ path ด้วย joinPath ตามกฎ CLAUDE.md
 *
 * "เนื้อไฟล์ตรงกัน" (ธงรูปต้นทาง / อยู่ในรูปสินค้าแล้ว) อ่านขนาดไฟล์ทุกตัวก่อน แล้วค่อยแฮชเฉพาะไฟล์ที่ขนาดชนกับไฟล์ที่เทียบ
 * (รูปต้นทาง + รูปสินค้า — ไม่กี่ไฟล์) — หน้า entry ไม่ต้องอ่านรูปที่ Flow วาดทุกรูปทั้งไฟล์ทุกครั้งที่เปิด
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { checkSourceImage, imageExtFromMime } from "@/lib/flow-jobs";
import { getShopPhotosByEntry } from "@/lib/flow-queries";
import { nextSortOrder } from "@/lib/auto-source-image-db";
import { buildPhotoLibrary, libraryFilePaths, productImagePath, type PhotoLibrary } from "@/lib/photo-library";
import { UPLOAD_ROOT, joinPath } from "@/lib/upload-paths";

/** path สัมพัทธ์ (คั่นด้วย "/") → path จริงใต้ root */
function abs(root: string, relPath: string): string {
  return joinPath(root, ...relPath.split("/"));
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

async function sha1(path: string): Promise<string | null> {
  try {
    return createHash("sha1").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * content key ต่อไฟล์: ไฟล์ที่ขนาดไม่ชนกับไฟล์ฝั่งตรงข้าม = `s<ขนาด>` (เท่ากับใครไม่ได้อยู่แล้วเพราะขนาดต่าง) ·
 * ขนาดชน = `s<ขนาด>:<sha1>` ทั้งสองฝั่ง · ไฟล์ไม่มีบนดิสก์ = ไม่มี key
 */
async function contentKeys(root: string, items: string[], targets: string[]): Promise<Map<string, string>> {
  const all = [...new Set([...items, ...targets])];
  const sizes = new Map<string, number>();
  await Promise.all(
    all.map(async (p) => {
      const size = await sizeOf(abs(root, p));
      if (size !== null) sizes.set(p, size);
    }),
  );
  const itemSizes = new Set(items.map((p) => sizes.get(p)).filter((s) => s !== undefined));
  const targetSizes = new Set(targets.map((p) => sizes.get(p)).filter((s) => s !== undefined));
  const keys = new Map<string, string>();
  await Promise.all(
    [...sizes].map(async ([p, size]) => {
      if (!(itemSizes.has(size) && targetSizes.has(size))) {
        keys.set(p, `s${size}`);
        return;
      }
      const hash = await sha1(abs(root, p));
      if (hash !== null) keys.set(p, `s${size}:${hash}`);
    }),
  );
  return keys;
}

/** คลังรูปของ entry (หน้า entry) — ดู lib/photo-library.ts */
export async function getPhotoLibrary(entryId: string, root: string = UPLOAD_ROOT): Promise<PhotoLibrary> {
  const [shopByEntry, jobs, productImages] = await Promise.all([
    getShopPhotosByEntry([entryId]),
    prisma.flowJob.findMany({
      where: { entryId },
      select: {
        id: true, status: true, round: true, createdAt: true,
        images: { select: { id: true, kind: true, round: true, attempt: true, index: true, filename: true, chosen: true, createdAt: true } },
      },
    }),
    prisma.productImage.findMany({ where: { entryId }, select: { filename: true } }),
  ]);
  const base = {
    entryId,
    shopPhotos: shopByEntry.get(entryId) ?? [],
    jobs,
    productImageFilenames: productImages.map((p) => p.filename),
  };
  const paths = libraryFilePaths(base);
  return buildPhotoLibrary({ ...base, contentKeys: await contentKeys(root, paths.items, paths.targets) });
}

/**
 * "เพิ่มเข้ารูปสินค้า" จากคลังรูป — ไฟล์ (ครอปแล้วหรือทั้งรูป) เป็นรูปสินค้าแบบเดียวกับที่ผู้ใช้อัปเอง: `<uuid>.<ext>` ในโฟลเดอร์ของ entry
 * caption ว่าง ต่อท้าย · **ไม่ใช้ prefix สงวนของรูปอัตโนมัติ** (เข้าคิว/เลือกรอบ 2/เปลี่ยนรูปต้นทางไม่แตะรูปนี้)
 * เนื้อไฟล์ตรงกับรูปสินค้าที่มีอยู่แล้ว = ไม่เพิ่มซ้ำ (กดสองครั้ง / รูปที่ขึ้นป้าย "อยู่ในรูปสินค้าแล้ว")
 * ไม่ throw กับกรณีที่ผู้ใช้ต้องรู้ผล — ข้อความ throw ของ server action ถูกซ่อนใน production build
 */
export async function addPhotoToProductImages(args: {
  root: string;
  entryId: string;
  image: { buffer: Buffer; mimeType: string };
}): Promise<{ ok: true; filename: string } | { ok: false; message: string }> {
  const { root, entryId, image } = args;
  const entry = await prisma.promptEntry.findUnique({ where: { id: entryId }, select: { id: true } });
  if (!entry) return { ok: false, message: "ไม่พบรายการ" };
  const invalid = checkSourceImage({ mimeType: image.mimeType, size: image.buffer.length });
  if (invalid !== null) return { ok: false, message: invalid };

  const existing = await prisma.productImage.findMany({ where: { entryId }, select: { filename: true } });
  const hash = createHash("sha1").update(image.buffer).digest("hex");
  for (const p of existing) {
    const path = abs(root, productImagePath(entryId, p.filename));
    if ((await sizeOf(path)) === image.buffer.length && (await sha1(path)) === hash) {
      return { ok: false, message: "รูปนี้อยู่ในรูปสินค้าแล้ว — ไม่ได้เพิ่มซ้ำ" };
    }
  }

  const filename = `${crypto.randomUUID()}.${imageExtFromMime(image.mimeType)}`;
  await mkdir(joinPath(root, entryId), { recursive: true });
  const dest = joinPath(root, entryId, filename);
  await writeFile(dest, image.buffer);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.productImage.create({
        data: { entryId, filename, mimeType: image.mimeType, caption: "", sortOrder: await nextSortOrder(tx, entryId) },
      });
    });
  } catch (err) {
    await unlink(dest).catch(() => undefined);
    throw err;
  }
  return { ok: true, filename };
}
