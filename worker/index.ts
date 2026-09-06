/**
 * Flow image bot — โปรเซสแยกจาก Next.js คุยกันผ่านตาราง FlowJob/FlowWorkerState เท่านั้น
 * รัน: npm run flow-worker (หรือ flow-worker.bat) · หยุด: flow-worker-stop.bat (สร้างไฟล์ .flow-worker.stop
 * แล้ว worker จะจบหลังงานปัจจุบันเสร็จ — ไม่ฆ่ากลางคลิก)
 */
import "dotenv/config";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  FLOW_STATUS, WORKER_STATE_ID, candidateFilename, queuedStatus, reviewStatus, runningStatus, type FlowRound,
} from "@/lib/flow-jobs";
import { loadWorkerConfig, type WorkerConfig } from "./config";
import { launchFlowBrowser, openFlowAndSettle } from "./browser";
import { selectorSetForHost, type SelectorSet } from "./flow-selectors";
import { runRound } from "./flow-driver";
import { StepLog, captureFailure } from "./failure";
import { FlowStepError, isFlowStepError, type ErrorKind } from "./errors";
import { randInt, sleepMs } from "./humanize";
import { isWithinActiveHours, localDateKey, msUntilActiveWindow, pickLongBreakTarget } from "./schedule";
import type { Page } from "playwright";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const STOP_FILE = path.join(process.cwd(), ".flow-worker.stop");
const SLEEP_CHUNK_MS = 20_000;

function log(msg: string): void {
  console.log(`${new Date().toISOString()}  ${msg}`);
}

async function upsertState(data: Record<string, unknown>) {
  await prisma.flowWorkerState.upsert({
    where: { id: WORKER_STATE_ID },
    create: { id: WORKER_STATE_ID, ...data },
    update: data,
  });
}

async function readState() {
  return prisma.flowWorkerState.findUnique({ where: { id: WORKER_STATE_ID } });
}

function stopRequested(): boolean {
  return existsSync(STOP_FILE);
}

/** นอนเป็นช่วงสั้นๆ เพื่อให้ heartbeat/ตรวจ stop/ตรวจ pause ยังทำงานระหว่างพักยาว */
async function sleepUntil(target: number): Promise<void> {
  while (Date.now() < target) {
    if (stopRequested()) return;
    await sleepMs(Math.min(SLEEP_CHUNK_MS, target - Date.now()));
  }
}

async function pauseWorker(reason: ErrorKind): Promise<void> {
  await upsertState({ pausedReason: reason, pausedAt: new Date(), currentJobId: null, nextWakeAt: null });
}

/**
 * บันทึกว่างานนี้พังทันที — ใช้เฉพาะจุดที่ไม่มี page ให้ captureFailure เก็บหลักฐานได้
 * (claimNextJob เท่านั้น) ไม่ throw ต่อถ้าตัว update เองพังซ้อน กันพังซ้อนพังกลบสาเหตุจริง
 */
async function markJobFailedImmediately(jobId: string, e: unknown): Promise<void> {
  const message = e instanceof Error ? e.message : String(e);
  await prisma.flowJob
    .update({
      where: { id: jobId },
      data: { status: FLOW_STATUS.FAILED, failedStep: "unknown", errorKind: "worker_crash", errorMessage: message.slice(0, 2000) },
    })
    .catch((err) => log(`บันทึกงานพังไม่สำเร็จ (${jobId}): ${String(err)}`));
}

/** หยิบงาน: รอบ 2 ก่อน (คนรออยู่) แล้วค่อยรอบ 1 เรียงตามเวลาเข้าคิว — claim ด้วย updateMany กันหยิบซ้ำ */
async function claimNextJob() {
  for (const round of [2, 1] as FlowRound[]) {
    const candidate = await prisma.flowJob.findFirst({
      where: { status: queuedStatus(round) },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) continue;
    const claimed = await prisma.flowJob.updateMany({
      where: { id: candidate.id, status: queuedStatus(round) },
      data: { status: runningStatus(round), startedAt: new Date(), failedStep: "", errorKind: "", errorMessage: "", failureDir: "" },
    });
    if (claimed.count === 1) {
      try {
        return await prisma.flowJob.findUniqueOrThrow({ where: { id: candidate.id }, include: { entry: true, images: true } });
      } catch (e) {
        // claim สำเร็จ (running_*) แล้ว แต่ดึงรายละเอียดกลับไม่ได้ — บันทึกว่าพังทันที ไม่ปล่อยค้าง
        // running_* จนกว่า worker รอบหน้าจะมาเจอตอน stale sweep แล้วโยนต่อให้ main() หยุดคิวเหมือนเดิม
        await markJobFailedImmediately(candidate.id, e);
        throw e;
      }
    }
  }
  return null;
}

type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimNextJob>>>;

function referencePathFor(job: ClaimedJob): string {
  const dir = path.join(UPLOAD_ROOT, job.entryId, "flow");
  if (job.round === 1) {
    const src = job.images.filter((i) => i.kind === "source").sort((a, b) => a.index - b.index)[0];
    if (!src) throw new FlowStepError("open-flow", "worker_crash", "งานนี้ไม่มีรูปแคปต้นทาง");
    return path.join(dir, src.filename);
  }
  const chosen = job.images.find((i) => i.kind === "candidate" && i.round === 1 && i.chosen);
  if (!chosen) throw new FlowStepError("open-flow", "worker_crash", "งานนี้ยังไม่ได้เลือกรูปรอบ 1");
  return path.join(dir, chosen.filename);
}

async function processJob(page: Page, job: ClaimedJob, cfg: WorkerConfig, sel: SelectorSet, lastBatchAt: number): Promise<boolean> {
  const round = (job.round === 2 ? 2 : 1) as FlowRound;
  const outDir = path.join(UPLOAD_ROOT, job.entryId, "flow");
  const stepLog = new StepLog(true);

  try {
    // ย้าย mkdirSync/upsertState/log เข้ามาใน try ด้วย — ถ้าตัวใดตัวหนึ่งพัง (เช่น
    // upsertState ชน SQLITE_BUSY เพราะแอป Next.js ใช้ dev.db ไฟล์เดียวกัน) ต้องให้ catch
    // ด้านล่างบันทึกงานนี้เป็น failed ทันที ไม่ปล่อยค้าง running_* จนกว่า worker รอบหน้า
    // จะมาเจอตอน stale sweep
    mkdirSync(outDir, { recursive: true });
    await upsertState({ currentJobId: job.id, nextWakeAt: null });
    log(`เริ่มงาน ${job.id} (${job.entry.productName}) รอบ ${round} attempt ${job.attempt}`);

    const result = await runRound(
      page,
      {
        round,
        productName: job.entry.productName,
        referencePath: referencePathFor(job),
        outDir,
        filePrefix: `r${round}-a${job.attempt}`,
        // ถ้า spike (Task 5) พบว่ารอบ 2 เปิด project เดิมไม่ได้ ให้เปลี่ยนบรรทัดนี้เป็น null เสมอ
        projectId: job.flowProjectId || null,
      },
      cfg,
      sel,
      stepLog,
      // hook ทดสอบ fail-fast (S4) — ไม่ตั้ง env = ไม่มีผล
      { forceFailStep: process.env.FLOW_FORCE_FAIL_STEP }
    );

    await prisma.$transaction(async (tx) => {
      for (const [index, file] of result.files.entries()) {
        const ext = path.extname(file).slice(1) === "jpg" ? "jpg" : "png";
        await tx.flowJobImage.create({
          data: {
            jobId: job.id,
            kind: "candidate",
            round,
            attempt: job.attempt,
            index,
            filename: candidateFilename(round, job.attempt, index, ext),
            mimeType: ext === "jpg" ? "image/jpeg" : "image/png",
          },
        });
      }
      await tx.flowJob.update({
        where: { id: job.id },
        data: { status: reviewStatus(round), flowProjectId: result.projectId },
      });
    });
    log(`งาน ${job.id} รอบ ${round} เสร็จ → รอผู้ใช้เลือก`);
    return true;
  } catch (e) {
    const step = isFlowStepError(e) ? e.step : "unknown";
    const kind: ErrorKind = isFlowStepError(e) ? e.kind : "worker_crash";
    const message = e instanceof Error ? e.message : String(e);
    const state = await readState();
    const failureDirAbs = path.join(UPLOAD_ROOT, "_flow-failures", `${job.id}-${Date.now()}`);
    await captureFailure({
      page, dir: failureDirAbs, step, kind, message, log: stepLog,
      state: {
        jobId: job.id, round, attempt: job.attempt,
        todayBatches: state?.todayBatches ?? 0,
        sessionStreak: state?.sessionStreak ?? 0,
        msSinceLastBatch: lastBatchAt > 0 ? Date.now() - lastBatchAt : null,
      },
    });
    await prisma.flowJob.update({
      where: { id: job.id },
      data: {
        status: FLOW_STATUS.FAILED, failedStep: step, errorKind: kind, errorMessage: message.slice(0, 2000),
        failureDir: path.relative(process.cwd(), failureDirAbs).split(path.sep).join("/"),
      },
    });
    await pauseWorker(kind);
    log(`งาน ${job.id} พังที่ ${step} (${kind}) — หยุดทั้งคิว หลักฐาน: ${failureDirAbs}`);
    return false;
  }
}

async function main() {
  const cfg = loadWorkerConfig();
  if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);

  // งานที่ค้าง running_* = worker รอบก่อนตายกลางคัน → พัง ไม่ reset เป็น queued เอง (กัน loop)
  const stale = await prisma.flowJob.updateMany({
    where: { status: { in: [FLOW_STATUS.RUNNING_R1, FLOW_STATUS.RUNNING_R2] } },
    data: { status: FLOW_STATUS.FAILED, failedStep: "unknown", errorKind: "worker_crash", errorMessage: "worker ตายกลางคันในรอบก่อน" },
  });
  if (stale.count > 0) {
    await pauseWorker("worker_crash");
    log(`พบงานค้าง running ${stale.count} งาน → failed + หยุดคิว รอผู้ใช้กดรันต่อ`);
  }

  await upsertState({ lastSeenAt: new Date(), currentJobId: null });
  const heartbeat = setInterval(() => {
    upsertState({ lastSeenAt: new Date() }).catch((e) => log(`heartbeat ล้มเหลว: ${String(e)}`));
  }, cfg.heartbeatMs);

  const { context, page } = await launchFlowBrowser(cfg);
  let sel: SelectorSet;
  try {
    const { host } = await openFlowAndSettle(page, cfg);
    sel = selectorSetForHost(host);
    log(`เปิด Flow แล้ว host=${host} selectorSet=${sel.name}`);
  } catch (e) {
    await pauseWorker("host_unsupported");
    log(`เปิด Flow ไม่ได้: ${String(e)}`);
    clearInterval(heartbeat);
    await context.close();
    process.exit(1);
  }

  let longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
  let lastBatchAt = 0;

  while (!stopRequested()) {
    const state = await readState();
    const now = new Date();

    if (state?.pausedReason) {
      await sleepMs(cfg.pollIdleMs);
      continue;
    }
    if (state?.todayDate !== localDateKey(now)) {
      await upsertState({ todayDate: localDateKey(now), todayBatches: 0 });
      continue;
    }
    if (!isWithinActiveHours(now, cfg.activeHours)) {
      const wake = Date.now() + msUntilActiveWindow(now, cfg.activeHours as [string, string]);
      await upsertState({ nextWakeAt: new Date(wake) });
      await sleepUntil(Math.min(wake, Date.now() + 5 * 60_000));
      continue;
    }
    if ((state?.todayBatches ?? 0) >= cfg.dailyBatchCap) {
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      await upsertState({ nextWakeAt: midnight });
      await sleepUntil(Math.min(midnight.getTime(), Date.now() + 5 * 60_000));
      continue;
    }
    if ((state?.sessionStreak ?? 0) >= longBreakTarget) {
      const ms = randInt(cfg.longBreakMs);
      log(`พักยาว ${Math.round(ms / 60000)} นาที`);
      await upsertState({ nextWakeAt: new Date(Date.now() + ms), sessionStreak: 0 });
      await sleepUntil(Date.now() + ms);
      longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
      continue;
    }

    const job = await claimNextJob();
    if (!job) {
      await upsertState({ nextWakeAt: null });
      await sleepMs(cfg.pollIdleMs);
      continue;
    }

    const ok = await processJob(page, job, cfg, sel, lastBatchAt);
    if (!ok) continue;

    lastBatchAt = Date.now();
    await prisma.flowWorkerState.update({
      where: { id: WORKER_STATE_ID },
      data: { currentJobId: null, todayBatches: { increment: 1 }, sessionStreak: { increment: 1 } },
    });

    // betweenBatchesMs (config) ไม่ได้ใช้ตรงนี้โดยตั้งใจ — ตอนนี้มีแค่ 1 การส่งต่อสินค้าต่อรอบ
    // จึง betweenProductsMs ก็คุมช่วงพักได้ครบอยู่แล้ว คีย์นี้เตรียมไว้ให้ worker วิดีโอในอนาคต
    const pause = randInt(cfg.betweenProductsMs);
    await upsertState({ nextWakeAt: new Date(Date.now() + pause) });
    await sleepUntil(Date.now() + pause);
  }

  log("ได้รับคำสั่งหยุด — ปิด browser");
  clearInterval(heartbeat);
  await upsertState({ currentJobId: null, nextWakeAt: null });
  await context.close();
  if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);
}

main().catch(async (e) => {
  log(`worker ล้ม: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  await pauseWorker("worker_crash").catch(() => undefined);
  process.exit(1);
});
