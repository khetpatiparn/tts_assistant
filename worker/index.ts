/**
 * Flow image bot — โปรเซสแยกจาก Next.js คุยกันผ่านตาราง FlowJob/FlowWorkerState เท่านั้น
 * รัน: npm run flow-worker (หรือ flow-worker.bat) · หยุด: flow-worker-stop.bat (สร้างไฟล์ .flow-worker.stop
 * แล้ว worker จะจบหลังงานปัจจุบันเสร็จ — ไม่ฆ่ากลางคลิก)
 */
import "dotenv/config";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  ERROR_KIND_LABELS, FINAL_VIDEO_FILENAME, FINAL_VIDEO_PREFIX, FLOW_STATUS, WORKER_STATE_ID,
  claimOrder, queuedStatus, toJobRound, type JobRound,
} from "@/lib/flow-jobs";
import {
  claim, claimCrashed, finalClipMissing, finalClipSaved, finalClipUnsaved, imagesReady, loginRecovered, previewReady,
  previewUnsaved, roundFailed, staleRender, staleRunning, staleUpscale,
} from "@/lib/flow-lifecycle";
import { applyBulk, applyPlan, unpauseWorker } from "@/lib/flow-lifecycle-db";
import { loadWorkerConfig, type WorkerConfig } from "./config";
import { hasSignInButton, launchFlowBrowser, openFlowAndSettle } from "./browser";
import { notify } from "./notify";
import { logActivity } from "./activity";
import { selectorSetForHost, type SelectorSet } from "./flow-selectors";
import { drawImages, fetchFinalClip, renderClip, type FlowContext, type OutputFiles } from "./flow-driver";
import { StepLog, captureFailure } from "./failure";
import { FlowStepError, isFlowStepError, type ErrorKind } from "./errors";
import { randInt, sleepMs } from "./humanize";
import { idleCountsAsLongBreak, isWithinActiveHours, localDateKey, msUntilActiveWindow, pickLongBreakTarget } from "./schedule";
import type { Page } from "playwright";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const STOP_FILE = path.join(process.cwd(), ".flow-worker.stop");
const SLEEP_CHUNK_MS = 20_000;
/** ภาพจุดเช็กของงาน (uploads/<entryId>/flow/checkpoints/) เก็บไว้กี่วัน — หลักฐานตอนพังเก็บถาวรแยกกันเหมือนเดิม */
const CHECKPOINT_KEEP_DAYS = 14;

/** ลบภาพจุดเช็กเก่าเกิน CHECKPOINT_KEEP_DAYS — แตะแค่ไฟล์ในโฟลเดอร์ checkpoints/ เท่านั้น ห้ามพังการเปิดบอท */
function sweepOldCheckpoints(): void {
  const cutoff = Date.now() - CHECKPOINT_KEEP_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    for (const entry of readdirSync(UPLOAD_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const dir = path.join(UPLOAD_ROOT, entry.name, "flow", "checkpoints");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        const file = path.join(dir, f);
        if (f.endsWith(".jpg") && statSync(file).mtimeMs < cutoff) {
          unlinkSync(file);
          removed++;
        }
      }
    }
  } catch (e) {
    log(`ลบภาพจุดเช็กเก่าไม่สำเร็จ (ไม่กระทบงาน): ${String(e)}`);
  }
  if (removed > 0) log(`ลบภาพจุดเช็กเก่ากว่า ${CHECKPOINT_KEEP_DAYS} วัน ${removed} ไฟล์`);
}

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
  notify("บอท Flow หยุดแล้ว", ERROR_KIND_LABELS[reason] ?? reason);
}

/**
 * บันทึกว่างานนี้พังทันที — ใช้เฉพาะจุดที่ไม่มี page ให้ captureFailure เก็บหลักฐานได้
 * (claimNextJob เท่านั้น) ไม่ throw ต่อถ้าตัว update เองพังซ้อน กันพังซ้อนพังกลบสาเหตุจริง
 */
async function markJobFailedImmediately(jobId: string, e: unknown): Promise<void> {
  const message = e instanceof Error ? e.message : String(e);
  await applyPlan(jobId, claimCrashed(message)).catch((err) => log(`บันทึกงานพังไม่สำเร็จ (${jobId}): ${String(err)}`));
}

/**
 * หยิบงานตามลำดับรอบใน `rounds` (claimOrder: โหลด 1080p → รอบ 2 → Render → รอบ 1 ตัดรอบที่ครบเพดานออกแล้ว)
 * ในรอบเดียวกันเรียงตามเวลาเข้าคิว — claim ด้วย updateMany กันหยิบซ้ำ
 */
async function claimNextJob(rounds: JobRound[]) {
  for (const round of rounds) {
    const candidate = await prisma.flowJob.findFirst({
      where: { status: queuedStatus(round) },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!candidate) continue;
    const claimed = await applyBulk(claim(round, new Date()), { id: candidate.id });
    if (claimed === 1) {
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

/** รูปที่ผู้ใช้เลือกในรอบ r (เป็นรูปอ้างอิงของรอบถัดไป) — ยังไม่ได้เลือก = พังที่ open-flow ก่อนแตะหน้า */
function chosenImagePath(job: ClaimedJob, r: 1 | 2): string {
  const chosen = job.images.find((i) => i.kind === "candidate" && i.round === r && i.chosen);
  if (!chosen) throw new FlowStepError("open-flow", "worker_crash", `งานนี้ยังไม่ได้เลือกรูปรอบ ${r}`);
  return path.join(UPLOAD_ROOT, job.entryId, "flow", chosen.filename);
}

/** รูปที่แนบเข้า Flow ตอนวาดรูป: รอบ 1 = รูปแคปแรก · รอบ 2 = รูปที่เลือกรอบ 1 */
function imageReferenceFor(job: ClaimedJob, round: 1 | 2): string {
  if (round === 2) return chosenImagePath(job, 1);
  const src = job.images.filter((i) => i.kind === "source").sort((a, b) => a.index - b.index)[0];
  if (!src) throw new FlowStepError("open-flow", "worker_crash", "งานนี้ไม่มีรูปแคปต้นทาง");
  return path.join(UPLOAD_ROOT, job.entryId, "flow", src.filename);
}

/** แถวคลิปของงาน (มีได้แถวเดียว — ตัวอย่างของ attempt ปัจจุบัน หรือไฟล์ 1080p) */
function videoRowOf(job: ClaimedJob) {
  return job.images.find((i) => i.kind === "video") ?? null;
}

/** ลบไฟล์ใต้ uploads/<entryId>/flow/ แบบไม่ throw — ไฟล์ค้างดีกว่างานพังเพราะลบไฟล์ไม่ได้ */
function removeFlowFile(entryId: string, filename: string): void {
  try {
    rmSync(path.join(UPLOAD_ROOT, entryId, "flow", filename), { force: true });
  } catch (e) {
    log(`ลบไฟล์ ${filename} ไม่สำเร็จ (ไม่กระทบงาน): ${String(e)}`);
  }
}

/**
 * เขียน DB หลัง Render เสร็จ (ไฟล์คลิปอยู่บนดิสก์แล้ว และเสียเครดิตไปแล้ว) — ถ้าเขียนพลาดเพราะ dev.db ล็อกชั่วคราว
 * ห้ามตีงานเป็น failed/pause คิว (จะดูเหมือนบอทพัง ทั้งที่คลิปได้มาแล้ว) จึงลองซ้ำ 3 ครั้ง (รอ 0.5 วิ / 1.5 วิ)
 * ยังไม่ได้ → log + notify แล้วลองย้ายงานไปสถานะที่ผู้ใช้กู้เองได้ (lastDitch) โดยไม่ throw · คืน true = เขียนสำเร็จ
 */
async function persistAfterRender(
  label: string,
  job: ClaimedJob,
  write: () => Promise<unknown>,
  lastDitch: () => Promise<unknown>
): Promise<boolean> {
  const backoff = [500, 1500];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await write();
      return true;
    } catch (e) {
      log(`งาน ${job.id} บันทึกผล${label}ลง DB ไม่สำเร็จ (ครั้งที่ ${attempt + 1}/3): ${String(e)}`);
      if (attempt < backoff.length) await sleepMs(backoff[attempt]);
    }
  }
  log(`งาน ${job.id} บันทึกผล${label}ไม่ได้ — ไฟล์อยู่บนดิสก์แล้ว ไม่ตีงานเป็น failed`);
  notify(`บันทึกผล${label}ลง DB ไม่ได้`, job.entry.productName);
  try {
    await lastDitch();
  } catch (e) {
    log(`งาน ${job.id} ย้ายสถานะกู้งานก็ไม่สำเร็จ: ${String(e)}`);
  }
  return false;
}

async function processJob(page: Page, job: ClaimedJob, cfg: WorkerConfig, sel: SelectorSet, lastBatchAt: number): Promise<boolean> {
  const round = toJobRound(job.round);
  const outDir = path.join(UPLOAD_ROOT, job.entryId, "flow");
  const stepLog = new StepLog(true);

  try {
    // ย้าย mkdirSync/upsertState/log เข้ามาใน try ด้วย — ถ้าตัวใดตัวหนึ่งพัง (เช่น
    // upsertState ชน SQLITE_BUSY เพราะแอป Next.js ใช้ dev.db ไฟล์เดียวกัน) ต้องให้ catch
    // ด้านล่างบันทึกงานนี้เป็น failed ทันที ไม่ปล่อยค้าง running_* จนกว่า worker รอบหน้า
    // จะมาเจอตอน stale sweep
    mkdirSync(outDir, { recursive: true });
    const checkpointDir = path.join(outDir, "checkpoints");
    mkdirSync(checkpointDir, { recursive: true });
    await upsertState({ currentJobId: job.id, nextWakeAt: null });
    log(`เริ่มงาน ${job.id} (${job.entry.productName}) รอบ ${round} attempt ${job.attempt}`);

    const flow: FlowContext = {
      page, cfg, sel, log: stepLog, jobId: job.id,
      // hook ทดสอบ fail-fast (S4) — ไม่ตั้ง env = ไม่มีผล
      forceFailStep: process.env.FLOW_FORCE_FAIL_STEP,
    };
    // รูป r<round>-a<n>-<i>.png · ตัวอย่างคลิป r3-a<n>.mp4 (videoFilename) · คลิป 1080p r3-final.mp4 — ภาพจุดเช็กขึ้นต้นเหมือนกัน
    // (รอบ 4 ถ่ายภาพเมนูโหลด r3-final-5-menu.jpg / -6-submenu.jpg ไว้ดูตอนโหลด 1080p พัง — ชื่อไม่เข้ารูปแบบ
    // r<round>-a<n>-… ที่หน้า /flow อ่าน จึงไม่โผล่ใน "ดูขั้นตอนที่บอททำ" ดูในโฟลเดอร์ checkpoints เอง)
    const out = (prefix: string): OutputFiles => ({ dir: outDir, prefix, checkpointDir });
    // รอบ 2-4 ใช้ project เดิมของรอบ 1 · ว่าง = สร้างใหม่
    const projectId = job.flowProjectId || null;

    if (round === 4) {
      // ต้องรู้ว่าคลิปที่ผ่านคือช่องไหนใน Flow (รอบ 3 เก็บ id ไว้) และต้องกลับโปรเจกต์เดิม — ไม่มี = ไม่แตะหน้าเลย
      const approvedVideo = videoRowOf(job);
      if (approvedVideo === null || approvedVideo.flowMediaId === "" || job.flowProjectId === "") {
        throw new FlowStepError("find-video", "worker_crash", "ไม่มีข้อมูลคลิปที่ผ่าน (media id / project) ให้กลับไปโหลด 1080p");
      }
      const final = await fetchFinalClip(flow, { projectId: job.flowProjectId, mediaId: approvedVideo.flowMediaId, out: out(FINAL_VIDEO_PREFIX) });
      if (final.file !== null) {
        // แถวเดิมกลายเป็นไฟล์ 1080p (chosen = คลิปที่ผ่านแล้ว) — ไม่มีแถวตัวอย่างค้างให้หน้าเว็บชี้ไปไฟล์ที่ลบแล้ว
        const saved = await persistAfterRender(
          "คลิป 1080p",
          job,
          () => applyPlan(job.id, finalClipSaved(approvedVideo.id, new Date())),
          () => applyPlan(job.id, finalClipUnsaved(new Date())),
        );
        if (!saved) return true;
        if (approvedVideo.filename !== FINAL_VIDEO_FILENAME) removeFlowFile(job.entryId, approvedVideo.filename);
        log(`งาน ${job.id} ได้คลิป 1080p แล้ว → เสร็จ`);
        notify("คลิป 1080p พร้อมแล้ว", job.entry.productName);
      } else {
        await applyPlan(job.id, finalClipMissing(final.failed, new Date()));
        log(`งาน ${job.id} จบด้วย 720p (1080p โหลดไม่ได้)`);
        notify("คลิปพร้อมแล้ว (720p)", job.entry.productName);
      }
      return true;
    }

    if (round === 3) {
      // พรอมต์ของ Render อ่านตอนเริ่มทำ — ผู้ใช้แก้ 10-part prompt ในหน้า entry ก่อนบอทหยิบงานได้
      const clip = await renderClip(flow, {
        references: [chosenImagePath(job, 1), chosenImagePath(job, 2)],
        tenPartPrompt: job.entry.chatgptOutput,
        extraPrompt: job.extraPrompt,
        projectId,
        out: out(`r3-a${job.attempt}`),
      });
      const gotFile = clip.file !== null;
      const saved = await persistAfterRender(
        "คลิป",
        job,
        () => applyPlan(job.id, previewReady({
          gotFile, downloadFailed: clip.failed, job, mediaId: clip.mediaId, projectId: clip.projectId,
        })),
        () => applyPlan(job.id, previewUnsaved()),
      );
      if (!saved) return true;
      log(gotFile ? `งาน ${job.id} Render เสร็จ → รอผู้ใช้ดูคลิป` : `งาน ${job.id} Render เสร็จแต่โหลดไม่ได้ → รอผู้ใช้โหลดเองใน Flow`);
      notify(gotFile ? "คลิปพร้อมให้ดู" : "คลิปเสร็จแล้วใน Flow (โหลดมาไม่ได้)", job.entry.productName);
      return true;
    }

    const drawn = await drawImages(flow, {
      round,
      productName: job.entry.productName,
      reference: imageReferenceFor(job, round),
      extraPrompt: job.extraPrompt,
      projectId,
      out: out(`r${round}-a${job.attempt}`),
    });
    await applyPlan(job.id, imagesReady(round, job, drawn.files.map((file) => path.extname(file).slice(1)), drawn.projectId));
    log(`งาน ${job.id} รอบ ${round} เสร็จ → รอผู้ใช้เลือก`);
    notify("รูปพร้อมให้เลือก", `${job.entry.productName} · รอบ ${round}`);
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
        todayRenders: state?.todayRenders ?? 0,
        sessionStreak: state?.sessionStreak ?? 0,
        msSinceLastBatch: lastBatchAt > 0 ? Date.now() - lastBatchAt : null,
      },
    });
    const failureDir = path.relative(process.cwd(), failureDirAbs).split(path.sep).join("/");
    // รอบ 4 (โหลด 1080p) ที่มี 720p แล้ว พังที่ขั้นไหนก็จบงานด้วย 720p ไม่หยุดคิว ยกเว้นสัญญาณบอท/หลุด login (roundFailed)
    const failure = roundFailed({ round, hasVideoRow: videoRowOf(job) !== null, step, kind, message, failureDir, now: new Date() });
    await applyPlan(job.id, failure.plan);
    if (failure.pause === null) {
      log(`งาน ${job.id} จบด้วย 720p (รอบ 4 พังที่ ${step} — ไม่หยุดคิว) หลักฐาน: ${failureDirAbs}`);
      notify("คลิปพร้อมแล้ว (720p)", job.entry.productName);
      return true;
    }
    await pauseWorker(failure.pause);
    log(`งาน ${job.id} พังที่ ${step} (${kind}) — หยุดทั้งคิว หลักฐาน: ${failureDirAbs}`);
    return false;
  }
}

async function main() {
  const cfg = loadWorkerConfig();
  if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);

  // เปิด Chrome ก่อนแตะ DB เสมอ — โปรไฟล์ .flow-profile เปิดได้ทีละโปรเซส จึงใช้เป็นตัวกันบอทซ้อน
  // (start.bat เปิดบอทให้ทุกครั้ง แม้มีตัวหนึ่งรันอยู่แล้ว) ถ้าเปิดไม่ได้ = มีบอทอีกตัวถือโปรไฟล์อยู่
  // หรือหน้าต่าง Flow Login ยังไม่ปิด → ออกเงียบๆ ห้ามทำ stale sweep ข้างล่าง (จะไปทำให้งานที่บอท
  // ตัวจริงกำลังวาดอยู่กลายเป็น failed) และห้าม pause คิว
  let launched: Awaited<ReturnType<typeof launchFlowBrowser>>;
  try {
    launched = await launchFlowBrowser(cfg);
  } catch (e) {
    log(`เปิด Chrome ของบอทไม่ได้ — มีบอทตัวอื่นทำงานอยู่แล้ว หรือหน้าต่าง Flow Login ยังเปิดค้าง (ไม่แตะคิว): ${String(e).split("\n")[0]}`);
    process.exit(0);
  }
  const { context, page } = launched;

  // หน้าต่าง Chrome ของบอทถูกปิดโดยไม่ได้ตั้งใจ (ส่วนใหญ่คือคนกดปิดเพราะไม่รู้ว่าเป็นของบอท — เจอจริง
  // 2026-09-29 ตอนบอทเพิ่งเปิดเองหลังเข้า Windows) → ออกทันทีโดยไม่หยุดคิว เดิมไหลไปเป็น worker_crash
  // แล้ว pause ค้างโดยไม่มีงานพังให้กด "รันต่อ" · ทุกจุดที่ปิด browser เองต้องตั้ง closingOnPurpose ก่อน
  let closingOnPurpose = false;
  context.on("close", () => {
    if (closingOnPurpose) return;
    log("หน้าต่าง Chrome ของบอทถูกปิด — ปิดบอท (ไม่ได้หยุดคิว) เปิด start.bat ใหม่เพื่อให้ทำงานต่อ");
    notify("บอท Flow ปิดตัวแล้ว", "หน้าต่าง Chrome ของบอทถูกปิด — เปิด start.bat ใหม่ (อย่าปิดหน้าต่างนั้น ย้ายไปไว้ข้างหลังได้)");
    process.exit(0);
  });
  async function closeBrowser(): Promise<void> {
    closingOnPurpose = true;
    await context.close();
  }

  // งานที่ค้าง running_* = worker รอบก่อนตายกลางคัน → พัง ไม่ reset เป็น queued เอง (กัน loop)
  // หลังเปิด Chrome สำเร็จเท่านั้น (ตัวที่สองที่เปิดซ้อนออกไปก่อนถึงตรงนี้) — แค่ลบไฟล์ ไม่แตะ DB
  sweepOldCheckpoints();

  // งานค้าง running_upscale ที่มีตัวอย่าง 720p แล้ว = คลิปเรนเดอร์เสร็จแล้ว (เครดิตจ่ายแล้ว) → จบด้วย 720p ไม่พัง ไม่หยุดคิว
  // (เจอจริง 2026-10-01: Chrome crash ตอนโหลด 1080p → งานค้าง "กำลังโหลด" ผู้ใช้รอเป็นชั่วโมง)
  const upscaleLeft = await prisma.flowJob.findMany({ where: { status: FLOW_STATUS.RUNNING_UPSCALE }, include: { images: true } });
  for (const j of upscaleLeft) {
    const plan = staleUpscale(j.images.some((i) => i.kind === "video"), new Date());
    if (plan === null) continue;
    await applyPlan(j.id, plan);
    log(`งานค้างโหลด 1080p ${j.id} → จบด้วย 720p`);
  }

  // งานค้าง running_r3 ที่กดสร้างคลิปไปแล้ว (มี generate_video ตั้งแต่ startedAt) = เสียเครดิตแล้ว คลิปอยู่ในโปรเจกต์ Flow
  // → review_r3 ไม่มีแถว video + ข้อความให้ไปโหลดเอง/ปิดงาน ไม่หยุดคิว · ถ้าตีเป็น failed ผู้ใช้กด "รันต่อ" = เรนเดอร์ซ้ำเสีย 15 เครดิต
  const renderLeft = await prisma.flowJob.findMany({ where: { status: FLOW_STATUS.RUNNING_R3 }, select: { id: true, startedAt: true } });
  for (const j of renderLeft) {
    const generated = await prisma.flowActivity.findMany({ where: { kind: "generate_video", jobId: j.id }, select: { at: true } });
    const plan = staleRender(j.startedAt, generated.map((g) => g.at));
    if (plan === null) continue;
    await applyPlan(j.id, plan);
    log(`งานค้าง Render ${j.id} กดสร้างคลิปไปแล้ว → รอผู้ใช้ดูใน Flow (ไม่หยุดคิว)`);
  }

  const sweep = staleRunning();
  const stale = await applyBulk(sweep);
  if (stale > 0) {
    await pauseWorker(sweep.pause);
    log(`พบงานค้าง running ${stale} งาน → failed + หยุดคิว รอผู้ใช้กดรันต่อ`);
  }

  await upsertState({ lastSeenAt: new Date(), currentJobId: null });
  const heartbeat = setInterval(() => {
    upsertState({ lastSeenAt: new Date() }).catch((e) => log(`heartbeat ล้มเหลว: ${String(e)}`));
  }, cfg.heartbeatMs);

  async function pauseAndExit(reason: ErrorKind, message: string, code: number): Promise<never> {
    await pauseWorker(reason);
    log(message);
    clearInterval(heartbeat);
    await closeBrowser();
    process.exit(code);
  }

  // ตอนเพิ่งเข้า Windows (start.bat silent จาก Startup) เน็ตมักยังไม่ต่อ — goto พังด้วย net::ERR_*
  // ซึ่งยังไม่ได้แตะ Google เลย จึงรอแล้วลองใหม่ได้โดยไม่ขัดกฎ "ไม่ retry กับหน้าที่พัง" · ถ้าครบแล้ว
  // ยังไม่มีเน็ต ให้ออกเฉยๆ ไม่ pause คิว (ไม่ใช่ความผิดของงานไหน และไม่มีงานพังให้กด "รันต่อ")
  // error อื่นหยุดทันทีเหมือนเดิม
  const NET_RETRY_MS = 30_000;
  const NET_MAX_TRIES = 10;
  let host = "";
  for (let attempt = 1; ; attempt++) {
    try {
      ({ host } = await openFlowAndSettle(page, cfg));
      break;
    } catch (e) {
      if (!String(e).includes("net::ERR_")) {
        return pauseAndExit("host_unsupported", `เปิด Flow ไม่ได้: ${String(e)}`, 1);
      }
      if (attempt >= NET_MAX_TRIES || stopRequested()) {
        log(`ต่อเน็ตไม่ได้ครบ ${attempt} ครั้ง — ปิดบอท (ไม่ได้หยุดคิว) เปิด start.bat ใหม่เมื่อเน็ตมา`);
        notify("บอท Flow ปิดตัวแล้ว", "ต่อเน็ตไม่ได้ — เปิด start.bat ใหม่เมื่อเน็ตมา");
        clearInterval(heartbeat);
        await closeBrowser();
        process.exit(0);
      }
      log(`ยังต่อเน็ตไม่ได้ (${attempt}/${NET_MAX_TRIES}) — รอ ${NET_RETRY_MS / 1000} วิแล้วลองใหม่`);
      await sleepMs(NET_RETRY_MS);
    }
  }
  // เช็ก login ก่อน selectorSetForHost — หน้า login ของ Google ไม่ใช่โฮสต์ที่รู้จัก ถ้าเช็กทีหลังจะถูก
  // รายงานผิดเป็น host_unsupported (ตรรกะเดียวกับ assertPageUsable ใน flow-driver.ts) · ปิดตัวเอง
  // เพื่อคืนโปรไฟล์ เพราะ Flow Login ต้องเปิดโปรไฟล์เดียวกันด้วย Chrome จริง (ดู flow-login.bat)
  if (host.includes("accounts.google.com") || (await hasSignInButton(page))) {
    return pauseAndExit("login_required", "session หลุด — หยุดคิวแล้วปิดบอท รอ login ใหม่ด้วย flow-login.bat", 0);
  }
  let sel: SelectorSet;
  try {
    sel = selectorSetForHost(host);
  } catch (e) {
    return pauseAndExit("host_unsupported", `เปิด Flow ไม่ได้: ${String(e)}`, 1);
  }
  log(`เปิด Flow แล้ว host=${host} selectorSet=${sel.name}`);
  logActivity({
    kind: "session_start",
    detail: {
      config: {
        betweenProductsMs: cfg.betweenProductsMs, betweenBatchesMs: cfg.betweenBatchesMs,
        longBreakEvery: cfg.longBreakEvery, longBreakMs: cfg.longBreakMs,
        dailyBatchCap: cfg.dailyBatchCap, videoDailyCap: cfg.videoDailyCap,
      },
    },
  });

  // มาถึงตรงนี้ = session ใช้ได้ ถ้ารอบก่อนหยุดเพราะ session หลุด แปลว่าผู้ใช้ login ใหม่แล้ว
  // (การเปิดบอทใหม่คือการกระทำของคน ไม่ใช่บอท retry เอง) → ปลดการหยุด และคืนงานที่พังเพราะ
  // login_required กลับเข้าคิวรอบเดิม แบบเดียวกับกด "รันต่อ" (resumeFlowWorker ใน app/actions.ts)
  const pausedReason = (await readState())?.pausedReason ?? "";
  if (pausedReason === "login_required") {
    for (const requeue of loginRecovered()) await applyBulk(requeue);
    await unpauseWorker();
    log("session กลับมาใช้ได้แล้ว — ปลดการหยุดและคืนงานที่ค้างเพราะ login เข้าคิว");
  } else if (pausedReason !== "" && (await prisma.flowJob.count({ where: { status: FLOW_STATUS.FAILED } })) === 0) {
    // หยุดค้างอยู่แต่ไม่มีงานที่พังเลย = ทางตันในหน้า /flow (ปุ่ม "รันต่อ"/"ข้าม" อยู่บนงานที่พังเท่านั้น)
    // เช่นรอบก่อนล้มระหว่างเปิดตัว · การเปิดบอทใหม่คือการกู้คืนของคน จึงปลดให้ ส่วนการหยุดที่มีงานพัง
    // (รวม stale sweep ข้างบน) ยังต้องให้คนกด "รันต่อ" เหมือนเดิม
    await unpauseWorker();
    log(`ปลดการหยุด (${pausedReason}) ที่ค้างจากรอบก่อน — ไม่มีงานที่พังให้กดรันต่อ`);
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
      await upsertState({ todayDate: localDateKey(now), todayBatches: 0, todayRenders: 0 });
      continue;
    }
    if (!isWithinActiveHours(now, cfg.activeHours)) {
      const wake = Date.now() + msUntilActiveWindow(now, cfg.activeHours as [string, string]);
      await upsertState({ nextWakeAt: new Date(wake) });
      await sleepUntil(Math.min(wake, Date.now() + 5 * 60_000));
      continue;
    }
    // เพดานรูปกับเพดานคลิปแยกกัน — ครบฝั่งไหนก็ข้ามเฉพาะงานฝั่งนั้น (claimOrder) · โหลด 1080p ไม่นับเพดานไหนเลย
    // (ไม่เสียเครดิต ผู้ใช้กดผ่านแล้วรอไฟล์อยู่) จึงยังหยิบได้แม้ครบทั้งคู่
    const imagesAllowed = (state?.todayBatches ?? 0) < cfg.dailyBatchCap;
    const rendersAllowed = cfg.renderEnabled && (state?.todayRenders ?? 0) < cfg.videoDailyCap;
    if ((state?.sessionStreak ?? 0) >= longBreakTarget) {
      // ว่างมานานเท่าพักยาวแล้ว = ข้ามการพัก แค่รีเซ็ตตัวนับ (spec 2026-09-30 §1)
      if (idleCountsAsLongBreak(lastBatchAt, Date.now(), cfg.longBreakMs)) {
        log("ว่างมานานพอแล้ว — ไม่พักยาวซ้ำ รีเซ็ตตัวนับ");
        await upsertState({ sessionStreak: 0 });
        longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
        continue;
      }
      const ms = randInt(cfg.longBreakMs);
      log(`พักยาว ${Math.round(ms / 60000)} นาที`);
      await upsertState({ nextWakeAt: new Date(Date.now() + ms), sessionStreak: 0 });
      logActivity({ kind: "break", detail: { ms, why: "long" } });
      await sleepUntil(Date.now() + ms);
      longBreakTarget = pickLongBreakTarget(cfg.longBreakEvery);
      continue;
    }

    const job = await claimNextJob(claimOrder(imagesAllowed, rendersAllowed));
    if (!job) {
      if (!imagesAllowed && !rendersAllowed) {
        // ครบทั้งสองเพดาน — ตื่นมาเช็กงานโหลด 1080p ทุก 5 นาที ที่เหลือรอข้ามวัน
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
        await upsertState({ nextWakeAt: midnight });
        await sleepUntil(Math.min(midnight.getTime(), Date.now() + 5 * 60_000));
        continue;
      }
      await upsertState({ nextWakeAt: null });
      await sleepMs(cfg.pollIdleMs);
      continue;
    }

    const ok = await processJob(page, job, cfg, sel, lastBatchAt);
    if (!ok) {
      // session หลุดกลางคิว → ปิดบอทเพื่อคืนโปรไฟล์ให้ Flow Login (หยุดรออยู่เฉยๆ ก็ login ไม่ได้
      // เพราะโปรไฟล์ถูกบอทถือไว้) พอเปิดบอทใหม่หลัง login ส่วนต้นของ main() จะคืนงานเข้าคิวเอง
      if ((await readState())?.pausedReason === "login_required") {
        log("session หลุดกลางคิว — ปิดบอทเพื่อให้ login ใหม่ได้");
        break;
      }
      continue;
    }

    lastBatchAt = Date.now();
    const doneRound = toJobRound(job.round);
    await prisma.flowWorkerState.update({
      where: { id: WORKER_STATE_ID },
      data: {
        currentJobId: null,
        // รูปนับ todayBatches · Render นับ todayRenders (videoDailyCap) · โหลด 1080p ไม่นับ (ไม่เสียเครดิต)
        ...(doneRound === 1 || doneRound === 2 ? { todayBatches: { increment: 1 } } : {}),
        ...(doneRound === 3 ? { todayRenders: { increment: 1 } } : {}),
        // sessionStreak นับ "สินค้า" ไม่ใช่ "รอบ" (1 สินค้า = รอบ 1 + รอบ 2) จึงบวกเฉพาะตอน
        // รอบ 2 จบ = สินค้านั้นเสร็จจริง — ถ้าบวกทุกรอบ longBreakEvery [4,6] จะกลายเป็น
        // พักยาวทุก 2-3 สินค้า ผิดจากที่สเปกกับ CLAUDE.md เขียนไว้
        // ผลข้างเคียงที่ยอมรับ: สินค้าที่ผู้ใช้ข้าม/สั่งทำใหม่ตั้งแต่รอบ 1 จะไม่ขยับ streak เลย
        // ช่วงนั้นจึงเหลือ dailyBatchCap + betweenProductsMs เป็นตัวคุมจังหวะแทน
        ...(doneRound === 2 ? { sessionStreak: { increment: 1 } } : {}),
      },
    });

    // โหลด 1080p เป็นงานสั้นที่ไม่ได้กดสร้างอะไร → พักสั้น (betweenBatchesMs) · งานอื่นพักแบบเปลี่ยนสินค้า (betweenProductsMs)
    const pause = randInt(doneRound === 4 ? cfg.betweenBatchesMs : cfg.betweenProductsMs);
    await upsertState({ nextWakeAt: new Date(Date.now() + pause) });
    logActivity({ kind: "break", jobId: job.id, round: doneRound, detail: { ms: pause, why: "between" } });
    await sleepUntil(Date.now() + pause);
  }

  log("ออกจาก loop หลัก — ปิด browser");
  clearInterval(heartbeat);
  await upsertState({ currentJobId: null, nextWakeAt: null });
  await closeBrowser();
  if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);
}

main().catch(async (e) => {
  const detail = e instanceof Error ? e.stack ?? e.message : String(e);
  log(`worker ล้ม: ${detail}`);
  // browser ถูกปิดแล้ว error จากคำสั่งที่ค้างอยู่อาจมาถึงก่อน event "close" ของ context — กรณีเดียวกับ
  // handler ใน main() จึงไม่หยุดคิวเช่นกัน
  if (detail.includes("has been closed")) process.exit(0);
  await pauseWorker("worker_crash").catch(() => undefined);
  process.exit(1);
});
