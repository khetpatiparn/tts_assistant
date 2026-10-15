/**
 * "เปลี่ยนรูปต้นทาง" ทั้งเส้น (DB + ไฟล์) — หน้า /flow (changeFlowSource) และ Showcase "เลือกรูปใหม่" (retryShowcasePhoto เมื่อมีงานอยู่แล้ว)
 * เรียกตัวนี้ตัวเดียว · ห้าม import อะไรของ Next (ทดสอบด้วย tsx: scripts/check-flow-lifecycle-db.ts บนสำเนา DB + โฟลเดอร์ชั่วคราว)
 * ผู้เรียกทำ FlowActivity / revalidatePath เอง · root = UPLOAD_ROOT ของ lib/upload-paths.ts เสมอในแอป
 *
 * ลำดับ: gate (changeSource) → ตรวจไฟล์ → เขียนไฟล์ชื่อไม่ซ้ำ → เขียน DB แบบมีเงื่อนไข (applyChangeSource) → ไม่สำเร็จ = ลบไฟล์ที่เพิ่งเขียน
 * → รูปต้นทางอัตโนมัติในหน้า entry เปลี่ยนตาม และรูปที่ Flow วาดจากรูปเก่าซึ่งเลือกรอบ 2 ไปแล้ว (auto-flow-) ออก
 *   (replaceAutoSourceImage — พังไม่ทำให้การเปลี่ยนรูปพัง เหมือนตอนเข้าคิว)
 * ไฟล์/แถว source และ candidate เก่าไม่ถูกแตะ (คลังรูป)
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { checkSourceImage } from "@/lib/flow-jobs";
import { CHANGE_SOURCE_RACE_MESSAGE, CHANGE_SOURCE_NEWER_JOB_MESSAGE, changeSource } from "@/lib/flow-lifecycle";
import { applyChangeSource, loadEntryFlowImages } from "@/lib/flow-lifecycle-db";
import { replaceAutoSourceImage } from "@/lib/auto-source-image-db";
import { joinPath } from "@/lib/upload-paths";

export type ChangeSourceResult =
  | { ok: true; entryId: string; fromStatus: string; fromRound: number; fromAttempt: number; attempt: number; extraPrompt: string; waitedFrom: Date }
  | { ok: false; message: string };

/** ไม่ throw กับกรณีที่ผู้ใช้ต้องรู้ผล (gate/ไฟล์ผิด/แข่งกับบอท) — ข้อความ throw ของ server action ถูกซ่อนใน production build */
export async function changeSourcePhoto(args: {
  root: string;
  jobId: string;
  image: { buffer: Buffer; mimeType: string };
  extraPrompt: unknown;
}): Promise<ChangeSourceResult> {
  const job = await prisma.flowJob.findUnique({ where: { id: args.jobId } });
  if (!job) return { ok: false, message: "ไม่พบงาน Flow" };
  let plan;
  try {
    // images = แถวรูปทุกงานของ entry — attempt ใหม่ต้องเกินของทุกงาน (โฟลเดอร์ flow/ ใช้ร่วมกัน งานที่เข้าคิวก่อนแก้ attempt ต่อเริ่ม a1 ซ้ำได้)
    plan = changeSource({ ...job, images: await loadEntryFlowImages(job.entryId) }, { extraPrompt: args.extraPrompt, mimeType: args.image.mimeType, nonce: crypto.randomUUID().slice(0, 8) });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "เปลี่ยนรูปต้นทางไม่ได้" };
  }
  const invalid = checkSourceImage({ mimeType: args.image.mimeType, size: args.image.buffer.length });
  if (invalid !== null) return { ok: false, message: invalid };

  const row = plan.createImages?.[0];
  if (!row) throw new Error("แผนเปลี่ยนรูปต้นทางไม่มีแถวรูป");
  const dir = joinPath(args.root, job.entryId, "flow");
  await mkdir(dir, { recursive: true });
  const dest = joinPath(dir, row.filename);
  await writeFile(dest, args.image.buffer);
  let outcome: Awaited<ReturnType<typeof applyChangeSource>>;
  try {
    outcome = await applyChangeSource(job.id, plan, job.status);
  } catch (e) {
    await unlink(dest).catch(() => undefined);
    throw e;
  }
  if (outcome !== "changed") {
    await unlink(dest).catch(() => undefined);
    return { ok: false, message: outcome === "newer_job" ? CHANGE_SOURCE_NEWER_JOB_MESSAGE : CHANGE_SOURCE_RACE_MESSAGE };
  }

  try {
    await replaceAutoSourceImage(args.root, job.entryId, args.image);
  } catch (err) {
    console.error("แทนรูปต้นทางในรูปสินค้าไม่สำเร็จ (เปลี่ยนรูปต้นทางของงานแล้ว):", err);
  }
  return {
    ok: true,
    entryId: job.entryId,
    fromStatus: plan.fromStatus,
    fromRound: plan.fromRound,
    fromAttempt: plan.fromAttempt,
    attempt: plan.attempt,
    extraPrompt: plan.job.extraPrompt ?? "",
    waitedFrom: job.updatedAt,
  };
}
