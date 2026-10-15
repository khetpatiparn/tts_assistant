/**
 * อัปเกรดรูปของสินค้า Showcase ที่นำเข้าไปแล้วเป็นขนาดเต็ม (ก่อน 2026-09-29 Angle โหลดแต่ thumbnail 300px)
 * ใช้ไฟล์ JSON ที่ดาวน์โหลดจากหน้าจัดการของ Showcase Scanner (มีลิงก์รูปเดิมอยู่ — Angle ไม่ได้เก็บลิงก์ไว้)
 *
 * รัน:  npx tsx scripts/upgrade-showcase-images.ts <ไฟล์.json> [--dry-run]
 *
 * ทำอะไร: ทุกสินค้าในไฟล์ที่มีอยู่แล้วใน Angle (จับด้วย productId = sourceProductId เท่านั้น ไม่ใช้ชื่อ) → รูปลำดับที่ i
 * ของแต่ละแถวถูกแทนด้วยรูปขนาดเต็มของลิงก์ลำดับที่ i (ไฟล์ใหม่ + อัปเดตแถว CandidateImage แล้วลบไฟล์เก่า)
 * โหลดขนาดเต็มไม่ได้ = คงรูปเดิมไว้ ไม่ลบอะไร · ไม่แตะสินค้าที่ไม่มีในไฟล์ · รันซ้ำได้ (รอบสองแค่โหลดทับด้วยรูปเดิม)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { downloadImage } from "@/lib/showcase-images";
import { originalImageUrl } from "@/lib/showcase-import";
import { CANDIDATE_IMAGE_ROOT, joinPath } from "@/lib/upload-paths";

type ExportFile = { products?: { productId?: string; imageUrls?: string[] }[] };

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!file) throw new Error("ใส่ path ของไฟล์ JSON ที่ดาวน์โหลดจาก extension");
  const payload = JSON.parse(readFileSync(file, "utf8")) as ExportFile;
  const products = (payload.products ?? []).filter((p) => p.productId && (p.imageUrls?.length ?? 0) > 0);
  console.log(`ไฟล์มีสินค้า ${products.length} ตัวที่มีลิงก์รูป${dryRun ? " (ทดลอง ไม่เขียนอะไร)" : ""}`);

  let upgraded = 0;
  let kept = 0;
  let notInAngle = 0;
  for (const p of products) {
    const rows = await prisma.productCandidate.findMany({
      where: { sourceProductId: p.productId },
      include: { images: { orderBy: { sortOrder: "asc" } } },
    });
    if (rows.length === 0) {
      notInAngle++;
      continue;
    }
    for (const row of rows) {
      for (const [i, img] of row.images.entries()) {
        const url = p.imageUrls![i];
        if (!url) continue;
        if (dryRun) {
          upgraded++;
          continue;
        }
        const downloaded = await downloadImage(originalImageUrl(url));
        if (!downloaded) {
          kept++;
          continue;
        }
        const filename = `${crypto.randomUUID()}.${downloaded.ext}`;
        await writeFile(joinPath(CANDIDATE_IMAGE_ROOT, row.id, filename), downloaded.buffer);
        await prisma.candidateImage.update({
          where: { id: img.id },
          data: { filename, mimeType: `image/${downloaded.ext === "jpg" ? "jpeg" : downloaded.ext}` },
        });
        await unlink(path.join(CANDIDATE_IMAGE_ROOT, row.id, img.filename)).catch(() => {});
        upgraded++;
      }
    }
    console.log(`  ${p.productId}: เสร็จ`);
  }
  console.log(`\nอัปเกรด ${upgraded} รูป · คงรูปเดิม (โหลดขนาดเต็มไม่ได้) ${kept} · สินค้าที่ไม่มีใน Angle ${notInAngle}`);
}

main()
  .catch((e) => {
    console.error("ไม่สำเร็จ:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
