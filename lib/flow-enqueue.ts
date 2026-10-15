/**
 * เข้าคิว Flow ทั้งเส้น (DB + ไฟล์) — enqueueFlowJobCore ของ app/actions.ts (หน้า entry, Showcase "ทำคลิปตัวนี้"/"เลือกรูปใหม่"
 * ตอนยังไม่มีงาน) เรียกตัวนี้ตัวเดียว · ห้าม import อะไรของ Next (ทดสอบด้วย tsx: scripts/check-flow-lifecycle-db.ts บนสำเนา DB +
 * โฟลเดอร์ชั่วคราว) · ผู้เรียกทำ FlowActivity / revalidatePath เอง · root = UPLOAD_ROOT ของ lib/upload-paths.ts เสมอในแอป
 *
 * attempt แรกของงานใหม่ต่อจากทุกแถวรูปของ entry (newJobAttempt) — งานทุกตัวของ entry ใช้โฟลเดอร์ flow/ เดียวกัน
 * งานใหม่ที่เริ่ม a1 จะเขียนทับรูป r1-a1-* ของงานก่อน (รูปในคลังรูปหาย)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { FLOW_STATUS, checkSourceImage, imageExtFromMime, sourceFilename } from "@/lib/flow-jobs";
import { enqueue, newJobAttempt } from "@/lib/flow-lifecycle";
import { addImage, createJob, loadEntryFlowImages } from "@/lib/flow-lifecycle-db";
import { replaceAutoSourceImage } from "@/lib/auto-source-image-db";
import { joinPath } from "@/lib/upload-paths";

/** throw ข้อความไทย (ผู้เรียกโชว์ตรงๆ) — ไม่มีรายการ / ไม่มีชื่อสินค้า / มีงานค้าง / ไม่มีรูป / รูปผิดชนิดหรือใหญ่เกิน */
export async function enqueueFlowJobFiles(args: {
  root: string;
  entryId: string;
  images: { buffer: Buffer; mimeType: string }[];
  extraPrompt: unknown;
}): Promise<{ jobId: string; attempt: number; extraPrompt: string }> {
  const { root, entryId, images } = args;
  if (!entryId) throw new Error("ไม่พบรายการที่ต้องการเข้าคิว Flow");
  const entry = await prisma.promptEntry.findUnique({ where: { id: entryId }, select: { id: true, productName: true } });
  if (!entry) throw new Error("ไม่พบรายการที่ต้องการเข้าคิว Flow");
  if (entry.productName.trim() === "") throw new Error("ต้องมีชื่อสินค้าก่อน (พรอมต์ของ Flow ใช้ชื่อสินค้า)");

  const open = await prisma.flowJob.findFirst({
    where: { entryId, status: { notIn: [FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED] } },
    select: { id: true },
  });
  if (open) throw new Error("รายการนี้มีงาน Flow ค้างอยู่แล้ว");

  if (images.length === 0) throw new Error("กรุณาเลือกรูปแคปสินค้าอย่างน้อย 1 รูป");
  for (const img of images) {
    const invalid = checkSourceImage({ mimeType: img.mimeType, size: img.buffer.length });
    if (invalid !== null) throw new Error(invalid);
  }

  const dir = joinPath(root, entryId, "flow");
  await mkdir(dir, { recursive: true });

  const attempt = newJobAttempt(await loadEntryFlowImages(entryId));
  // nonce: ชื่อไฟล์รูปต้นทางไม่ซ้ำข้ามงานของ entry เดียวกันแม้ attempt จะชนกับแถวรุ่นเก่า
  const nonce = crypto.randomUUID().slice(0, 8);
  const plan = enqueue(
    args.extraPrompt,
    images.map((img, index) => ({ filename: sourceFilename(attempt, index, imageExtFromMime(img.mimeType), nonce), mimeType: img.mimeType })),
    attempt,
  );
  const job = await createJob(entryId, plan.job);
  for (const [index, img] of images.entries()) {
    const row = plan.sourceRows[index];
    await writeFile(joinPath(dir, row.filename), img.buffer);
    await addImage(job.id, row);
  }

  // รูปต้นทาง (รูปแรก) เป็นรูปสินค้าของ entry ทันที ทำเองได้เลยไม่ต้องรอ Flow — เข้าคิวซ้ำแทนรูปอัตโนมัติเดิม เลือกรอบ 2 แทนด้วยรูปที่
  // Flow วาด (lib/auto-source-image-db.ts) · งานเข้าคิวสำเร็จไปแล้ว ขั้นนี้พังห้ามทำให้เข้าคิวพัง ผู้ใช้อัปรูปเองที่หน้า entry ได้
  try {
    await replaceAutoSourceImage(root, entryId, images[0]);
  } catch (err) {
    console.error("ใส่รูปต้นทางเข้ารูปสินค้าไม่สำเร็จ (งาน Flow เข้าคิวแล้ว):", err);
  }
  return { jobId: job.id, attempt, extraPrompt: job.extraPrompt };
}
