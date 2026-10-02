/**
 * เขียนแผนของ lib/flow-lifecycle.ts ลง DB — ที่เดียวที่เขียน FlowJob (และแถว FlowJobImage / การปลด pause ที่มากับจังหวะนั้น)
 * ใช้ได้ทั้ง server action (app/actions.ts) และบอท (worker/index.ts รันด้วย tsx) จึงห้าม import อะไรของ Next
 * (next/*, revalidatePath) — ผู้เรียกทำ revalidatePath / FlowActivity / แจ้งเตือน / ไฟล์บนดิสก์เอง
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { FINAL_VIDEO_FILENAME, WORKER_STATE_ID } from "@/lib/flow-jobs";
import type { BulkPlan, ImageRow, JobPatch, Plan } from "@/lib/flow-lifecycle";

type Db = Prisma.TransactionClient;

async function write(db: Db, jobId: string, plan: Plan): Promise<void> {
  if (plan.markChosen) {
    await db.flowJobImage.updateMany({
      where: { jobId, kind: "candidate", round: plan.markChosen.round },
      data: { chosen: false },
    });
    await db.flowJobImage.update({ where: { id: plan.markChosen.imageId }, data: { chosen: true } });
  }
  if (plan.deleteVideoRows) await db.flowJobImage.deleteMany({ where: { jobId, kind: "video" } });
  for (const row of plan.createImages ?? []) await db.flowJobImage.create({ data: { jobId, ...row } });
  if (plan.finalizeVideoRowId !== undefined) {
    await db.flowJobImage.update({ where: { id: plan.finalizeVideoRowId }, data: { filename: FINAL_VIDEO_FILENAME, chosen: true } });
  }
  await db.flowJob.update({ where: { id: jobId }, data: plan.job });
  if (plan.unpauseWorker) await unpauseWorker(db);
}

/** จำนวนคำสั่งเขียนของแผน — มากกว่า 1 = ต้องอยู่ในทรานแซกชันเดียว */
function writeCount(plan: Plan): number {
  return (
    1 +
    (plan.markChosen ? 2 : 0) +
    (plan.deleteVideoRows ? 1 : 0) +
    (plan.createImages?.length ?? 0) +
    (plan.finalizeVideoRowId !== undefined ? 1 : 0) +
    (plan.unpauseWorker ? 1 : 0)
  );
}

/**
 * เขียนแผนของงานเดียว · tx = อยู่ในทรานแซกชันของผู้เรียกแล้ว (เช่น chooseFlowCandidate ที่สร้าง ProductImage ในทรานแซกชันเดียวกัน)
 * ไม่ส่ง tx และมีหลายคำสั่ง = เปิดทรานแซกชันเอง (ล้มกลางทาง = ไม่มีอะไรถูกเขียน)
 */
export async function applyPlan(jobId: string, plan: Plan, tx?: Db): Promise<void> {
  if (tx !== undefined) return write(tx, jobId, plan);
  if (writeCount(plan) === 1) return write(prisma, jobId, plan);
  await prisma.$transaction((t) => write(t, jobId, plan));
}

/** เขียนแผนแบบมีเงื่อนไข (updateMany) ในขอบเขตที่ผู้เรียกระบุ — คืนจำนวนงานที่เปลี่ยน (0 = ไม่มีงานเข้าเงื่อนไข/มีคนหยิบไปก่อน) */
export async function applyBulk(bulk: BulkPlan, scope: { id?: string; entryId?: string } = {}): Promise<number> {
  const { status, ...rest } = bulk.where;
  const res = await prisma.flowJob.updateMany({
    where: { ...scope, ...rest, status: Array.isArray(status) ? { in: status } : status },
    data: bulk.job satisfies JobPatch,
  });
  return res.count;
}

/** สร้างงานใหม่ (แผนจาก enqueue) — แถวรูปต้นทางเพิ่มทีหลังด้วย addImage หลังเขียนไฟล์แต่ละรูป */
export async function createJob(entryId: string, job: JobPatch & { status: string }): Promise<{ id: string; extraPrompt: string }> {
  return prisma.flowJob.create({ data: { entryId, ...job }, select: { id: true, extraPrompt: true } });
}

export async function addImage(jobId: string, row: ImageRow): Promise<void> {
  await prisma.flowJobImage.create({ data: { jobId, ...row } });
}

/** ปลดการหยุดของบอท — หลังผู้ใช้ "รันต่อ"/"ข้าม"/ปิดงานพัง หรือบอทเปิดใหม่แล้วกู้คืนได้เอง */
export async function unpauseWorker(db: Db = prisma): Promise<void> {
  await db.flowWorkerState.upsert({
    where: { id: WORKER_STATE_ID },
    create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
    update: { pausedReason: "", pausedAt: null },
  });
}
