/**
 * เขียนแผนของ lib/flow-lifecycle.ts ลง DB — ที่เดียวที่เขียน FlowJob (และแถว FlowJobImage / การปลด pause ที่มากับจังหวะนั้น)
 * ใช้ได้ทั้ง server action (app/actions.ts) และบอท (worker/index.ts รันด้วย tsx) จึงห้าม import อะไรของ Next
 * (next/*, revalidatePath) — ผู้เรียกทำ revalidatePath / FlowActivity / แจ้งเตือน / ไฟล์บนดิสก์เอง
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { FINAL_VIDEO_FILENAME, WORKER_STATE_ID } from "@/lib/flow-jobs";
import { canRerenderWithPrompt, promptSaveGate, redo, type BulkPlan, type ImageRow, type JobPatch, type Plan } from "@/lib/flow-lifecycle";

type Db = Prisma.TransactionClient;

async function write(db: Db, jobId: string, plan: Plan): Promise<void> {
  if (plan.clearChosen) {
    await db.flowJobImage.updateMany({ where: { jobId, kind: "candidate", chosen: true }, data: { chosen: false } });
  }
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
    (plan.clearChosen ? 1 : 0) +
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

/**
 * เขียนแผน "ทำต่อเอง" แบบมีเงื่อนไข: อัปเดตเฉพาะถ้าสถานะยังเป็น fromStatus ตรงตัว (สถานะที่ผู้เรียกอ่านแล้วสร้างแผนจากมัน) —
 * แผนมีการปลดการหยุดเฉพาะตอนอ่านได้ failed จึงต้องตรงสถานะจริงเสมอ · ถ้าสถานะเปลี่ยนระหว่างอ่านกับเขียน
 * (บอทหยิบ queued_* → running_* หรือผู้ใช้อีกแท็บกด "รันต่อ") จะไม่มีแถวถูกแก้ คืน 0 และไม่ปลดการหยุดของบอท
 * (ผู้เรียกแปลง 0 เป็นข้อความไทย) · ปลดการหยุดอยู่ในทรานแซกชันเดียวกับการจบงาน
 */
export async function applyTakeOver(jobId: string, plan: Plan, fromStatus: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.flowJob.updateMany({
      where: { id: jobId, status: fromStatus },
      data: plan.job satisfies JobPatch,
    });
    if (res.count > 0 && plan.unpauseWorker) await unpauseWorker(tx);
    return res.count;
  });
}

/**
 * เขียนแผน "เปลี่ยนรูปต้นทาง" (changeSource) แบบมีเงื่อนไขในทรานแซกชันเดียว — แบบเดียวกับ applyTakeOver: อัปเดตเฉพาะถ้าสถานะยังเป็น
 * fromStatus ตรงตัว (บอทหยิบ queued_* → running_* หรืออีกแท็บกด "รันต่อ" ระหว่างอ่านกับเขียน = "status_changed" ไม่แตะอะไรเลย
 * ไม่ปลดการหยุด) · งานที่ถูกข้ามแต่ entry มีงานใหม่กว่าแล้ว = "newer_job" (ไม่เปิดงานเก่ากลับมาจน entry มีงานเปิดสองงาน)
 * "changed" = ล้าง chosen + สร้างแถว source ใหม่ + แพตช์งาน + ปลดการหยุด (ถ้าแผนสั่ง) ครบในทรานแซกชันเดียว · ไฟล์ผู้เรียกเขียนก่อน/ลบเองถ้าไม่ changed
 */
export async function applyChangeSource(
  jobId: string,
  plan: Plan,
  fromStatus: string,
): Promise<"changed" | "status_changed" | "newer_job"> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.flowJob.findUnique({ where: { id: jobId }, select: { entryId: true, createdAt: true } });
    if (!job) throw new Error("ไม่พบงาน Flow");
    const newer = await tx.flowJob.count({ where: { entryId: job.entryId, id: { not: jobId }, createdAt: { gt: job.createdAt } } });
    if (newer > 0) return "newer_job";
    const res = await tx.flowJob.updateMany({ where: { id: jobId, status: fromStatus }, data: plan.job satisfies JobPatch });
    if (res.count === 0) return "status_changed";
    await write(tx, jobId, { ...plan, unpauseWorker: false });
    if (plan.unpauseWorker) await unpauseWorker(tx);
    return "changed";
  });
}

export type PromptSaveResult = {
  /** false = สถานะของงานแก้พรอมต์ไม่ได้ (promptSaveGate "refused") — ไม่ได้เขียนอะไร */
  saved: boolean;
  /** บอทกำลังเรนเดอร์งานนี้ — พรอมต์บันทึกแล้วแต่รอบนี้ใช้ของเดิม */
  botRunning: boolean;
  /** ทำ transition เรนเดอร์ใหม่ในทรานแซกชันเดียวกับการบันทึกแล้ว */
  rerendered: boolean;
  /** สถานะของงาน "ก่อน" เขียน (อ่านใน transaction เดียวกับที่เขียน) */
  stage: string;
  round: number;
  entryId: string;
  lengthBefore: number;
  lengthAfter: number;
  /** ไฟล์คลิปตัวอย่างที่แถวถูกลบเพราะเรนเดอร์ใหม่ — ผู้เรียกลบไฟล์บนดิสก์เอง */
  videoFilenames: string[];
};

/**
 * บันทึก 10-part prompt (PromptEntry.chatgptOutput — ช่องเดียวกับหน้า entry) ของงาน Flow · อ่านงานและเขียนในทรานแซกชันเดียว
 * จึงตัดสินจากสถานะ "ตอนเขียน" ไม่ใช่สถานะที่หน้าจอเห็น: running_r3 → บันทึกแต่ไม่แตะงาน (botRunning) · สถานะที่แก้ไม่ได้ → ไม่เขียน
 * rerender + review_r3 → ใช้ redo() ชุดเดียวกับปุ่ม "เรนเดอร์ใหม่" (attempt+1, ลบแถวคลิปตัวอย่าง) ในทรานแซกชันนี้ ·
 * rerender แต่งานไม่ใช่ review_r3 แล้ว (อีกแท็บเรนเดอร์ไปก่อน) → บันทึกอย่างเดียว ไม่เรนเดอร์ซ้ำ
 */
export async function applyPromptSave(args: { jobId: string; text: string; rerender: boolean; extraPrompt?: string }): Promise<PromptSaveResult> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.flowJob.findUnique({ where: { id: args.jobId }, include: { images: true } });
    if (!job) throw new Error("ไม่พบงาน Flow");
    const base = { stage: job.status, round: job.round, entryId: job.entryId, videoFilenames: [] as string[] };
    const gate = promptSaveGate(job.status, job.round);
    const entry = await tx.promptEntry.findUniqueOrThrow({ where: { id: job.entryId }, select: { chatgptOutput: true } });
    const lengthBefore = entry.chatgptOutput.length;
    if (gate === "refused") {
      return { ...base, saved: false, botRunning: false, rerendered: false, lengthBefore, lengthAfter: lengthBefore };
    }
    await tx.promptEntry.update({ where: { id: job.entryId }, data: { chatgptOutput: args.text } });
    const result = { ...base, saved: true, botRunning: gate === "bot_running", rerendered: false, lengthBefore, lengthAfter: args.text.length };
    if (args.rerender && canRerenderWithPrompt(job.status)) {
      const plan = redo(job, args.extraPrompt);
      await write(tx, args.jobId, plan);
      return { ...result, rerendered: true, videoFilenames: job.images.filter((i) => i.kind === "video").map((i) => i.filename) };
    }
    return result;
  });
}

/** สร้างงานใหม่ (แผนจาก enqueue) — แถวรูปต้นทางเพิ่มทีหลังด้วย addImage หลังเขียนไฟล์แต่ละรูป */
export async function createJob(entryId: string, job: JobPatch & { status: string }): Promise<{ id: string; extraPrompt: string }> {
  return prisma.flowJob.create({ data: { entryId, ...job }, select: { id: true, extraPrompt: true } });
}

/**
 * แถวรูปของทุกงานใน entry (attempt ที่เคยใช้) — งานทุกตัวของ entry ใช้โฟลเดอร์ `flow/` เดียวกัน attempt ของชุดรูปใหม่จึงต้องเกิน
 * ของทุกงาน: เข้าคิวงานใหม่ (newJobAttempt) · เลือกรูปรอบ 1 → 2 (choose) · เปลี่ยนรูปต้นทาง (changeSource) ส่งตัวนี้เป็น images
 */
export async function loadEntryFlowImages(entryId: string, db: Db = prisma): Promise<{ kind: string; round: number; attempt: number }[]> {
  return db.flowJobImage.findMany({ where: { job: { entryId } }, select: { kind: true, round: true, attempt: true } });
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
