/**
 * ตรวจ lib/flow-lifecycle-db.ts กับ SQLite จริง แบบเทียบคู่: ทุกจังหวะของ FlowJob รันโค้ด "เดิม" (Prisma ที่เขียนมือก่อน
 * commit 321bee2 — ถอดมาจาก app/actions.ts / worker/index.ts ตัวเก่า) กับงาน A และรันโค้ดปัจจุบัน (แผนจาก lib/flow-lifecycle.ts
 * + applyPlan/applyBulk) กับงาน B ที่อยู่สถานะเดียวกัน แล้วเทียบแถว FlowJob / FlowJobImage / FlowWorkerState ที่ได้
 *
 * ต้องชี้สำเนาของ DB เท่านั้น (สคริปต์สร้าง entry/งานทดสอบ และแตะ FlowWorkerState) — ปฏิเสธไฟล์ชื่อ dev.db:
 *   cp dev.db dev-test.db        (dev.db เปิด WAL — ถ้ามี dev.db-wal ที่ไม่ว่าง ก๊อปทั้ง 3 ไฟล์ หรือ checkpoint ก่อน)
 *   npx tsx scripts/check-flow-lifecycle-db.ts dev-test.db
 * ไม่อยู่ใน check:flow เพราะต้องมีสำเนา DB · ลบ entry/งาน/กิจกรรมทดสอบ และคืน FlowWorkerState เดิมตอนจบ
 * ฝั่ง OLD คือพฤติกรรมอ้างอิง — ตั้งใจเปลี่ยนจังหวะไหนใน lib/flow-lifecycle.ts ต้องแก้ OLD ของจังหวะนั้นให้ตรงด้วย
 */
import path from "node:path";
import assert from "node:assert/strict";
import {
  FINAL_VIDEO_FILENAME,
  FLOW_STATUS,
  WORKER_STATE_ID,
  candidateFilename,
  isOpenStatus,
  normalizeExtraPrompt,
  queuedStatus,
  reviewStatus,
  runningStatus,
  type FlowRound,
  type JobRound,
} from "@/lib/flow-jobs";
import * as L from "@/lib/flow-lifecycle";

type Prisma = (typeof import("@/lib/prisma"))["prisma"];
type DbMod = typeof import("@/lib/flow-lifecycle-db");

const REPO = path.resolve(__dirname, "..");
const SENTINEL = new Date("2000-01-01T00:00:00.000Z");
const TEST_NAME = "__check-flow-lifecycle-db__";

let prisma: Prisma;
let db: DbMod;
let failures = 0;
let passes = 0;

function fail(name: string, e: unknown) {
  failures++;
  console.log(`FAIL ${name}\n  ${e instanceof Error ? e.message.split("\n").join("\n  ") : String(e)}`);
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

function stamp(d: Date | null): string | null {
  if (d === null) return null;
  if (d.getTime() === SENTINEL.getTime()) return "untouched";
  return Math.abs(Date.now() - d.getTime()) < 120_000 ? "fresh" : `other:${d.toISOString()}`;
}

/** ตัด id / เวลาอัตโนมัติ ที่ต่างกันระหว่างงาน A กับ B เสมอ */
function omit<T extends object, K extends keyof T>(o: T, keys: K[]): Omit<T, K> {
  const r = { ...o };
  for (const k of keys) delete r[k];
  return r;
}

async function snapJob(id: string) {
  const j = await prisma.flowJob.findUniqueOrThrow({ where: { id }, include: { images: true } });
  return {
    ...omit(j, ["id", "entryId", "createdAt", "updatedAt", "images"]),
    startedAt: stamp(j.startedAt),
    finishedAt: stamp(j.finishedAt),
    images: j.images
      .map((im) => omit(im, ["id", "jobId", "createdAt"]))
      .sort((a, b) => `${a.kind}|${a.round}|${a.attempt}|${a.index}|${a.filename}`.localeCompare(`${b.kind}|${b.round}|${b.attempt}|${b.index}|${b.filename}`)),
  };
}

async function snapWorker() {
  const w = await prisma.flowWorkerState.findUnique({ where: { id: WORKER_STATE_ID } });
  if (!w) return null;
  return { pausedReason: w.pausedReason, pausedAt: stamp(w.pausedAt), currentJobId: w.currentJobId, nextWakeAt: stamp(w.nextWakeAt) };
}

async function pauseForTest() {
  const data = { pausedReason: "test_pause", pausedAt: SENTINEL, currentJobId: null, nextWakeAt: SENTINEL };
  await prisma.flowWorkerState.upsert({ where: { id: WORKER_STATE_ID }, create: { id: WORKER_STATE_ID, ...data }, update: data });
}

/** startedAt/finishedAt ที่มีค่า → SENTINEL เพื่อดูว่าจังหวะถัดไปเขียนทับหรือไม่ */
async function ageTimestamps(id: string) {
  const j = await prisma.flowJob.findUniqueOrThrow({ where: { id } });
  await prisma.flowJob.update({
    where: { id },
    data: { ...(j.startedAt ? { startedAt: SENTINEL } : {}), ...(j.finishedAt ? { finishedAt: SENTINEL } : {}) },
  });
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: string };
async function capture(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** รันโค้ดเดิมกับงาน A แล้วโค้ดใหม่กับงาน B (ทั้งคู่เริ่มจาก "บอทหยุดอยู่") เทียบผลคืน + แถวงาน + FlowWorkerState */
async function step(name: string, pair: Pair, oldFn: (id: string) => Promise<unknown>, newFn: (id: string) => Promise<unknown>) {
  try {
    await ageTimestamps(pair.a);
    await ageTimestamps(pair.b);
    await pauseForTest();
    const ro = await capture(() => oldFn(pair.a));
    const sa = await snapJob(pair.a);
    const wa = await snapWorker();
    await pauseForTest();
    const rn = await capture(() => newFn(pair.b));
    const sb = await snapJob(pair.b);
    const wb = await snapWorker();
    assert.deepEqual(rn, ro, "ผลคืน/ข้อความ error ต่างกัน");
    assert.deepEqual(sb, sa, "แถว FlowJob/FlowJobImage ต่างกัน");
    assert.deepEqual(wb, wa, "FlowWorkerState ต่างกัน");
    passes++;
    console.log(`ok   ${name} → ${sa.status} r${sa.round} a${sa.attempt}${ro.ok ? "" : ` (throws: ${ro.error.slice(0, 50)})`}`);
    return sb;
  } catch (e) {
    fail(name, e);
    return snapJob(pair.b);
  }
}

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passes++;
    console.log(`ok   ${name}`);
  } else fail(name, detail || "assertion false");
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

type Pair = { a: string; b: string; entryA: string; entryB: string };
const createdEntries: string[] = [];

async function newEntry(): Promise<string> {
  const e = await prisma.promptEntry.create({
    data: { productName: TEST_NAME, productInfo: "", riskModule: "", extraNotes: "", images: "[]" },
  });
  createdEntries.push(e.id);
  return e.id;
}

type ImgSeed = { kind: string; round: number; attempt: number; index: number; filename: string; chosen?: boolean; flowMediaId?: string };

/** งานคู่ที่สถานะ/แถวรูปเหมือนกัน (เขียนตรงเพื่อเตรียมสถานะ — ไม่ใช่โค้ดที่กำลังตรวจ) */
async function makePair(job: Record<string, unknown> & { status: string }, images: ImgSeed[] = []): Promise<Pair> {
  const entryA = await newEntry();
  const entryB = await newEntry();
  const mk = async (entryId: string) => {
    const j = await prisma.flowJob.create({ data: { entryId, ...job } });
    for (const im of images) {
      await prisma.flowJobImage.create({
        data: { jobId: j.id, mimeType: im.kind === "video" ? "video/mp4" : "image/png", ...im },
      });
    }
    return j.id;
  };
  return { a: await mk(entryA), b: await mk(entryB), entryA, entryB };
}

async function imageIdOf(jobId: string, kind: string, round: number, attempt: number, index: number) {
  const im = await prisma.flowJobImage.findFirstOrThrow({ where: { jobId, kind, round, attempt, index } });
  return im.id;
}

async function jobWithImages(id: string) {
  return prisma.flowJob.findUniqueOrThrow({ where: { id }, include: { images: true } });
}

// ---------------------------------------------------------------------------
// โค้ดเดิม (ก่อน 321bee2) — ถอดคำต่อคำจาก app/actions.ts / worker/index.ts / lib/flow-jobs.ts ตัวเก่า
// ---------------------------------------------------------------------------

const OLD = {
  async enqueue(entryId: string, extraPrompt: unknown, sources: { filename: string; mimeType: string }[]) {
    const job = await prisma.flowJob.create({
      data: { entryId, status: FLOW_STATUS.QUEUED_R1, round: 1, attempt: 1, extraPrompt: normalizeExtraPrompt(extraPrompt) },
    });
    for (const [index, s] of sources.entries()) {
      await prisma.flowJobImage.create({
        data: { jobId: job.id, kind: "source", round: 0, attempt: 1, index, filename: s.filename, mimeType: s.mimeType },
      });
    }
    return job.id;
  },
  async claim(id: string, round: JobRound) {
    const claimed = await prisma.flowJob.updateMany({
      where: { id, status: queuedStatus(round) },
      data: { status: runningStatus(round), startedAt: new Date(), failedStep: "", errorKind: "", errorMessage: "", failureDir: "" },
    });
    return claimed.count;
  },
  async claimCrashed(id: string, message: string) {
    await prisma.flowJob.update({
      where: { id },
      data: { status: FLOW_STATUS.FAILED, failedStep: "unknown", errorKind: "worker_crash", errorMessage: message.slice(0, 2000) },
    });
  },
  async imagesReady(id: string, round: number, files: string[], projectId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id } });
    const imageRound: FlowRound = round === 2 ? 2 : 1;
    await prisma.$transaction(async (tx) => {
      for (const [index, file] of files.entries()) {
        const ext = path.extname(file).slice(1) === "jpg" ? "jpg" : "png";
        await tx.flowJobImage.create({
          data: {
            jobId: id,
            kind: "candidate",
            round: imageRound,
            attempt: job.attempt,
            index,
            filename: candidateFilename(imageRound, job.attempt, index, ext),
            mimeType: ext === "jpg" ? "image/jpeg" : "image/png",
            promptExtra: job.extraPrompt,
          },
        });
      }
      await tx.flowJob.update({ where: { id }, data: { status: reviewStatus(imageRound), flowProjectId: projectId } });
    });
  },
  /** chooseFlowCandidate เดิม ไม่รวมการก๊อปไฟล์เป็น ProductImage (ไม่ได้ถูก refactor และแตะดิสก์) */
  async choose(jobId: string, imageId: string, renderEnabled: boolean) {
    const job = await jobWithImages(jobId);
    const image = job.images.find((i) => i.id === imageId);
    if (!image || image.kind !== "candidate" || image.round !== job.round || image.attempt !== job.attempt) {
      throw new Error("รูปที่เลือกไม่ใช่ของรอบปัจจุบัน");
    }
    const next =
      job.status === FLOW_STATUS.REVIEW_R1
        ? FLOW_STATUS.QUEUED_R2
        : job.status === FLOW_STATUS.REVIEW_R2
          ? renderEnabled
            ? FLOW_STATUS.AWAITING_PROMPT
            : FLOW_STATUS.DONE
          : null;
    if (next === null) throw new Error("งานนี้ไม่ได้อยู่ในขั้นรอเลือกรูป");
    await prisma.$transaction(async (tx) => {
      await tx.flowJobImage.updateMany({ where: { jobId, kind: "candidate", round: job.round }, data: { chosen: false } });
      await tx.flowJobImage.update({ where: { id: imageId }, data: { chosen: true } });
      if (next === FLOW_STATUS.QUEUED_R2) {
        await tx.flowJob.update({ where: { id: jobId }, data: { status: next, round: 2, attempt: 1, extraPrompt: "" } });
        return;
      }
      await tx.flowJob.update({
        where: { id: jobId },
        data: next === FLOW_STATUS.DONE ? { status: next, finishedAt: new Date() } : { status: next, round: 3, attempt: 1, extraPrompt: "" },
      });
    });
    return next;
  },
  async promptReady(entryId: string) {
    const r = await prisma.flowJob.updateMany({
      where: { entryId, status: FLOW_STATUS.AWAITING_PROMPT },
      data: { status: FLOW_STATUS.QUEUED_R3 },
    });
    return r.count;
  },
  async redo(jobId: string, extraPrompt?: string) {
    const job = await jobWithImages(jobId);
    const next =
      job.status === FLOW_STATUS.REVIEW_R1
        ? FLOW_STATUS.QUEUED_R1
        : job.status === FLOW_STATUS.REVIEW_R2
          ? FLOW_STATUS.QUEUED_R2
          : job.status === FLOW_STATUS.REVIEW_R3
            ? FLOW_STATUS.QUEUED_R3
            : null;
    if (next === null) throw new Error("ทำใหม่ได้เฉพาะงานที่รอคุณเลือกรูป/ดูคลิป");
    if (job.status === FLOW_STATUS.REVIEW_R3) {
      await prisma.flowJobImage.deleteMany({ where: { jobId, kind: "video" } });
    }
    await prisma.flowJob.update({
      where: { id: jobId },
      data: {
        status: next,
        attempt: job.attempt + 1,
        ...(extraPrompt === undefined ? {} : { extraPrompt: normalizeExtraPrompt(extraPrompt) }),
      },
    });
    return {
      isRender: job.status === FLOW_STATUS.REVIEW_R3,
      extraPrompt: extraPrompt === undefined ? job.extraPrompt : normalizeExtraPrompt(extraPrompt),
    };
  },
  async approve(jobId: string) {
    const job = await jobWithImages(jobId);
    if (job.status !== FLOW_STATUS.REVIEW_R3) throw new Error("งานนี้ไม่ได้อยู่ในขั้นรอดูคลิป");
    if (!job.images.some((i) => i.kind === "video")) throw new Error("ยังไม่มีไฟล์คลิป — กด เรนเดอร์ใหม่ หรือโหลดเองแล้วปิดงาน");
    await prisma.flowJob.update({ where: { id: jobId }, data: { status: FLOW_STATUS.QUEUED_UPSCALE, round: 4 } });
  },
  async retryUpscale(jobId: string) {
    const job = await jobWithImages(jobId);
    const video = job.images.find((i) => i.kind === "video") ?? null;
    const can =
      job.status === FLOW_STATUS.DONE && video !== null && !video.chosen && video.filename !== FINAL_VIDEO_FILENAME && job.flowProjectId !== "";
    if (!can) throw new Error("งานนี้ลองโหลด 1080p ใหม่ไม่ได้ (ยังไม่จบ ได้ 1080p แล้ว หรือไม่มีคลิป)");
    await prisma.flowJob.update({
      where: { id: jobId },
      data: { status: FLOW_STATUS.QUEUED_UPSCALE, round: 4, finishedAt: null, errorMessage: "", failedStep: "", errorKind: "", failureDir: "" },
    });
  },
  async unpause() {
    await prisma.flowWorkerState.upsert({
      where: { id: WORKER_STATE_ID },
      create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
      update: { pausedReason: "", pausedAt: null },
    });
  },
  async resume(jobId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status !== FLOW_STATUS.FAILED) throw new Error("รันต่อได้เฉพาะงานที่พัง");
    const round = job.round as JobRound;
    await prisma.$transaction([
      prisma.flowJob.update({
        where: { id: jobId },
        data: { status: queuedStatus(round), failedStep: "", errorKind: "", errorMessage: "", failureDir: "" },
      }),
      prisma.flowWorkerState.upsert({
        where: { id: WORKER_STATE_ID },
        create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
        update: { pausedReason: "", pausedAt: null },
      }),
    ]);
  },
  async skip(jobId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id: jobId } });
    if (!isOpenStatus(job.status)) return "noop";
    await prisma.$transaction([
      prisma.flowJob.update({ where: { id: jobId }, data: { status: FLOW_STATUS.SKIPPED, finishedAt: new Date() } }),
      prisma.flowWorkerState.upsert({
        where: { id: WORKER_STATE_ID },
        create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
        update: { pausedReason: "", pausedAt: null },
      }),
    ]);
    return "skipped";
  },
  async finishManually(jobId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id: jobId } });
    const renderStage =
      job.status === FLOW_STATUS.AWAITING_PROMPT ||
      job.status === FLOW_STATUS.QUEUED_R3 ||
      job.status === FLOW_STATUS.REVIEW_R3 ||
      (job.status === FLOW_STATUS.FAILED && job.round >= 3);
    if (!renderStage) throw new Error("ปิดได้เฉพาะงานที่อยู่ขั้นทำคลิป (และบอทไม่ได้กำลังทำอยู่)");
    await prisma.$transaction([
      prisma.flowJob.update({ where: { id: jobId }, data: { status: FLOW_STATUS.DONE, finishedAt: new Date() } }),
      ...(job.status === FLOW_STATUS.FAILED
        ? [
            prisma.flowWorkerState.upsert({
              where: { id: WORKER_STATE_ID },
              create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
              update: { pausedReason: "", pausedAt: null },
            }),
          ]
        : []),
    ]);
  },
  async previewReady(jobId: string, files: string[], downloadFailed: string | null, mediaId: string | null, projectId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id: jobId } });
    const gotFile = files.length > 0;
    const outcome = {
      status: "review_r3",
      createVideoRow: gotFile,
      filename: gotFile ? `r3-a${String(job.attempt)}.mp4` : null,
      errorMessage: gotFile ? "" : `โหลดคลิปมาไม่ได้ (คลิปอยู่ในโปรเจกต์ Flow แล้ว): ${downloadFailed ?? ""}`.slice(0, 2000),
    };
    await prisma.$transaction(async (tx) => {
      await tx.flowJobImage.deleteMany({ where: { jobId, kind: "video" } });
      if (outcome.createVideoRow && outcome.filename !== null) {
        await tx.flowJobImage.create({
          data: {
            jobId,
            kind: "video",
            round: 3,
            attempt: job.attempt,
            index: 0,
            filename: outcome.filename,
            mimeType: "video/mp4",
            promptExtra: job.extraPrompt,
            flowMediaId: mediaId ?? "",
          },
        });
      }
      await tx.flowJob.update({ where: { id: jobId }, data: { status: outcome.status, flowProjectId: projectId, errorMessage: outcome.errorMessage } });
    });
  },
  async previewUnsaved(jobId: string) {
    await prisma.flowJob.update({
      where: { id: jobId },
      data: { status: FLOW_STATUS.REVIEW_R3, errorMessage: "คลิปเสร็จแล้วแต่บันทึกลง DB ไม่ได้ — ดูไฟล์ในโฟลเดอร์ flow ของ entry หรือกดเรนเดอร์ใหม่" },
    });
  },
  async finalClipSaved(jobId: string, videoRowId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.flowJobImage.update({ where: { id: videoRowId }, data: { filename: FINAL_VIDEO_FILENAME, chosen: true } });
      await tx.flowJob.update({ where: { id: jobId }, data: { status: FLOW_STATUS.DONE, finishedAt: new Date(), errorMessage: "" } });
    });
  },
  async finalClipUnsaved(jobId: string) {
    await prisma.flowJob.update({
      where: { id: jobId },
      data: { status: FLOW_STATUS.DONE, finishedAt: new Date(), errorMessage: "ได้ไฟล์ 1080p แต่บันทึกลง DB ไม่ได้ — ดู r3-final.mp4 ในโฟลเดอร์ flow ของ entry" },
    });
  },
  async finalClipMissing(jobId: string, downloadFailed: string | null) {
    await prisma.flowJob.update({
      where: { id: jobId },
      data: { status: FLOW_STATUS.DONE, finishedAt: new Date(), errorMessage: `ได้ 720p (โหลด 1080p ไม่ได้: ${downloadFailed ?? ""})`.slice(0, 2000) },
    });
  },
  /** คืน kind ที่ต้อง pauseWorker หรือ null (จบด้วย 720p) */
  async roundFailed(jobId: string, step: string, kind: string, message: string, failureDir: string) {
    const job = await jobWithImages(jobId);
    const round = job.round;
    const hasVideo = job.images.some((i) => i.kind === "video");
    if (round === 4 && kind !== "captcha" && kind !== "login_required" && hasVideo) {
      await prisma.flowJob.update({
        where: { id: jobId },
        data: {
          status: FLOW_STATUS.DONE,
          finishedAt: new Date(),
          failureDir,
          errorMessage: `ได้ 720p (โหลด 1080p ไม่ได้ที่ขั้น ${step}: ${message})`.slice(0, 2000),
        },
      });
      return null;
    }
    await prisma.flowJob.update({
      where: { id: jobId },
      data: { status: FLOW_STATUS.FAILED, failedStep: step, errorKind: kind, errorMessage: message.slice(0, 2000), failureDir },
    });
    return kind;
  },
  async staleUpscaleSweep() {
    const staleUpscale = await prisma.flowJob.findMany({ where: { status: FLOW_STATUS.RUNNING_UPSCALE }, include: { images: true } });
    for (const j of staleUpscale) {
      if (!j.images.some((i) => i.kind === "video")) continue;
      await prisma.flowJob.update({
        where: { id: j.id },
        data: { status: FLOW_STATUS.DONE, finishedAt: new Date(), errorMessage: "ได้ 720p (บอทปิดกลางทางตอนโหลด 1080p — กด ลองโหลด 1080p อีกครั้ง ได้)" },
      });
    }
  },
  async staleRenderSweep() {
    const staleRender = await prisma.flowJob.findMany({ where: { status: FLOW_STATUS.RUNNING_R3 }, select: { id: true, startedAt: true } });
    for (const j of staleRender) {
      const generated = await prisma.flowActivity.findMany({ where: { kind: "generate_video", jobId: j.id }, select: { at: true } });
      if (L.staleRenderRecovery(j.startedAt, generated.map((g) => g.at)) !== "review") continue;
      await prisma.$transaction([
        prisma.flowJobImage.deleteMany({ where: { jobId: j.id, kind: "video" } }),
        prisma.flowJob.update({ where: { id: j.id }, data: { status: FLOW_STATUS.REVIEW_R3, errorMessage: L.STALE_RENDER_MESSAGE } }),
      ]);
    }
  },
  async staleRunningSweep() {
    const stale = await prisma.flowJob.updateMany({
      where: { status: { in: [FLOW_STATUS.RUNNING_R1, FLOW_STATUS.RUNNING_R2, FLOW_STATUS.RUNNING_R3, FLOW_STATUS.RUNNING_UPSCALE] } },
      data: { status: FLOW_STATUS.FAILED, failedStep: "unknown", errorKind: "worker_crash", errorMessage: "worker ตายกลางคันในรอบก่อน" },
    });
    return stale.count > 0 ? "worker_crash" : null;
  },
  async loginRecovered() {
    for (const round of [1, 2, 3, 4] as JobRound[]) {
      await prisma.flowJob.updateMany({
        where: { status: FLOW_STATUS.FAILED, errorKind: "login_required", round },
        data: { status: queuedStatus(round), failedStep: "", errorKind: "", errorMessage: "", failureDir: "" },
      });
    }
    // upsertState({ pausedReason: "", pausedAt: null })
    await prisma.flowWorkerState.upsert({
      where: { id: WORKER_STATE_ID },
      create: { id: WORKER_STATE_ID, pausedReason: "", pausedAt: null },
      update: { pausedReason: "", pausedAt: null },
    });
  },
};

// ---------------------------------------------------------------------------
// โค้ดปัจจุบัน — เรียกแบบเดียวกับ app/actions.ts / worker/index.ts หลัง 321bee2
// ---------------------------------------------------------------------------

const NEW = {
  async enqueue(entryId: string, extraPrompt: unknown, sources: { filename: string; mimeType: string }[]) {
    const plan = L.enqueue(extraPrompt, sources);
    const job = await db.createJob(entryId, plan.job);
    for (const row of plan.sourceRows) await db.addImage(job.id, row);
    return job.id;
  },
  claim: (id: string, round: JobRound) => db.applyBulk(L.claim(round, new Date()), { id }),
  claimCrashed: (id: string, message: string) => db.applyPlan(id, L.claimCrashed(message)),
  async imagesReady(id: string, round: number, files: string[], projectId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id } });
    await db.applyPlan(id, L.imagesReady(round === 2 ? 2 : 1, job, files.map((f) => path.extname(f).slice(1)), projectId));
  },
  async choose(jobId: string, imageId: string, renderEnabled: boolean) {
    const job = await jobWithImages(jobId);
    const plan = L.choose(job, job.images.find((i) => i.id === imageId), () => renderEnabled, new Date());
    await prisma.$transaction(async (tx) => {
      await db.applyPlan(jobId, plan, tx);
    });
    return plan.next;
  },
  promptReady: (entryId: string) => db.applyBulk(L.promptReady(), { entryId }),
  async redo(jobId: string, extraPrompt?: string) {
    const job = await jobWithImages(jobId);
    const plan = L.redo(job, extraPrompt);
    await db.applyPlan(jobId, plan);
    return { isRender: plan.isRender, extraPrompt: plan.extraPrompt };
  },
  async approve(jobId: string) {
    const job = await jobWithImages(jobId);
    await db.applyPlan(jobId, L.approveRender(job, job.images.some((i) => i.kind === "video")));
  },
  async retryUpscale(jobId: string) {
    const job = await jobWithImages(jobId);
    await db.applyPlan(jobId, L.retryUpscale(job, job.images.find((i) => i.kind === "video") ?? null));
  },
  async resume(jobId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id: jobId } });
    await db.applyPlan(jobId, L.resume(job));
  },
  async skip(jobId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id: jobId } });
    const plan = L.skip(job, new Date());
    if (plan === null) return "noop";
    await db.applyPlan(jobId, plan);
    return "skipped";
  },
  /** ทำต่อเอง — action เขียนด้วย applyTakeOver แล้วแปลง 0 แถวเป็นข้อความไทย (ที่นี่แค่ throw ให้ step เทียบได้) */
  async takeOver(jobId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id: jobId } });
    const n = await db.applyTakeOver(jobId, L.takeOver(job, new Date()), job.status);
    if (n === 0) throw new Error(L.TAKEOVER_BOT_BUSY_MESSAGE);
  },
  async previewReady(jobId: string, files: string[], downloadFailed: string | null, mediaId: string | null, projectId: string) {
    const job = await prisma.flowJob.findUniqueOrThrow({ where: { id: jobId } });
    await db.applyPlan(jobId, L.previewReady({ gotFile: files.length > 0, downloadFailed, job, mediaId: mediaId ?? "", projectId }));
  },
  previewUnsaved: (jobId: string) => db.applyPlan(jobId, L.previewUnsaved()),
  finalClipSaved: (jobId: string, videoRowId: string) => db.applyPlan(jobId, L.finalClipSaved(videoRowId, new Date())),
  finalClipUnsaved: (jobId: string) => db.applyPlan(jobId, L.finalClipUnsaved(new Date())),
  finalClipMissing: (jobId: string, downloadFailed: string | null) => db.applyPlan(jobId, L.finalClipMissing(downloadFailed, new Date())),
  async roundFailed(jobId: string, step: string, kind: string, message: string, failureDir: string) {
    const job = await jobWithImages(jobId);
    const failure = L.roundFailed({
      round: job.round as JobRound,
      hasVideoRow: job.images.some((i) => i.kind === "video"),
      step,
      kind,
      message,
      failureDir,
      now: new Date(),
    });
    await db.applyPlan(jobId, failure.plan);
    return failure.pause;
  },
  async staleUpscaleSweep() {
    const upscaleLeft = await prisma.flowJob.findMany({ where: { status: FLOW_STATUS.RUNNING_UPSCALE }, include: { images: true } });
    for (const j of upscaleLeft) {
      const plan = L.staleUpscale(j.images.some((i) => i.kind === "video"), new Date());
      if (plan === null) continue;
      await db.applyPlan(j.id, plan);
    }
  },
  async staleRenderSweep() {
    const renderLeft = await prisma.flowJob.findMany({ where: { status: FLOW_STATUS.RUNNING_R3 }, select: { id: true, startedAt: true } });
    for (const j of renderLeft) {
      const generated = await prisma.flowActivity.findMany({ where: { kind: "generate_video", jobId: j.id }, select: { at: true } });
      const plan = L.staleRender(j.startedAt, generated.map((g) => g.at));
      if (plan === null) continue;
      await db.applyPlan(j.id, plan);
    }
  },
  async staleRunningSweep() {
    const sweep = L.staleRunning();
    const stale = await db.applyBulk(sweep);
    return stale > 0 ? sweep.pause : null;
  },
  async loginRecovered() {
    for (const requeue of L.loginRecovered()) await db.applyBulk(requeue);
    await db.unpauseWorker();
  },
};

// ---------------------------------------------------------------------------
// สถานการณ์
// ---------------------------------------------------------------------------

const IMG4 = ["a.png", "b.jpg", "c.png", "d.webp"];

async function fullLifecycle() {
  console.log("\n== วงจรเต็ม: enqueue → … → finalClipSaved ==");
  const entryA = await newEntry();
  const entryB = await newEntry();
  const sources = [
    { filename: "source-0.png", mimeType: "image/png" },
    { filename: "source-1.jpg", mimeType: "image/jpeg" },
  ];
  const extra = "เอาแค่\n  แผ่นเดียว ";
  const pair: Pair = {
    a: await OLD.enqueue(entryA, extra, sources),
    b: await NEW.enqueue(entryB, extra, sources),
    entryA,
    entryB,
  };
  {
    const sa = await snapJob(pair.a);
    const sb = await snapJob(pair.b);
    try {
      assert.deepEqual(sb, sa);
      assert.equal(sb.extraPrompt, "เอาแค่ แผ่นเดียว");
      passes++;
      console.log("ok   enqueue → queued_r1 + 2 source rows, extraPrompt normalized");
    } catch (e) {
      fail("enqueue", e);
    }
  }

  await step("claim r1", pair, (id) => OLD.claim(id, 1), (id) => NEW.claim(id, 1));
  await step("claim r1 again (already running → 0)", pair, (id) => OLD.claim(id, 1), (id) => NEW.claim(id, 1));
  await step("claim r2 on running_r1 (→ 0)", pair, (id) => OLD.claim(id, 2), (id) => NEW.claim(id, 2));
  await step("imagesReady r1 a1", pair, (id) => OLD.imagesReady(id, 1, IMG4, "proj-1"), (id) => NEW.imagesReady(id, 1, IMG4, "proj-1"));
  await step("approve on review_r1 (throws)", pair, (id) => OLD.approve(id), (id) => NEW.approve(id));
  await step("redo r1 with extra", pair, (id) => OLD.redo(id, "ใหม่\nนะ"), (id) => NEW.redo(id, "ใหม่\nนะ"));
  await step("claim r1 (a2)", pair, (id) => OLD.claim(id, 1), (id) => NEW.claim(id, 1));
  let s = await step("imagesReady r1 a2", pair, (id) => OLD.imagesReady(id, 1, IMG4, "proj-1"), (id) => NEW.imagesReady(id, 1, IMG4, "proj-1"));
  check("imagesReady r1 a2: promptExtra copied to candidates", s.images.filter((i) => i.kind === "candidate" && i.attempt === 2).every((i) => i.promptExtra === "ใหม่ นะ"));

  await step(
    "choose stale image (a1, throws)",
    pair,
    async (id) => OLD.choose(id, await imageIdOf(id, "candidate", 1, 1, 0), true),
    async (id) => NEW.choose(id, await imageIdOf(id, "candidate", 1, 1, 0), true),
  );
  s = await step(
    "choose r1 → queued_r2",
    pair,
    async (id) => OLD.choose(id, await imageIdOf(id, "candidate", 1, 2, 1), true),
    async (id) => NEW.choose(id, await imageIdOf(id, "candidate", 1, 2, 1), true),
  );
  check("choose r1: extraPrompt cleared, round 2 attempt 1", s.extraPrompt === "" && s.round === 2 && s.attempt === 1 && s.status === FLOW_STATUS.QUEUED_R2);
  check("choose r1: exactly one chosen candidate", s.images.filter((i) => i.chosen).length === 1);

  await step("redo on queued_r2 (throws)", pair, (id) => OLD.redo(id), (id) => NEW.redo(id));
  await step("claim r2", pair, (id) => OLD.claim(id, 2), (id) => NEW.claim(id, 2));
  await step("imagesReady r2 a1", pair, (id) => OLD.imagesReady(id, 2, IMG4, "proj-1"), (id) => NEW.imagesReady(id, 2, IMG4, "proj-1"));
  await step("redo r2 with extra", pair, (id) => OLD.redo(id, "ตอนใช้งาน"), (id) => NEW.redo(id, "ตอนใช้งาน"));
  await step("claim r2 (a2)", pair, (id) => OLD.claim(id, 2), (id) => NEW.claim(id, 2));
  await step("imagesReady r2 a2", pair, (id) => OLD.imagesReady(id, 2, ["x.jpg", "y.jpg"], "proj-1"), (id) => NEW.imagesReady(id, 2, ["x.jpg", "y.jpg"], "proj-1"));
  await step("redo r2 keep extra (undefined)", pair, (id) => OLD.redo(id), (id) => NEW.redo(id));
  await step("claim r2 (a3)", pair, (id) => OLD.claim(id, 2), (id) => NEW.claim(id, 2));
  await step("imagesReady r2 a3", pair, (id) => OLD.imagesReady(id, 2, IMG4, "proj-1"), (id) => NEW.imagesReady(id, 2, IMG4, "proj-1"));
  s = await step(
    "choose r2 (render on) → awaiting_prompt",
    pair,
    async (id) => OLD.choose(id, await imageIdOf(id, "candidate", 2, 3, 3), true),
    async (id) => NEW.choose(id, await imageIdOf(id, "candidate", 2, 3, 3), true),
  );
  check("choose r2: extraPrompt cleared, round 3 attempt 1", s.extraPrompt === "" && s.round === 3 && s.attempt === 1);
  check("choose r2: round-1 choice kept", s.images.filter((i) => i.chosen && i.round === 1).length === 1 && s.images.filter((i) => i.chosen && i.round === 2).length === 1);

  // promptReady อยู่ในขอบเขต entry — คู่ A/B อยู่คนละ entry
  {
    const ro = await OLD.promptReady(pair.entryA);
    const rn = await NEW.promptReady(pair.entryB);
    const ro2 = await OLD.promptReady(pair.entryA);
    const rn2 = await NEW.promptReady(pair.entryB);
    try {
      assert.deepEqual([rn, rn2], [ro, ro2]);
      assert.deepEqual([ro, ro2], [1, 0]);
      assert.deepEqual(await snapJob(pair.b), await snapJob(pair.a));
      passes++;
      console.log("ok   promptReady → queued_r3 (count 1, then 0)");
    } catch (e) {
      fail("promptReady", e);
    }
  }

  await step("claim r3", pair, (id) => OLD.claim(id, 3), (id) => NEW.claim(id, 3));
  s = await step(
    "previewReady got file (a1)",
    pair,
    (id) => OLD.previewReady(id, ["r3-a1.mp4"], null, "media-1", "proj-1"),
    (id) => NEW.previewReady(id, ["r3-a1.mp4"], null, "media-1", "proj-1"),
  );
  check("previewReady: one video row r3-a1.mp4 with mediaId", s.images.filter((i) => i.kind === "video").map((i) => `${i.filename}|${i.flowMediaId}`).join() === "r3-a1.mp4|media-1");
  s = await step("redo on review_r3 (re-render)", pair, (id) => OLD.redo(id), (id) => NEW.redo(id));
  check("re-render: video row deleted, attempt 2", s.images.every((i) => i.kind !== "video") && s.attempt === 2 && s.status === FLOW_STATUS.QUEUED_R3);
  await step("claim r3 (a2)", pair, (id) => OLD.claim(id, 3), (id) => NEW.claim(id, 3));
  await step(
    "previewReady no file (a2)",
    pair,
    (id) => OLD.previewReady(id, [], "net::ERR_X", "media-2", "proj-1"),
    (id) => NEW.previewReady(id, [], "net::ERR_X", "media-2", "proj-1"),
  );
  await step("approve without video row (throws)", pair, (id) => OLD.approve(id), (id) => NEW.approve(id));
  await step("redo r3 with extra", pair, (id) => OLD.redo(id, "ช้าลง"), (id) => NEW.redo(id, "ช้าลง"));
  await step("claim r3 (a3)", pair, (id) => OLD.claim(id, 3), (id) => NEW.claim(id, 3));
  // แถวคลิปค้าง (รันต่อหลังพัง) — previewReady ต้องแทนที่
  for (const id of [pair.a, pair.b]) {
    await prisma.flowJobImage.create({ data: { jobId: id, kind: "video", round: 3, attempt: 1, index: 0, filename: "r3-a1.mp4", mimeType: "video/mp4" } });
  }
  s = await step(
    "previewReady replaces leftover video row (a3)",
    pair,
    (id) => OLD.previewReady(id, ["r3-a3.mp4"], null, null, "proj-2"),
    (id) => NEW.previewReady(id, ["r3-a3.mp4"], null, null, "proj-2"),
  );
  check("previewReady a3: single video row r3-a3.mp4, promptExtra=ช้าลง", s.images.filter((i) => i.kind === "video").map((i) => `${i.filename}|${i.promptExtra}`).join() === "r3-a3.mp4|ช้าลง");
  await step("approveRender → queued_upscale", pair, (id) => OLD.approve(id), (id) => NEW.approve(id));
  await step("claim r4", pair, (id) => OLD.claim(id, 4), (id) => NEW.claim(id, 4));
  s = await step(
    "finalClipSaved",
    pair,
    async (id) => OLD.finalClipSaved(id, await imageIdOf(id, "video", 3, 3, 0)),
    async (id) => NEW.finalClipSaved(id, await imageIdOf(id, "video", 3, 3, 0)),
  );
  check("finalClipSaved: done + r3-final.mp4 chosen", s.status === FLOW_STATUS.DONE && s.images.some((i) => i.kind === "video" && i.filename === FINAL_VIDEO_FILENAME && i.chosen));
  await step("retryUpscale on 1080p done (throws)", pair, (id) => OLD.retryUpscale(id), (id) => NEW.retryUpscale(id));
  await step("skip done job (noop)", pair, (id) => OLD.skip(id), (id) => NEW.skip(id));
}

const VIDEO_720: ImgSeed = { kind: "video", round: 3, attempt: 1, index: 0, filename: "r3-a1.mp4", flowMediaId: "m" };

async function branches() {
  console.log("\n== ทางแยก ==");
  let p = await makePair({ status: FLOW_STATUS.RUNNING_R1, round: 1, attempt: 1, startedAt: SENTINEL });
  await step("claimCrashed (long message)", p, (id) => OLD.claimCrashed(id, "x".repeat(2500)), (id) => NEW.claimCrashed(id, "x".repeat(2500)));

  p = await makePair({ status: FLOW_STATUS.RUNNING_R3, round: 3, attempt: 2, flowProjectId: "proj" });
  await step("previewUnsaved", p, (id) => OLD.previewUnsaved(id), (id) => NEW.previewUnsaved(id));

  p = await makePair({ status: FLOW_STATUS.RUNNING_UPSCALE, round: 4, attempt: 1, flowProjectId: "proj" }, [VIDEO_720]);
  await step("finalClipUnsaved", p, (id) => OLD.finalClipUnsaved(id), (id) => NEW.finalClipUnsaved(id));

  p = await makePair({ status: FLOW_STATUS.RUNNING_UPSCALE, round: 4, attempt: 1, flowProjectId: "proj" }, [VIDEO_720]);
  await step("finalClipMissing", p, (id) => OLD.finalClipMissing(id, "timeout"), (id) => NEW.finalClipMissing(id, "timeout"));
  await step("finalClipMissing null reason (re-run on done)", p, (id) => OLD.finalClipMissing(id, null), (id) => NEW.finalClipMissing(id, null));
  await step("retryUpscale on 720p done", p, (id) => OLD.retryUpscale(id), (id) => NEW.retryUpscale(id));
  await step("claim r4", p, (id) => OLD.claim(id, 4), (id) => NEW.claim(id, 4));
  await step(
    "roundFailed r4 selector_drift with video → done 720p, no pause",
    p,
    (id) => OLD.roundFailed(id, "find-video", "selector_drift", "boom", "uploads/_flow-failures/x"),
    (id) => NEW.roundFailed(id, "find-video", "selector_drift", "boom", "uploads/_flow-failures/x"),
  );
  await step("retryUpscale again", p, (id) => OLD.retryUpscale(id), (id) => NEW.retryUpscale(id));
  await step("claim r4 again", p, (id) => OLD.claim(id, 4), (id) => NEW.claim(id, 4));
  await step(
    "roundFailed r4 captcha → failed + pause",
    p,
    (id) => OLD.roundFailed(id, "download", "captcha", "403", "uploads/_flow-failures/y"),
    (id) => NEW.roundFailed(id, "download", "captcha", "403", "uploads/_flow-failures/y"),
  );
  await step("takeOver (parity with old finishManually) failed r4 → done + unpause", p, (id) => OLD.finishManually(id), (id) => NEW.takeOver(id));

  p = await makePair({ status: FLOW_STATUS.RUNNING_UPSCALE, round: 4, attempt: 1, flowProjectId: "proj" });
  await step(
    "roundFailed r4 no video row → failed + pause",
    p,
    (id) => OLD.roundFailed(id, "find-video", "worker_crash", "no clip", "d"),
    (id) => NEW.roundFailed(id, "find-video", "worker_crash", "no clip", "d"),
  );
  await step("resume failed r4 → queued_upscale + unpause", p, (id) => OLD.resume(id), (id) => NEW.resume(id));
  await step("resume queued (throws)", p, (id) => OLD.resume(id), (id) => NEW.resume(id));

  p = await makePair({ status: FLOW_STATUS.RUNNING_R2, round: 2, attempt: 2, extraPrompt: "x" });
  await step(
    "roundFailed r2 long message",
    p,
    (id) => OLD.roundFailed(id, "wait-results", "flow_error", "m".repeat(3000), "dir"),
    (id) => NEW.roundFailed(id, "wait-results", "flow_error", "m".repeat(3000), "dir"),
  );
  await step("resume failed r2 → queued_r2", p, (id) => OLD.resume(id), (id) => NEW.resume(id));
  await step("skip queued_r2 → skipped + unpause", p, (id) => OLD.skip(id), (id) => NEW.skip(id));
  await step("skip skipped (noop, stays paused)", p, (id) => OLD.skip(id), (id) => NEW.skip(id));

  // NEW-only: failurePolicy "continue" (skipPause) — งานต้อง failed เหมือนทางหยุดคิวทุกช่อง (OLD เป็นตัวอ้างอิง) แต่ไม่มี pause
  {
    const q = await makePair({ status: FLOW_STATUS.RUNNING_R1, round: 1, attempt: 1 });
    await pauseForTest();
    const before = await snapWorker();
    await OLD.roundFailed(q.a, "wait-results", "flow_error", "Flow: failed to generate", "uploads/_flow-failures/z");
    const jb = await jobWithImages(q.b);
    const failure = L.roundFailed({
      round: jb.round as JobRound, hasVideoRow: false, step: "wait-results", kind: "flow_error",
      message: "Flow: failed to generate", failureDir: "uploads/_flow-failures/z", now: new Date(), skipPause: true,
    });
    await db.applyPlan(q.b, failure.plan);
    check("skipPause: pause = null", failure.pause === null);
    check(
      "skipPause: งาน failed เหมือนทางหยุดคิวทุกช่อง (failedStep/errorKind/errorMessage/failureDir)",
      JSON.stringify(await snapJob(q.a)) === JSON.stringify(await snapJob(q.b)),
      JSON.stringify([await snapJob(q.a), await snapJob(q.b)]),
    );
    check("skipPause: applyPlan ไม่แตะสถานะหยุดของบอท", JSON.stringify(await snapWorker()) === JSON.stringify(before));
  }

  p = await makePair({ status: FLOW_STATUS.RUNNING_R3, round: 3, attempt: 1 });
  await step(
    "roundFailed r3 login_required",
    p,
    (id) => OLD.roundFailed(id, "open-flow", "login_required", "login", "dir"),
    (id) => NEW.roundFailed(id, "open-flow", "login_required", "login", "dir"),
  );
  await step("takeOver (parity with old finishManually) failed r3 → done + unpause", p, (id) => OLD.finishManually(id), (id) => NEW.takeOver(id));

  p = await makePair({ status: FLOW_STATUS.REVIEW_R3, round: 3, attempt: 1 }, [VIDEO_720]);
  await step("takeOver (parity with old finishManually) review_r3 → done, stays paused", p, (id) => OLD.finishManually(id), (id) => NEW.takeOver(id));
  p = await makePair({ status: FLOW_STATUS.AWAITING_PROMPT, round: 3, attempt: 1 });
  await step("takeOver (parity with old finishManually) awaiting_prompt", p, (id) => OLD.finishManually(id), (id) => NEW.takeOver(id));
  p = await makePair({ status: FLOW_STATUS.REVIEW_R2, round: 2, attempt: 1 });
  await step("approve on review_r2 (throws)", p, (id) => OLD.approve(id), (id) => NEW.approve(id));
  await step("retryUpscale on review_r2 (throws)", p, (id) => OLD.retryUpscale(id), (id) => NEW.retryUpscale(id));

  // choose รอบ 2 แบบปิด Render อัตโนมัติ
  p = await makePair({ status: FLOW_STATUS.REVIEW_R2, round: 2, attempt: 1, extraPrompt: "keep?" }, [
    { kind: "candidate", round: 1, attempt: 1, index: 0, filename: "r1-a1-0.png", chosen: true },
    { kind: "candidate", round: 1, attempt: 1, index: 1, filename: "r1-a1-1.png" },
    { kind: "candidate", round: 2, attempt: 1, index: 0, filename: "r2-a1-0.png" },
    { kind: "candidate", round: 2, attempt: 1, index: 1, filename: "r2-a1-1.png", chosen: true },
  ]);
  await step(
    "choose r2 (render off) → done",
    p,
    async (id) => OLD.choose(id, await imageIdOf(id, "candidate", 2, 1, 0), false),
    async (id) => NEW.choose(id, await imageIdOf(id, "candidate", 2, 1, 0), false),
  );
  p = await makePair({ status: FLOW_STATUS.QUEUED_R1, round: 1, attempt: 1 }, [
    { kind: "candidate", round: 1, attempt: 1, index: 0, filename: "r1-a1-0.png" },
  ]);
  await step(
    "choose on queued_r1 (throws)",
    p,
    async (id) => OLD.choose(id, await imageIdOf(id, "candidate", 1, 1, 0), true),
    async (id) => NEW.choose(id, await imageIdOf(id, "candidate", 1, 1, 0), true),
  );
  await step("choose missing image id (throws)", p, (id) => OLD.choose(id, "nope", true), (id) => NEW.choose(id, "nope", true));
}

/** กวาดงานค้าง (ทั้งตาราง) — A เข้าสถานะแล้วรันโค้ดเดิม จากนั้น B เข้าสถานะแล้วรันโค้ดใหม่ */
async function sweeps() {
  console.log("\n== กวาดงานค้างตอนเปิดบอท ==");
  const otherRunning = await prisma.flowJob.count({
    where: {
      status: { in: [FLOW_STATUS.RUNNING_R1, FLOW_STATUS.RUNNING_R2, FLOW_STATUS.RUNNING_R3, FLOW_STATUS.RUNNING_UPSCALE] },
      entry: { productName: { not: TEST_NAME } },
    },
  });
  if (otherRunning > 0) console.log(`  (สำเนามีงาน running_* จริง ${otherRunning} งาน — โค้ดเดิมจะกวาดไปก่อน ไม่กระทบการเทียบ)`);
  const setTo = (data: Record<string, unknown>) => (id: string) => prisma.flowJob.update({ where: { id }, data });

  // staleUpscale: มีคลิป = done 720p · ไม่มีคลิป = ไม่แตะ
  let p = await makePair({ status: FLOW_STATUS.SKIPPED, round: 4, attempt: 1, flowProjectId: "proj" }, [VIDEO_720]);
  let q = await makePair({ status: FLOW_STATUS.SKIPPED, round: 4, attempt: 1, flowProjectId: "proj" });
  {
    const go = (sweep: () => Promise<unknown>, ids: string[]) => async () => {
      for (const id of ids) await setTo({ status: FLOW_STATUS.RUNNING_UPSCALE })(id);
      return sweep();
    };
    await step("staleUpscale (with video → done 720p)", p, (id) => go(OLD.staleUpscaleSweep, [id, q.a])(), (id) => go(NEW.staleUpscaleSweep, [id, q.b])());
    await step("  …same sweep: job without video untouched", q, async () => undefined, async () => undefined);
  }

  // staleRender: กดสร้างคลิปแล้ว = review_r3 + ลบแถวคลิปค้าง · ยังไม่กด = ไม่แตะ
  p = await makePair({ status: FLOW_STATUS.SKIPPED, round: 3, attempt: 2, flowProjectId: "proj" }, [VIDEO_720]);
  q = await makePair({ status: FLOW_STATUS.SKIPPED, round: 3, attempt: 1 });
  {
    const started = new Date(Date.now() - 60_000);
    const go = (sweep: () => Promise<unknown>, gen: string, notGen: string) => async () => {
      await setTo({ status: FLOW_STATUS.RUNNING_R3, startedAt: started })(gen);
      await setTo({ status: FLOW_STATUS.RUNNING_R3, startedAt: started })(notGen);
      // กิจกรรม generate_video ก่อน startedAt ของงานที่ไม่ได้กด (ของ attempt เก่า) ต้องไม่นับ
      await prisma.flowActivity.create({ data: { kind: "generate_video", jobId: gen, at: new Date(started.getTime() + 5_000) } });
      await prisma.flowActivity.create({ data: { kind: "generate_video", jobId: notGen, at: new Date(started.getTime() - 5_000) } });
      return sweep();
    };
    await step("staleRender (generated → review_r3, video row deleted)", p, (id) => go(OLD.staleRenderSweep, id, q.a)(), (id) => go(NEW.staleRenderSweep, id, q.b)());
    await step("  …same sweep: not generated since start untouched", q, async () => undefined, async () => undefined);
  }

  // staleRunning: running ที่เหลือ = failed worker_crash (q ยังเป็น running_r3 อยู่จากข้างบน)
  // q.b พักไว้นอก running ระหว่างโค้ดเดิมกวาด (ไม่งั้นโค้ดเดิมกวาด B ไปด้วย)
  await step(
    "staleRunning (running_r3 left → failed)",
    q,
    async () => {
      await setTo({ status: FLOW_STATUS.SKIPPED })(q.b);
      return OLD.staleRunningSweep();
    },
    async () => {
      await setTo({ status: FLOW_STATUS.RUNNING_R3 })(q.b);
      return NEW.staleRunningSweep();
    },
  );
  p = await makePair({ status: FLOW_STATUS.SKIPPED, round: 1, attempt: 3, startedAt: SENTINEL });
  await step(
    "staleRunning running_r1",
    p,
    async (id) => {
      await setTo({ status: FLOW_STATUS.RUNNING_R1 })(id);
      return OLD.staleRunningSweep();
    },
    async (id) => {
      await setTo({ status: FLOW_STATUS.RUNNING_R1 })(id);
      return NEW.staleRunningSweep();
    },
  );
  await step("staleRunning nothing left (→ null)", p, async () => OLD.staleRunningSweep(), async () => NEW.staleRunningSweep());

  // loginRecovered: failed + login_required ทุกรอบ → queued รอบเดิม + ปลด pause · errorKind อื่นไม่แตะ
  for (const round of [1, 2, 3, 4] as JobRound[]) {
    p = await makePair({ status: FLOW_STATUS.SKIPPED, round, attempt: 1, flowProjectId: "proj" });
    const fail = { status: FLOW_STATUS.FAILED, errorKind: "login_required", failedStep: "open-flow", errorMessage: "login", failureDir: "d" };
    await step(
      `loginRecovered r${round}`,
      p,
      async (id) => {
        await setTo(fail)(id);
        await OLD.loginRecovered();
      },
      async (id) => {
        await setTo(fail)(id);
        await NEW.loginRecovered();
      },
    );
  }
  p = await makePair({ status: FLOW_STATUS.SKIPPED, round: 2, attempt: 1 });
  {
    const fail = { status: FLOW_STATUS.FAILED, errorKind: "captcha", failedStep: "x", errorMessage: "y", failureDir: "d" };
    await step(
      "loginRecovered leaves captcha failure",
      p,
      async (id) => {
        await setTo(fail)(id);
        await OLD.loginRecovered();
      },
      async (id) => {
        await setTo(fail)(id);
        await NEW.loginRecovered();
      },
    );
  }

  // unpauseWorker เมื่อไม่มีแถว FlowWorkerState (create)
  try {
    await prisma.flowWorkerState.deleteMany({ where: { id: WORKER_STATE_ID } });
    await OLD.unpause();
    const wa = await snapWorker();
    await prisma.flowWorkerState.deleteMany({ where: { id: WORKER_STATE_ID } });
    await db.unpauseWorker();
    const wb = await snapWorker();
    await pauseForTest();
    await OLD.unpause();
    const wa2 = await snapWorker();
    await pauseForTest();
    await db.unpauseWorker();
    const wb2 = await snapWorker();
    assert.deepEqual([wb, wb2], [wa, wa2]);
    passes++;
    console.log("ok   unpauseWorker (create when missing, update when paused)");
  } catch (e) {
    fail("unpauseWorker", e);
  }
}

/**
 * ทำต่อเอง (takeOver) — สถานะที่เกินขั้นทำคลิปไม่มีของเดิมให้เทียบ จึงเช็กผลที่แถวงาน/FlowWorkerState ตรงๆ
 * (สถานะขั้นทำคลิปเทียบกับ OLD.finishManually แล้วใน branches)
 */
async function takeovers() {
  console.log("\n== ทำต่อเอง ==");
  const seeds: [string, number][] = [
    [FLOW_STATUS.QUEUED_R1, 1], [FLOW_STATUS.REVIEW_R1, 1], [FLOW_STATUS.QUEUED_R2, 2], [FLOW_STATUS.REVIEW_R2, 2],
    [FLOW_STATUS.AWAITING_PROMPT, 3], [FLOW_STATUS.QUEUED_R3, 3], [FLOW_STATUS.REVIEW_R3, 3], [FLOW_STATUS.QUEUED_UPSCALE, 4],
    [FLOW_STATUS.FAILED, 1], [FLOW_STATUS.FAILED, 2],
  ];
  for (const [status, round] of seeds) {
    const p = await makePair({ status, round, attempt: 2, extraPrompt: "keep", failedStep: status === FLOW_STATUS.FAILED ? "x" : "", errorKind: status === FLOW_STATUS.FAILED ? "captcha" : "" });
    await ageTimestamps(p.b);
    await pauseForTest();
    const r = await capture(() => NEW.takeOver(p.b));
    const j = await snapJob(p.b);
    const w = await snapWorker();
    const wantUnpause = status === FLOW_STATUS.FAILED;
    check(
      `takeOver ${status} r${round} → done + finishedAt ใหม่ · แถวอื่นไม่เปลี่ยน · ${wantUnpause ? "ปลดการหยุด" : "ยังหยุดอยู่"}`,
      r.ok && j.status === FLOW_STATUS.DONE && j.finishedAt === "fresh" && j.round === round && j.attempt === 2 && j.extraPrompt === "keep" &&
        (wantUnpause ? w?.pausedReason === "" : w?.pausedReason === "test_pause"),
      JSON.stringify({ r, j, w }),
    );
  }
  // บอททำอยู่ / จบแล้ว → plan โยน error ก่อนแตะ DB
  for (const status of [FLOW_STATUS.RUNNING_R1, FLOW_STATUS.RUNNING_R2, FLOW_STATUS.RUNNING_R3, FLOW_STATUS.RUNNING_UPSCALE, FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED]) {
    const p = await makePair({ status, round: 3, attempt: 1 });
    await pauseForTest();
    const before = JSON.stringify(await snapJob(p.b));
    const r = await capture(() => NEW.takeOver(p.b));
    check(`takeOver ${status} → error ไม่แตะงาน/การหยุด`, !r.ok && before === JSON.stringify(await snapJob(p.b)) && (await snapWorker())?.pausedReason === "test_pause", JSON.stringify(r));
  }
  // แข่งกับบอท: ผู้ใช้อ่านงานตอนยัง queued_r1 แต่บอทหยิบไปก่อนเขียน → where กันไว้ 0 แถว งานต้องยัง running
  {
    const p = await makePair({ status: FLOW_STATUS.QUEUED_R1, round: 1, attempt: 1 });
    const stale = await prisma.flowJob.findUniqueOrThrow({ where: { id: p.b } });
    const stalePlan = L.takeOver(stale, new Date());
    await NEW.claim(p.b, 1);
    await pauseForTest();
    const n = await db.applyTakeOver(p.b, stalePlan, stale.status);
    const j = await snapJob(p.b);
    check("แข่งกับบอท: บอทหยิบก่อน → applyTakeOver คืน 0 · งานยัง running_r1 · ไม่มี finishedAt", n === 0 && j.status === FLOW_STATUS.RUNNING_R1 && j.finishedAt === null, JSON.stringify({ n, j }));
  }
  // แข่งกับบอท ฝั่งงานพัง: อ่านตอน failed (แผนมี unpause) แต่ผู้ใช้อีกแท็บ "รันต่อ" + บอทหยิบไปแล้ว → ต้องไม่ปลดการหยุด
  {
    const p = await makePair({ status: FLOW_STATUS.FAILED, round: 1, attempt: 1, failedStep: "x", errorKind: "flow_error" });
    const stale = await prisma.flowJob.findUniqueOrThrow({ where: { id: p.b } });
    const stalePlan = L.takeOver(stale, new Date());
    await NEW.resume(p.b);
    await NEW.claim(p.b, 1);
    await pauseForTest();
    const n = await db.applyTakeOver(p.b, stalePlan, stale.status);
    check("แข่งกับบอท (งานพังที่ถูกรันต่อ+หยิบไปแล้ว): 0 แถว และไม่ปลดการหยุดของบอท", n === 0 && (await snapWorker())?.pausedReason === "test_pause", JSON.stringify({ n, w: await snapWorker() }));
  }
  // สถานะเปลี่ยนเป็นอีกสถานะที่ "ทำต่อเองได้" ระหว่างอ่านกับเขียน (อ่านตอน failed → ผู้ใช้อีกแท็บกด "รันต่อ" = queued_r1):
  // where ต้องตรงสถานะที่อ่านมา ไม่ใช่แค่อยู่ในรายการ — ไม่งั้นงานถูกปิดด้วยแผนของ failed และปลดการหยุดที่ไม่ใช่ของแผนนี้
  {
    const p = await makePair({ status: FLOW_STATUS.FAILED, round: 1, attempt: 1, failedStep: "x", errorKind: "flow_error" });
    const stale = await prisma.flowJob.findUniqueOrThrow({ where: { id: p.b } });
    const stalePlan = L.takeOver(stale, new Date());
    await NEW.resume(p.b);
    await pauseForTest();
    const n = await db.applyTakeOver(p.b, stalePlan, stale.status);
    const j = await snapJob(p.b);
    check("สถานะเปลี่ยน failed→queued_r1 (ยังอยู่ในรายการทำต่อเอง): 0 แถว · งานยัง queued_r1 · ไม่ปลดการหยุด", n === 0 && j.status === FLOW_STATUS.QUEUED_R1 && (await snapWorker())?.pausedReason === "test_pause", JSON.stringify({ n, j }));
  }
  // สำเร็จ = คืน 1
  {
    const p = await makePair({ status: FLOW_STATUS.REVIEW_R1, round: 1, attempt: 1 });
    const n = await db.applyTakeOver(p.b, L.takeOver({ status: FLOW_STATUS.REVIEW_R1 }, new Date()), FLOW_STATUS.REVIEW_R1);
    check("applyTakeOver สำเร็จคืน 1", n === 1, String(n));
  }
}

/** applyPlan หลายขั้นต้องเป็นทรานแซกชันเดียว: ล้มกลางทาง = ไม่มีอะไรถูกเขียน */
async function atomicity() {
  console.log("\n== ทรานแซกชัน ==");
  const p = await makePair({ status: FLOW_STATUS.REVIEW_R3, round: 3, attempt: 1 }, [VIDEO_720]);
  const before = await snapJob(p.b);
  const r = await capture(() =>
    db.applyPlan(p.b, { deleteVideoRows: true, finalizeVideoRowId: "does-not-exist", job: { status: FLOW_STATUS.DONE } }),
  );
  const after = await snapJob(p.b);
  check("applyPlan rolls back when a later write fails", !r.ok && JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ r, after }));
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npx tsx scripts/check-flow-lifecycle-db.ts <path to a COPY of dev.db>");
    process.exit(2);
  }
  const abs = path.resolve(arg);
  if (abs.toLowerCase() === path.join(REPO, "dev.db").toLowerCase() || path.basename(abs).toLowerCase() === "dev.db") {
    console.error("ไม่รับ dev.db ตัวจริง — ก๊อปเป็นไฟล์อื่นก่อน");
    process.exit(2);
  }
  process.env.DATABASE_URL = `file:${abs.split(path.sep).join("/")}`;
  prisma = (await import("@/lib/prisma")).prisma;
  db = await import("@/lib/flow-lifecycle-db");

  const savedState = await prisma.flowWorkerState.findUnique({ where: { id: WORKER_STATE_ID } });
  try {
    await fullLifecycle();
    await branches();
    await sweeps();
    await takeovers();
    await atomicity();
  } finally {
    const jobs = await prisma.flowJob.findMany({ where: { entryId: { in: createdEntries } }, select: { id: true } });
    await prisma.flowActivity.deleteMany({ where: { jobId: { in: jobs.map((j) => j.id) } } });
    await prisma.promptEntry.deleteMany({ where: { id: { in: createdEntries } } });
    await prisma.flowWorkerState.deleteMany({ where: { id: WORKER_STATE_ID } });
    if (savedState) await prisma.flowWorkerState.create({ data: savedState });
    await prisma.$disconnect();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
