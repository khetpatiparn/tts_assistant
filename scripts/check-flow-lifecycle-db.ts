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
  ERROR_KIND_LABELS,
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

  // NEW-only: เน็ตสะดุดตอนเปิด Flow (เหตุการณ์ 2026-10-05, รอบ 3) — failurePolicy "continue_network" → งาน failed เหมือนทางหยุดคิวทุกช่อง
  // (หลักฐานครบ) ไม่ pause · งานพังที่ค้างอยู่ไม่บล็อก claim ของงานอื่น (บล็อกได้แค่ pausedReason) · "รันต่อ" ใช้ได้เหมือนเดิม
  {
    const incident = "page.goto: net::ERR_NETWORK_CHANGED at https://labs.google/fx/tools/flow/project/abc\nCall log:";
    const dir = "uploads/_flow-failures/net";
    const q = await makePair({ status: FLOW_STATUS.RUNNING_R3, round: 3, attempt: 1 });
    const policy = L.failurePolicy({
      kind: "worker_crash", step: "open-flow", round: 3, message: incident,
      autoContinuesToday: 0, lastAutoContinueAt: null, lastSuccessAt: null, cap: 2, recentNetworkSkipsAt: [],
    });
    check("network: failurePolicy → continue_network", policy === "continue_network", policy);
    await pauseForTest();
    await OLD.roundFailed(q.a, "open-flow", "worker_crash", incident, dir);
    await db.unpauseWorker();
    const before = await snapWorker();
    const jb = await jobWithImages(q.b);
    const failure = L.roundFailed({
      round: jb.round as JobRound, hasVideoRow: false, step: "open-flow", kind: "worker_crash",
      message: incident, failureDir: dir, now: new Date(), skipPause: policy === "continue_network",
    });
    await db.applyPlan(q.b, failure.plan);
    check("network: pause = null", failure.pause === null);
    check(
      "network: งาน failed เหมือนทางหยุดคิวทุกช่อง (failedStep open-flow / worker_crash / ข้อความ net:: / failureDir)",
      JSON.stringify(await snapJob(q.a)) === JSON.stringify(await snapJob(q.b)),
      JSON.stringify([await snapJob(q.a), await snapJob(q.b)]),
    );
    const after = await snapWorker();
    check("network: บอทไม่ถูกหยุด", JSON.stringify(after) === JSON.stringify(before) && after?.pausedReason === "", JSON.stringify([before, after]));
    const failedB = await prisma.flowJob.findUniqueOrThrow({ where: { id: q.b } });
    check("network: หน้า /flow โชว์หมายเหตุเน็ตสะดุดจากแถวที่เก็บไว้", L.botMovedOnNote(failedB, false) === "เน็ตสะดุดตอนเปิด Flow — บอทข้ามไปทำงานอื่นแล้ว กด รันต่อ เพื่อลองใหม่");
    // งานถัดไปในคิว — มีงาน failed ค้างอยู่ 2 งาน (a, b) แต่บอทไม่ได้หยุด → หยิบได้
    const nextEntry = await newEntry();
    const next = await prisma.flowJob.create({ data: { entryId: nextEntry, status: FLOW_STATUS.QUEUED_R1, round: 1, attempt: 1 } });
    const claimed = await NEW.claim(next.id, 1);
    check("network: มีงาน failed ค้างอยู่ ไม่บล็อก claim งานถัดไป", claimed === 1 && (await prisma.flowJob.findUniqueOrThrow({ where: { id: next.id } })).status === FLOW_STATUS.RUNNING_R1, String(claimed));
    await step("network: resume (รันต่อ) failed r3 open-flow → queued_r3", q, (id) => OLD.resume(id), (id) => NEW.resume(id));
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

async function queueOnlyUnpauses() {
  console.log("\n== ให้บอททำงานอื่นต่อ (ปล่อยงานพังไว้) ==");
  const setPause = (reason: string) =>
    prisma.flowWorkerState.upsert({
      where: { id: WORKER_STATE_ID },
      create: { id: WORKER_STATE_ID, pausedReason: reason, pausedAt: SENTINEL },
      update: { pausedReason: reason, pausedAt: SENTINEL },
    });
  for (const reason of ["worker_crash", "generation_timeout"]) {
    const failed = await makePair({ status: FLOW_STATUS.FAILED, round: 3, attempt: 1, failedStep: "open-flow", errorKind: reason, errorMessage: "net::ERR_NETWORK_CHANGED", failureDir: "x" });
    const queued = await makePair({ status: FLOW_STATUS.QUEUED_R3, round: 3, attempt: 1 });
    await setPause(reason);
    const before = JSON.stringify(await snapJob(failed.b));
    const r = await capture(() => db.unpauseQueueOnly());
    const w = await snapWorker();
    check(
      `${reason}: ปลดการหยุด · งานพังไม่ถูกแตะ (ยัง failed + ร่องรอยครบ) · คืน reason + จำนวนงานพัง`,
      r.ok && (r.value as { unpaused: boolean; pausedReason: string }).unpaused === true &&
        (r.value as { pausedReason: string }).pausedReason === reason &&
        (r.value as { failedJobs: number }).failedJobs >= 1 &&
        w?.pausedReason === "" && before === JSON.stringify(await snapJob(failed.b)) &&
        (await snapJob(failed.b)).status === FLOW_STATUS.FAILED,
      JSON.stringify({ r, w }),
    );
    const n = await NEW.claim(queued.b, 3);
    check(`${reason}: หลังปลด บอทหยิบงาน queued_r3 ได้ · งานพังยัง failed`, n === 1 && (await snapJob(failed.b)).status === FLOW_STATUS.FAILED, JSON.stringify(n));
    const failedClaim = await NEW.claim(failed.b, 3);
    check(`${reason}: claim ไม่หยิบงาน failed`, failedClaim === 0, JSON.stringify(failedClaim));
  }
  // ต้นเหตุของการหยุด (แถบ /flow) — เวลาจริงจาก DB: บอท applyPlan(roundFailed) แล้ว pauseWorker (pausedAt = now) · งานพังเก่าที่บอท
  // ข้ามไปก่อนหน้า (failed แต่คิวไม่หยุด) ต้องไม่ถูกเลือก แม้ข้อความเป็นเน็ตสะดุด
  {
    const netMsg = "page.goto: net::ERR_NETWORK_CHANGED at https://flow.google.com/project/x";
    const earlier = await makePair({ status: FLOW_STATUS.FAILED, round: 1, attempt: 1, failedStep: "open-flow", errorKind: "worker_crash", errorMessage: netMsg, failureDir: "x" });
    await prisma.flowJob.update({ where: { id: earlier.b }, data: { updatedAt: new Date(Date.now() - 3_600_000) } });
    const cause = await makePair({ status: FLOW_STATUS.RUNNING_R2, round: 2, attempt: 1 });
    const failure = L.roundFailed({ round: 2, hasVideoRow: false, step: "attach-reference", kind: "worker_crash", message: "boom", failureDir: "y", now: new Date() });
    await db.applyPlan(cause.b, failure.plan);
    await prisma.flowWorkerState.upsert({
      where: { id: WORKER_STATE_ID },
      create: { id: WORKER_STATE_ID, pausedReason: failure.pause ?? "", pausedAt: new Date() },
      update: { pausedReason: failure.pause ?? "", pausedAt: new Date() },
    });
    const w = await prisma.flowWorkerState.findUniqueOrThrow({ where: { id: WORKER_STATE_ID } });
    const failedRows = await prisma.flowJob.findMany({ where: { status: FLOW_STATUS.FAILED }, select: { id: true, status: true, errorKind: true, failedStep: true, errorMessage: true, updatedAt: true } });
    const picked = L.pauseCauseJob(w, failedRows);
    check("ต้นเหตุของการหยุด = งานที่เพิ่งพังตอนหยุด ไม่ใช่งานเน็ตสะดุดที่บอทข้ามไปก่อนหน้า · ป้ายไม่ขึ้นเน็ตสะดุด",
      picked?.id === cause.b && L.pausedReasonLabel(w.pausedReason, picked) === ERROR_KIND_LABELS.worker_crash,
      JSON.stringify({ picked: picked?.id, cause: cause.b, earlier: earlier.b }));
    const r = await capture(() => db.unpauseQueueOnly(prisma));
    check("unpauseQueueOnly(db) รับ client ที่ส่งเข้ามา · ปลดได้", r.ok && (r.value as { unpaused: boolean }).unpaused === true, JSON.stringify(r));
  }
  for (const reason of ["captcha", "login_required", "host_unsupported", "selector_drift", "flow_error", "download_failed", ""]) {
    await setPause(reason);
    const r = await capture(() => db.unpauseQueueOnly());
    const w = await snapWorker();
    check(
      `${reason || "(ไม่ได้หยุด)"}: ปฏิเสธ · การหยุดคงเดิม`,
      r.ok && (r.value as { unpaused: boolean }).unpaused === false && w?.pausedReason === reason,
      JSON.stringify({ r, w }),
    );
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

/**
 * ด่านสุดท้ายของบอทก่อน drawImages (ticket 07): ชื่อกลายเป็นชื่อเต็มของร้านหลังหยิบงาน → คืนงานเข้าคิวรอบเดิม ไม่ใช่งานพัง
 * (ไม่ failed ไม่ปลด/ไม่ตั้ง pause ไม่ลง FlowActivity) · where = running ของรอบนั้น (สถานะเปลี่ยนไปแล้ว = 0 แถว ไม่แตะ)
 */
async function shortNameReleases() {
  console.log("\n== คืนงานเข้าคิวเมื่อชื่อยังเป็นชื่อร้าน ==");
  for (const round of [1, 2] as FlowRound[]) {
    const p = await makePair({ status: queuedStatus(round), round, attempt: 3, extraPrompt: "keep", flowProjectId: round === 2 ? "proj" : "" });
    await NEW.claim(p.b, round);
    const claimed = await snapJob(p.b);
    await pauseForTest();
    const w0 = JSON.stringify(await snapWorker());
    const acts0 = await prisma.flowActivity.count({ where: { jobId: p.b } });
    const n = await db.applyBulk(L.releaseForShortName(round), { id: p.b });
    const j = await snapJob(p.b);
    check(
      `releaseForShortName รอบ ${round}: running_r${round} → queued_r${round} · round/attempt/extraPrompt/project คงเดิม · ไม่มีร่องรอยพัง · การหยุดไม่เปลี่ยน · ไม่มี FlowActivity`,
      n === 1 && j.status === queuedStatus(round) && JSON.stringify({ ...j, status: claimed.status }) === JSON.stringify(claimed) &&
        j.errorKind === "" && j.failedStep === "" && JSON.stringify(await snapWorker()) === w0 &&
        (await prisma.flowActivity.count({ where: { jobId: p.b } })) === acts0,
      JSON.stringify({ n, j, claimed }),
    );
    const again = await db.applyBulk(L.claim(round, new Date()), { id: p.b });
    check(`คืนแล้วบอทหยิบงานเดิมได้อีก (รอบ ${round})`, again === 1, String(again));
  }
  // กันแข่ง: สถานะไม่ใช่ running ของรอบนั้นแล้ว (เช่น stale sweep ตีเป็น failed) → 0 แถว ไม่แตะ
  {
    const p = await makePair({ status: FLOW_STATUS.FAILED, round: 1, attempt: 1, failedStep: "x", errorKind: "worker_crash" });
    const before = JSON.stringify(await snapJob(p.b));
    const n = await db.applyBulk(L.releaseForShortName(1), { id: p.b });
    check("releaseForShortName บนงานที่ไม่ใช่ running_r1 → 0 แถว ไม่แตะงาน", n === 0 && before === JSON.stringify(await snapJob(p.b)), String(n));
  }
}

/**
 * แก้ 10-part prompt ที่ /flow (ticket 03) — ไม่มีของเดิมให้เทียบ จึงเช็กแถว PromptEntry / FlowJob / FlowJobImage ตรงๆ
 * "บันทึกแล้วเรนเดอร์ใหม่" = บันทึกพรอมต์ + transition เรนเดอร์ใหม่ใน transaction เดียว · running_r3 = บันทึกแต่ไม่แตะงาน
 */
async function promptSaves() {
  console.log("\n== แก้พรอมต์ที่ /flow ==");
  const OLD_TEXT = "พรอมต์เดิม 1) ...";
  const NEW_TEXT = "พรอมต์ใหม่ที่แก้แล้ว 1) ...";
  const entryText = async (id: string) => (await prisma.promptEntry.findUniqueOrThrow({ where: { id } })).chatgptOutput;
  async function seed(job: Record<string, unknown> & { status: string }, images: ImgSeed[] = []) {
    const p = await makePair(job, images);
    await prisma.promptEntry.update({ where: { id: p.entryB }, data: { chatgptOutput: OLD_TEXT } });
    return p;
  }

  // แก้ได้: queued_r3 / failed รอบ 3 — บันทึกอย่างเดียว งานไม่ขยับ ไม่สร้างคลิป
  for (const [status, round] of [[FLOW_STATUS.QUEUED_R3, 3], [FLOW_STATUS.FAILED, 3]] as [string, number][]) {
    const p = await seed({ status, round, attempt: 2, extraPrompt: "keep", failedStep: status === FLOW_STATUS.FAILED ? "x" : "", errorKind: status === FLOW_STATUS.FAILED ? "flow_error" : "" });
    const before = JSON.stringify(await snapJob(p.b));
    const r = await capture(() => db.applyPromptSave({ jobId: p.b, text: NEW_TEXT, rerender: false }));
    const v = r.ok ? (r.value as Awaited<ReturnType<typeof db.applyPromptSave>>) : null;
    check(
      `บันทึกพรอมต์ ${status} r${round}: ช่อง chatgptOutput ของ entry เปลี่ยน · งานไม่เปลี่ยน · คืน stage/ความยาวก่อน-หลัง`,
      r.ok && (await entryText(p.entryB)) === NEW_TEXT && before === JSON.stringify(await snapJob(p.b)) &&
        v?.saved === true && v.rerendered === false && v.botRunning === false && v.stage === status &&
        v.lengthBefore === OLD_TEXT.length && v.lengthAfter === NEW_TEXT.length,
      JSON.stringify({ r }),
    );
  }

  // review_r3 บันทึกอย่างเดียว: คลิปตัวอย่างยังอยู่ งานยังรอดูคลิป
  {
    const p = await seed({ status: FLOW_STATUS.REVIEW_R3, round: 3, attempt: 1 }, [VIDEO_720]);
    const before = JSON.stringify(await snapJob(p.b));
    const r = await capture(() => db.applyPromptSave({ jobId: p.b, text: NEW_TEXT, rerender: false }));
    check("review_r3 + บันทึกอย่างเดียว: พรอมต์เปลี่ยน · คลิป/สถานะ/attempt ไม่เปลี่ยน", r.ok && (await entryText(p.entryB)) === NEW_TEXT && before === JSON.stringify(await snapJob(p.b)), JSON.stringify(r));
  }

  // review_r3 + เรนเดอร์ใหม่: พรอมต์ + transition เดียวกับปุ่ม "เรนเดอร์ใหม่" (เทียบ NEW.redo ของงานคู่ที่ไม่ได้แก้พรอมต์)
  {
    const p = await seed({ status: FLOW_STATUS.REVIEW_R3, round: 3, attempt: 1, extraPrompt: "เก่า" }, [VIDEO_720]);
    await prisma.promptEntry.update({ where: { id: p.entryA }, data: { chatgptOutput: OLD_TEXT } });
    await NEW.redo(p.a, "ต่อท้ายใหม่");
    const r = await capture(() => db.applyPromptSave({ jobId: p.b, text: NEW_TEXT, rerender: true, extraPrompt: "ต่อท้ายใหม่" }));
    const v = r.ok ? (r.value as Awaited<ReturnType<typeof db.applyPromptSave>>) : null;
    const sa = await snapJob(p.a);
    const sb = await snapJob(p.b);
    check(
      "review_r3 + เรนเดอร์ใหม่: งานเหมือน redo ปกติ (queued_r3, attempt+1, คลิปเก่าหาย, extraPrompt) · พรอมต์ใหม่บันทึกพร้อมกัน",
      r.ok && JSON.stringify(sa) === JSON.stringify(sb) && sb.status === FLOW_STATUS.QUEUED_R3 && sb.attempt === 2 && sb.images.length === 0 &&
        (await entryText(p.entryB)) === NEW_TEXT && v?.rerendered === true && v.saved === true && v.videoFilenames.join() === VIDEO_720.filename,
      JSON.stringify({ r, sa, sb }),
    );
  }

  // transaction เดียวจริง: เขียนงานล้ม (trigger ชั่วคราวบนสำเนา DB) → พรอมต์ต้องไม่ถูกบันทึก คลิปตัวอย่างต้องไม่ถูกลบ
  {
    const p = await seed({ status: FLOW_STATUS.REVIEW_R3, round: 3, attempt: 1 }, [VIDEO_720]);
    const before = JSON.stringify(await snapJob(p.b));
    await prisma.$executeRawUnsafe(`CREATE TRIGGER check_prompt_save_boom BEFORE UPDATE ON FlowJob WHEN NEW.id = '${p.b}' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    let r: Outcome;
    try {
      r = await capture(() => db.applyPromptSave({ jobId: p.b, text: NEW_TEXT, rerender: true }));
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS check_prompt_save_boom");
    }
    check("บันทึก+เรนเดอร์ใหม่ล้มกลางทาง → ไม่มีอะไรถูกเขียน (พรอมต์เดิม · คลิปยังอยู่ · สถานะเดิม)", !r.ok && (await entryText(p.entryB)) === OLD_TEXT && before === JSON.stringify(await snapJob(p.b)), JSON.stringify(r));
  }

  // บอทหยิบงานไปแล้ว (running_r3): พรอมต์ยังบันทึก · งานไม่ถูกแตะแม้ขอเรนเดอร์ใหม่ · บอกว่า botRunning
  for (const rerender of [false, true]) {
    const p = await seed({ status: FLOW_STATUS.RUNNING_R3, round: 3, attempt: 1 });
    const before = JSON.stringify(await snapJob(p.b));
    const r = await capture(() => db.applyPromptSave({ jobId: p.b, text: NEW_TEXT, rerender }));
    const v = r.ok ? (r.value as Awaited<ReturnType<typeof db.applyPromptSave>>) : null;
    check(
      `running_r3 (rerender=${rerender}): พรอมต์ถูกบันทึก · งานไม่ถูกแตะ · botRunning=true rerendered=false`,
      r.ok && (await entryText(p.entryB)) === NEW_TEXT && before === JSON.stringify(await snapJob(p.b)) && v?.saved === true && v.botRunning === true && v.rerendered === false,
      JSON.stringify({ r }),
    );
  }

  // แข่งกับบอท: ผู้ใช้เห็น queued_r3 แล้วกดบันทึก แต่บอทหยิบก่อน action อ่านงาน → บันทึกแล้วบอกว่ารอบนี้ใช้พรอมต์เดิม
  {
    const p = await seed({ status: FLOW_STATUS.QUEUED_R3, round: 3, attempt: 1 });
    await NEW.claim(p.b, 3);
    const r = await capture(() => db.applyPromptSave({ jobId: p.b, text: NEW_TEXT, rerender: false }));
    const v = r.ok ? (r.value as Awaited<ReturnType<typeof db.applyPromptSave>>) : null;
    check("แข่งกับบอท: บอทหยิบ queued_r3 ก่อนกดบันทึก → พรอมต์บันทึก + botRunning · งานยัง running_r3", r.ok && (await entryText(p.entryB)) === NEW_TEXT && v?.botRunning === true && (await snapJob(p.b)).status === FLOW_STATUS.RUNNING_R3, JSON.stringify(r));
  }

  // แข่งอีกแบบ: หน้าจอเห็น review_r3 แล้วกด "บันทึกแล้วเรนเดอร์ใหม่" แต่อีกแท็บเรนเดอร์ใหม่ไปแล้ว (queued_r3) → บันทึกพรอมต์ ไม่เรนเดอร์ซ้ำ (attempt ไม่เพิ่มอีก)
  {
    const p = await seed({ status: FLOW_STATUS.QUEUED_R3, round: 3, attempt: 2 });
    const before = JSON.stringify(await snapJob(p.b));
    const r = await capture(() => db.applyPromptSave({ jobId: p.b, text: NEW_TEXT, rerender: true }));
    const v = r.ok ? (r.value as Awaited<ReturnType<typeof db.applyPromptSave>>) : null;
    check("เรนเดอร์ใหม่ตอนงานไม่ใช่ review_r3 แล้ว: พรอมต์บันทึก · rerendered=false · attempt ไม่เพิ่ม", r.ok && (await entryText(p.entryB)) === NEW_TEXT && v?.rerendered === false && before === JSON.stringify(await snapJob(p.b)), JSON.stringify(r));
  }

  // สถานะอื่น: ปฏิเสธ ไม่แตะพรอมต์/งาน
  for (const [status, round] of [
    [FLOW_STATUS.AWAITING_PROMPT, 3], [FLOW_STATUS.DONE, 4], [FLOW_STATUS.SKIPPED, 3], [FLOW_STATUS.FAILED, 2], [FLOW_STATUS.FAILED, 4],
    [FLOW_STATUS.REVIEW_R1, 1], [FLOW_STATUS.QUEUED_UPSCALE, 4],
  ] as [string, number][]) {
    const p = await seed({ status, round, attempt: 1 });
    const before = JSON.stringify(await snapJob(p.b));
    const r = await capture(() => db.applyPromptSave({ jobId: p.b, text: NEW_TEXT, rerender: true }));
    const v = r.ok ? (r.value as Awaited<ReturnType<typeof db.applyPromptSave>>) : null;
    check(`${status} r${round}: ปฏิเสธ — พรอมต์/งานไม่เปลี่ยน · saved=false`, r.ok && v?.saved === false && (await entryText(p.entryB)) === OLD_TEXT && before === JSON.stringify(await snapJob(p.b)), JSON.stringify(r));
  }

  // ไม่มีงาน → error
  {
    const r = await capture(() => db.applyPromptSave({ jobId: "no-such-job", text: NEW_TEXT, rerender: false }));
    check("ไม่พบงาน → error", !r.ok, JSON.stringify(r));
  }
}

/**
 * เปลี่ยนรูปต้นทาง (ticket 05) — NEW-only (ไม่มีของเดิม): งานเดิมกลับไปรอวาดรอบ 1 · แถว source/candidate เก่าอยู่ครบ · chosen ล้าง ·
 * งานพัง = ปลดการหยุด · เขียนแบบมีเงื่อนไขบนสถานะที่อ่านมา (แข่งกับบอท = ไม่แตะอะไร) · ไฟล์จริงในโฟลเดอร์ชั่วคราว (ไม่แตะ uploads/)
 */
async function changeSources() {
  console.log("\n== เปลี่ยนรูปต้นทาง ==");
  const SEED: ImgSeed[] = [
    { kind: "source", round: 0, attempt: 1, index: 0, filename: "source-0.jpg" },
    { kind: "candidate", round: 1, attempt: 1, index: 0, filename: "r1-a1-0.png" },
    { kind: "candidate", round: 1, attempt: 2, index: 1, filename: "r1-a2-1.png", chosen: true },
    { kind: "candidate", round: 2, attempt: 1, index: 3, filename: "r2-a1-3.png", chosen: true },
  ];
  const input = (extra: unknown = "") => ({ extraPrompt: extra, mimeType: "image/png", nonce: "t1" });
  const seeds: [string, number][] = [
    [FLOW_STATUS.QUEUED_R1, 1], [FLOW_STATUS.REVIEW_R1, 1], [FLOW_STATUS.QUEUED_R2, 2], [FLOW_STATUS.REVIEW_R2, 2],
    [FLOW_STATUS.AWAITING_PROMPT, 3], [FLOW_STATUS.QUEUED_R3, 3], [FLOW_STATUS.FAILED, 1], [FLOW_STATUS.FAILED, 2], [FLOW_STATUS.SKIPPED, 2],
  ];
  for (const [status, round] of seeds) {
    const failed = status === FLOW_STATUS.FAILED;
    const p = await makePair(
      { status, round, attempt: round === 3 ? 1 : 2, extraPrompt: "เก่า", failedStep: failed ? "wait-results" : "", errorKind: failed ? "captcha" : "", errorMessage: failed ? "x" : "", failureDir: failed ? "d" : "", finishedAt: status === FLOW_STATUS.SKIPPED ? SENTINEL : null },
      SEED,
    );
    await pauseForTest();
    const job = await jobWithImages(p.b);
    const plan = L.changeSource(job, input(" ใหม่\nนะ "));
    const r = await db.applyChangeSource(p.b, plan, job.status);
    const j = await snapJob(p.b);
    const w = await snapWorker();
    const sources = j.images.filter((i) => i.kind === "source");
    const cands = j.images.filter((i) => i.kind === "candidate");
    check(
      `changeSource ${status} r${round} → queued_r1 รอบ 1 attempt 3 · ล้างพัง/finishedAt · extra ใหม่ · ${failed ? "ปลดการหยุด" : "ยังหยุดอยู่"}`,
      r === "changed" && j.status === FLOW_STATUS.QUEUED_R1 && j.round === 1 && j.attempt === 3 && j.extraPrompt === "ใหม่ นะ" &&
        j.failedStep === "" && j.errorKind === "" && j.errorMessage === "" && j.failureDir === "" && j.finishedAt === null &&
        (failed ? w?.pausedReason === "" : w?.pausedReason === "test_pause"),
      JSON.stringify({ r, j, w }),
    );
    check(
      `changeSource ${status}: แถว source/candidate เก่าอยู่ครบ · chosen ล้างหมด · source ใหม่ attempt 3`,
      sources.length === 2 && sources.some((s) => s.filename === "source-0.jpg" && s.attempt === 1) &&
        sources.some((s) => s.filename === "source-a3-0-t1.png" && s.attempt === 3 && s.round === 0 && s.index === 0) &&
        cands.length === 3 && cands.every((c) => c.chosen === false),
      JSON.stringify(j.images),
    );
  }
  // gate ปฏิเสธก่อนแตะ DB
  for (const [status, round] of [[FLOW_STATUS.RUNNING_R1, 1], [FLOW_STATUS.REVIEW_R3, 3], [FLOW_STATUS.FAILED, 3], [FLOW_STATUS.DONE, 2]] as const) {
    const p = await makePair({ status, round, attempt: 1 }, SEED);
    const before = JSON.stringify(await snapJob(p.b));
    const r = await capture(async () => L.changeSource(await jobWithImages(p.b), input()));
    check(`changeSource ${status} r${round} → error ไม่แตะงาน`, !r.ok && before === JSON.stringify(await snapJob(p.b)), JSON.stringify(r));
  }
  // แข่งกับบอท: อ่านตอน queued_r2 แต่บอทหยิบไปก่อนเขียน → 0 แถว · ไม่มีแถว source ใหม่ · chosen ไม่ถูกล้าง
  {
    const p = await makePair({ status: FLOW_STATUS.QUEUED_R2, round: 2, attempt: 1 }, SEED);
    const stale = await jobWithImages(p.b);
    const stalePlan = L.changeSource(stale, input());
    await NEW.claim(p.b, 2);
    await pauseForTest();
    const before = JSON.stringify(await snapJob(p.b));
    const r = await db.applyChangeSource(p.b, stalePlan, stale.status);
    check("แข่งกับบอท: บอทหยิบก่อน → status_changed · งาน/แถวรูปไม่เปลี่ยนเลย", r === "status_changed" && before === JSON.stringify(await snapJob(p.b)), JSON.stringify({ r }));
  }
  // แข่งฝั่งงานพัง: อ่านตอน failed (แผนมี unpause) แต่อีกแท็บ "รันต่อ" ไปแล้ว → ไม่ปลดการหยุด ไม่แตะงาน
  {
    const p = await makePair({ status: FLOW_STATUS.FAILED, round: 1, attempt: 1, failedStep: "x", errorKind: "flow_error" }, SEED);
    const stale = await jobWithImages(p.b);
    const stalePlan = L.changeSource(stale, input());
    await NEW.resume(p.b);
    await pauseForTest();
    const r = await db.applyChangeSource(p.b, stalePlan, stale.status);
    const j = await snapJob(p.b);
    check("แข่ง (failed → รันต่อแล้ว): status_changed · ไม่ปลดการหยุด · ไม่มี source ใหม่",
      r === "status_changed" && (await snapWorker())?.pausedReason === "test_pause" && j.images.filter((i) => i.kind === "source").length === 1, JSON.stringify({ r, j }));
  }
  // งานที่ถูกข้ามแต่ entry มีงานใหม่กว่าแล้ว → ไม่เปิดงานเก่ากลับมา (entry จะมีงานเปิดสองงาน)
  {
    const p = await makePair({ status: FLOW_STATUS.SKIPPED, round: 1, attempt: 1 }, SEED);
    await prisma.flowJob.create({ data: { entryId: p.entryB, status: FLOW_STATUS.QUEUED_R1, createdAt: new Date(Date.now() + 1000) } });
    const stale = await jobWithImages(p.b);
    const before = JSON.stringify(await snapJob(p.b));
    const r = await db.applyChangeSource(p.b, L.changeSource(stale, input()), stale.status);
    check("งานถูกข้ามที่มีงานใหม่กว่าใน entry → newer_job ไม่แตะงานเก่า", r === "newer_job" && before === JSON.stringify(await snapJob(p.b)), JSON.stringify({ r }));
  }

  // ---- ทั้งเส้นพร้อมไฟล์ (lib/flow-change-source.ts — ที่ server action เรียก) บนโฟลเดอร์ชั่วคราว ----
  const fs = await import("node:fs");
  const os = await import("node:os");
  const cs = await import("@/lib/flow-change-source");
  const ai = await import("@/lib/auto-source-image");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-change-source-"));
  try {
    const entryId = await newEntry();
    const flowDir = path.join(root, entryId, "flow");
    fs.mkdirSync(flowDir, { recursive: true });
    for (const s of SEED) fs.writeFileSync(path.join(flowDir, s.filename), `old:${s.filename}`);
    const job = await prisma.flowJob.create({ data: { entryId, status: FLOW_STATUS.REVIEW_R2, round: 2, attempt: 1 } });
    for (const im of SEED) await prisma.flowJobImage.create({ data: { jobId: job.id, mimeType: "image/png", ...im } });
    // รูปต้นทางอัตโนมัติเดิม (ticket 04) + รูปที่ผู้ใช้เพิ่มเอง + รูปที่ Flow วาดซึ่งเลือกรอบ 2 ไปแล้ว (auto-flow- — ของรูปต้นทางเก่า)
    fs.writeFileSync(path.join(root, entryId, "auto-source-old.jpg"), "old-auto");
    fs.writeFileSync(path.join(root, entryId, "user.png"), "user");
    fs.writeFileSync(path.join(root, entryId, "auto-flow-old.png"), "old-flow");
    await prisma.productImage.create({ data: { entryId, filename: "auto-source-old.jpg", mimeType: "image/jpeg", caption: "", sortOrder: 0 } });
    await prisma.productImage.create({ data: { entryId, filename: "user.png", mimeType: "image/png", caption: "", sortOrder: 1 } });
    await prisma.productImage.create({ data: { entryId, filename: "auto-flow-old.png", mimeType: "image/png", caption: "สินค้าตอนใช้งาน", sortOrder: 2 } });

    const r1 = await cs.changeSourcePhoto({ root, jobId: job.id, image: { buffer: Buffer.from("new-1"), mimeType: "image/jpeg" }, extraPrompt: "" });
    const after1 = await jobWithImages(job.id);
    const src1 = after1.images.filter((i) => i.kind === "source");
    const newest1 = src1.sort((a, b) => b.attempt - a.attempt)[0];
    check("changeSourcePhoto: ok · งาน queued_r1 attempt 3 · ไฟล์ใหม่ชื่อไม่ซ้ำเขียนแล้ว (เนื้อไฟล์ตรง)",
      r1.ok && after1.status === FLOW_STATUS.QUEUED_R1 && after1.attempt === 3 && /^source-a3-0-[0-9a-f]{8}\.jpg$/.test(newest1.filename) &&
        fs.readFileSync(path.join(flowDir, newest1.filename), "utf8") === "new-1",
      JSON.stringify({ r1, images: after1.images }));
    check("changeSourcePhoto: ไฟล์ source/candidate เดิมยังอยู่ไม่ถูกเขียนทับ",
      SEED.every((s) => fs.readFileSync(path.join(flowDir, s.filename), "utf8") === `old:${s.filename}`));
    const pis = await prisma.productImage.findMany({ where: { entryId }, orderBy: { sortOrder: "asc" } });
    check("changeSourcePhoto: รูปต้นทางอัตโนมัติในหน้า entry เปลี่ยนตาม (แถว+ไฟล์เก่าออก · รูป Flow อัตโนมัติของรูปเก่าออก · รูปที่ผู้ใช้เพิ่มเองอยู่)",
      pis.length === 2 && ai.isAutoSourceImage(pis[0].filename) && pis[0].filename !== "auto-source-old.jpg" && pis[1].filename === "user.png" &&
        fs.readFileSync(path.join(root, entryId, pis[0].filename), "utf8") === "new-1" && !fs.existsSync(path.join(root, entryId, "auto-source-old.jpg")) &&
        !fs.existsSync(path.join(root, entryId, "auto-flow-old.png")),
      JSON.stringify(pis));

    // เปลี่ยนซ้ำทันที (ยัง queued_r1) → attempt 4 ไฟล์ใหม่อีกชื่อ ของ attempt 3 ยังอยู่
    const r2 = await cs.changeSourcePhoto({ root, jobId: job.id, image: { buffer: Buffer.from("new-2"), mimeType: "image/png" }, extraPrompt: "เอาแค่ชิ้นเดียว" });
    const after2 = await jobWithImages(job.id);
    const src2 = after2.images.filter((i) => i.kind === "source");
    check("changeSourcePhoto ซ้ำ: attempt 4 · แถว source 3 แถว ไฟล์ครบทุกตัว · extraPrompt ใหม่",
      r2.ok && after2.attempt === 4 && after2.extraPrompt === "เอาแค่ชิ้นเดียว" && src2.length === 3 &&
        src2.every((s) => fs.existsSync(path.join(flowDir, s.filename))) && new Set(src2.map((s) => s.filename)).size === 3,
      JSON.stringify(after2.images));

    // ปฏิเสธ (บอทกำลังทำ) → ไม่เหลือไฟล์ใหม่ค้าง ไม่แตะรูปสินค้า
    await prisma.flowJob.update({ where: { id: job.id }, data: { status: FLOW_STATUS.RUNNING_R1 } });
    const filesBefore = fs.readdirSync(flowDir).sort().join(",");
    const pisBefore = JSON.stringify(await prisma.productImage.findMany({ where: { entryId } }));
    const r3 = await cs.changeSourcePhoto({ root, jobId: job.id, image: { buffer: Buffer.from("new-3"), mimeType: "image/png" }, extraPrompt: "" });
    check("changeSourcePhoto บอทกำลังทำ → ok=false ข้อความไทย · ไม่มีไฟล์ค้าง · รูปสินค้าไม่เปลี่ยน",
      !r3.ok && r3.message === L.CHANGE_SOURCE_BOT_BUSY_MESSAGE && fs.readdirSync(flowDir).sort().join(",") === filesBefore &&
        JSON.stringify(await prisma.productImage.findMany({ where: { entryId } })) === pisBefore,
      JSON.stringify(r3));
    // ไฟล์ผิดชนิด → ok=false ไม่แตะอะไร
    await prisma.flowJob.update({ where: { id: job.id }, data: { status: FLOW_STATUS.REVIEW_R1 } });
    const r4 = await cs.changeSourcePhoto({ root, jobId: job.id, image: { buffer: Buffer.from("x"), mimeType: "image/heic" }, extraPrompt: "" });
    check("changeSourcePhoto ไฟล์ HEIC → ok=false · งานยัง review_r1", !r4.ok && (await jobWithImages(job.id)).status === FLOW_STATUS.REVIEW_R1, JSON.stringify(r4));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * งานใหม่ของ entry ที่เคยมีงานแล้ว — NEW-only: งานทุกตัวของ entry ใช้โฟลเดอร์ flow/ เดียวกัน ชื่อไฟล์รูปที่วาดคือ r<round>-a<attempt>-<i>
 * งานใหม่ต้องนับ attempt ต่อจากทุกแถวรูปของ entry (ไม่เริ่ม a1 ใหม่จนทับรูปในคลังรูป) · เลือกรอบ 1 → 2 และเปลี่ยนรูปต้นทางก็ดูทั้ง entry
 * เข้าคิวทั้งเส้น (lib/flow-enqueue.ts — ที่ server action เรียก) บนโฟลเดอร์ชั่วคราว
 */
async function newJobAttempts() {
  console.log("\n== งานใหม่ของ entry เดิม: attempt ต่อจากงานก่อน ไม่ทับรูปเก่า ==");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const enq = await import("@/lib/flow-enqueue");
  const cs = await import("@/lib/flow-change-source");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-new-job-attempt-"));
  try {
    const entryId = await newEntry();
    const flowDir = path.join(root, entryId, "flow");
    fs.mkdirSync(flowDir, { recursive: true });
    const OLD_IMAGES: ImgSeed[] = [
      { kind: "source", round: 0, attempt: 1, index: 0, filename: "source-a1-0-old.jpg" },
      { kind: "candidate", round: 1, attempt: 1, index: 0, filename: "r1-a1-0.png" },
      { kind: "candidate", round: 1, attempt: 2, index: 0, filename: "r1-a2-0.png", chosen: true },
      { kind: "candidate", round: 2, attempt: 1, index: 0, filename: "r2-a1-0.png" },
      { kind: "candidate", round: 2, attempt: 2, index: 1, filename: "r2-a2-1.png", chosen: true },
    ];
    const oldJob = await prisma.flowJob.create({ data: { entryId, status: FLOW_STATUS.DONE, round: 3, attempt: 1, createdAt: new Date(Date.now() - 60_000) } });
    for (const im of OLD_IMAGES) {
      await prisma.flowJobImage.create({ data: { jobId: oldJob.id, mimeType: "image/png", ...im } });
      fs.writeFileSync(path.join(flowDir, im.filename), `old:${im.filename}`);
    }

    const r = await enq.enqueueFlowJobFiles({ root, entryId, images: [{ buffer: Buffer.from("new-src"), mimeType: "image/jpeg" }], extraPrompt: "" });
    const job = await jobWithImages(r.jobId);
    const src = job.images.filter((i) => i.kind === "source");
    check("เข้าคิวงานใหม่ของ entry เดิม → attempt 3 (ต่อจาก a2 ของงานก่อน) · แถวรูปต้นทาง attempt 3 ชื่อ source-a3-0-<nonce> · ไฟล์ตรง",
      job.status === FLOW_STATUS.QUEUED_R1 && job.round === 1 && job.attempt === 3 && src.length === 1 && src[0].attempt === 3 &&
        /^source-a3-0-[0-9a-f]{8}\.jpg$/.test(src[0].filename) && fs.readFileSync(path.join(flowDir, src[0].filename), "utf8") === "new-src",
      JSON.stringify(job));

    // บอทวาดรอบ 1 → ชื่อไฟล์ r1-a3-* ไม่ชนไฟล์ของงานก่อน
    await db.applyPlan(job.id, L.imagesReady(1, job, ["png", "png", "png", "png"], "proj-new"));
    const afterR1 = await jobWithImages(job.id);
    const newNames = afterR1.images.filter((i) => i.kind === "candidate").map((i) => i.filename);
    check("รูปรอบ 1 ของงานใหม่ = r1-a3-0..3 ไม่ชนชื่อไฟล์ของงานก่อน",
      newNames.length === 4 && newNames.every((n) => n.startsWith("r1-a3-") && !OLD_IMAGES.some((o) => o.filename === n)), JSON.stringify(newNames));

    // เลือกรอบ 1 → รอบ 2: attempt ของรอบ 2 ต่อจากรอบ 2 ของทุกงานใน entry (งานก่อนใช้ r2-a1, r2-a2)
    const pick = afterR1.images.find((i) => i.kind === "candidate" && i.index === 0)!;
    const entryImages = await db.loadEntryFlowImages(entryId);
    const plan = L.choose({ ...afterR1, images: entryImages }, pick, () => true, new Date());
    check("loadEntryFlowImages = แถวรูปทุกงานของ entry · choose รอบ 1 ด้วยแถวทั้ง entry → รอบ 2 attempt 3 (ไม่ทับ r2-a1/a2 ของงานก่อน)",
      entryImages.length === OLD_IMAGES.length + 5 && plan.job.attempt === 3, JSON.stringify({ n: entryImages.length, attempt: plan.job.attempt }));

    check("ไฟล์ของงานก่อนอยู่ครบ ไม่ถูกเขียนทับ", OLD_IMAGES.every((o) => fs.readFileSync(path.join(flowDir, o.filename), "utf8") === `old:${o.filename}`));

    // เข้าคิวซ้ำตอนมีงานเปิดอยู่ → ปฏิเสธเหมือนเดิม ไม่มีไฟล์ใหม่
    const before = fs.readdirSync(flowDir).sort().join(",");
    const dup = await capture(() => enq.enqueueFlowJobFiles({ root, entryId, images: [{ buffer: Buffer.from("x"), mimeType: "image/png" }], extraPrompt: "" }));
    check("เข้าคิวตอนมีงานค้าง → error · ไม่มีไฟล์ใหม่", !dup.ok && fs.readdirSync(flowDir).sort().join(",") === before, JSON.stringify(dup));

    // งานที่เข้าคิวก่อนแก้นี้ (เริ่ม a1 ซ้ำกับงานก่อน) — เปลี่ยนรูปต้นทางต้องดูแถวทั้ง entry: attempt เกินทุก attempt ของทุกงาน
    const entry2 = await newEntry();
    const dir2 = path.join(root, entry2, "flow");
    fs.mkdirSync(dir2, { recursive: true });
    const prior = await prisma.flowJob.create({ data: { entryId: entry2, status: FLOW_STATUS.SKIPPED, round: 1, attempt: 5, createdAt: new Date(Date.now() - 60_000) } });
    await prisma.flowJobImage.create({ data: { jobId: prior.id, kind: "candidate", round: 1, attempt: 5, index: 0, filename: "r1-a5-0.png", mimeType: "image/png" } });
    const legacy = await prisma.flowJob.create({ data: { entryId: entry2, status: FLOW_STATUS.REVIEW_R1, round: 1, attempt: 1 } });
    await prisma.flowJobImage.create({ data: { jobId: legacy.id, kind: "source", round: 0, attempt: 1, index: 0, filename: "source-0.jpg", mimeType: "image/jpeg" } });
    const changed = await cs.changeSourcePhoto({ root, jobId: legacy.id, image: { buffer: Buffer.from("n"), mimeType: "image/png" }, extraPrompt: "" });
    check("เปลี่ยนรูปต้นทางของงานที่มีงานก่อนใน entry → attempt 6 (เกิน a5 ของงานก่อน ไม่ทับ r1-a2..a5)",
      changed.ok && changed.attempt === 6 && (await jobWithImages(legacy.id)).attempt === 6, JSON.stringify(changed));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * คลังรูป (ticket 06) — NEW-only: read model (lib/photo-library-db.ts) บน DB + โฟลเดอร์ชั่วคราว: รูปจากร้านยุบซ้ำข้ามแถว Showcase ·
 * รูปที่ Flow วาดทุก attempt อยู่ครบหลังเปลี่ยนรูปต้นทาง · ธงรูปต้นทาง/อยู่ในรูปสินค้าแล้วตามเนื้อไฟล์ · "เพิ่มเข้ารูปสินค้า"
 */
async function photoLibrary() {
  console.log("\n== คลังรูป ==");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const enq = await import("@/lib/flow-enqueue");
  const cs = await import("@/lib/flow-change-source");
  const lib = await import("@/lib/photo-library-db");
  const ai = await import("@/lib/auto-source-image");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-photo-library-"));
  // (batchId, sourceProductId) ไม่ซ้ำ — แถวสแกนซ้ำของสินค้าเดียวกันอยู่คนละชุดเสมอ
  const batch = await prisma.candidateBatch.create({ data: { capturedOn: new Date() } });
  const batch2 = await prisma.candidateBatch.create({ data: { capturedOn: new Date(Date.now() - 5000) } });
  try {
    const entryId = await newEntry();
    const pid = `__lib-test-${Date.now()}`;
    const cand = (name: string, linked: string | null, capturedOn: Date, batchId: string) =>
      prisma.productCandidate.create({
        data: { batchId, name, nameKey: name, price: 1, commission: 1, categoryLabel: "x", capturedOn, sourceProductId: pid, linkedEntryId: linked },
      });
    // แถวที่ผูกกับ entry ไม่มีรูป + แถวสแกนซ้ำ (sourceProductId เดียวกัน) ที่มีรูป 2 รูป → รูปจากร้าน = 2 รูปของแถวสแกนซ้ำ
    await cand("ผูกแล้ว", entryId, new Date(Date.now() - 1000), batch.id);
    const dupRow = await cand("สแกนซ้ำ", null, new Date(Date.now() - 5000), batch2.id);
    const shopBytes: Record<string, string> = { "p1.jpg": "shop-photo-1", "p2.jpg": "shop-photo-2-xx" };
    fs.mkdirSync(path.join(root, "_candidates", dupRow.id), { recursive: true });
    for (const [i, [name, bytes]] of Object.entries(shopBytes).entries()) {
      fs.writeFileSync(path.join(root, "_candidates", dupRow.id, name), bytes);
      await prisma.candidateImage.create({ data: { candidateId: dupRow.id, filename: name, mimeType: "image/jpeg", sortOrder: i } });
    }

    // เข้าคิวด้วยรูปจากร้าน p2 ทั้งรูป (ไม่ครอป = ไบต์เดียวกัน) → รูปต้นทางอัตโนมัติในรูปสินค้า
    const q = await enq.enqueueFlowJobFiles({ root, entryId, images: [{ buffer: Buffer.from(shopBytes["p2.jpg"]), mimeType: "image/jpeg" }], extraPrompt: "" });
    const job = await jobWithImages(q.jobId);
    await db.applyPlan(job.id, L.imagesReady(1, job, ["png", "png", "png", "png"], "proj"));
    const drawn = (await jobWithImages(job.id)).images.filter((i) => i.kind === "candidate");
    for (const d of drawn) fs.writeFileSync(path.join(root, entryId, "flow", d.filename), `drawn:${d.filename}`);

    const L1 = await lib.getPhotoLibrary(entryId, root);
    check("คลังรูป: รูปจากร้านยุบซ้ำข้ามแถว Showcase (sourceProductId เดียวกัน) = 2 รูป · รูปที่ Flow วาด 4 รูป · src ผ่าน /api/uploads",
      L1.shopPhotos.length === 2 && L1.flowImages.length === 4 && L1.shopPhotos[0].src === `/api/uploads/_candidates/${dupRow.id}/p1.jpg` &&
        L1.flowImages.every((f) => f.src.startsWith(`/api/uploads/${entryId}/flow/r1-a1-`)),
      JSON.stringify(L1));
    check("คลังรูป: รูปจากร้านที่ใช้เข้าคิวทั้งรูป = รูปต้นทางตอนนี้ + อยู่ในรูปสินค้าแล้ว · รูปอื่นไม่มีธง · ใช้เป็นรูปต้นทางใหม่ได้ (review_r1)",
      L1.shopPhotos.map((p) => [p.isCurrentSource, p.inProductImages]).join("|") === "false,false|true,true" &&
        L1.flowImages.every((f) => !f.isCurrentSource && !f.inProductImages) && L1.sourceChange?.allowed === true && L1.sourceChange.jobId === job.id,
      JSON.stringify(L1));

    // เปลี่ยนรูปต้นทางเป็นรูปที่ Flow วาด (ทั้งรูป) → รูปเก่ายังอยู่ในคลังครบ · ธงย้ายไปรูปนั้น
    const pick = L1.flowImages[2];
    const changed = await cs.changeSourcePhoto({ root, jobId: job.id, image: { buffer: Buffer.from(`drawn:${pick.filename}`), mimeType: "image/png" }, extraPrompt: "" });
    const L2 = await lib.getPhotoLibrary(entryId, root);
    check("คลังรูป: หลังเปลี่ยนรูปต้นทาง รูปที่ Flow วาดชุดเก่ายังถูกลิสต์ครบ 4 รูป",
      changed.ok && L2.flowImages.length === 4 && L1.flowImages.every((a) => L2.flowImages.some((b) => b.key === a.key)), JSON.stringify(L2.flowImages));
    check("คลังรูป: หลังเปลี่ยน ธงรูปต้นทาง/รูปสินค้าย้ายไปรูปที่ Flow วาดที่เลือก · รูปจากร้านเดิมไม่มีธงแล้ว (รูปต้นทางอัตโนมัติถูกแทน)",
      L2.flowImages.filter((f) => f.isCurrentSource && f.inProductImages).map((f) => f.key).join() === pick.key &&
        L2.shopPhotos.every((p) => !p.isCurrentSource && !p.inProductImages) && L2.currentSource !== null,
      JSON.stringify(L2));

    // "เพิ่มเข้ารูปสินค้า": ก๊อป (ครอปหรือไม่ก็ได้) เข้าโฟลเดอร์ของ entry + แถว caption ว่าง ต่อท้าย · ไม่ใช้ prefix สงวน
    const before = await prisma.productImage.findMany({ where: { entryId }, orderBy: { sortOrder: "asc" } });
    const added = await lib.addPhotoToProductImages({ root, entryId, image: { buffer: Buffer.from(shopBytes["p1.jpg"]), mimeType: "image/jpeg" } });
    const after = await prisma.productImage.findMany({ where: { entryId }, orderBy: { sortOrder: "asc" } });
    const row = after[after.length - 1];
    check("เพิ่มเข้ารูปสินค้า: แถวใหม่ท้ายสุด caption ว่าง · ชื่อ <uuid>.jpg (ไม่ใช่รูปอัตโนมัติ) · ไฟล์ในโฟลเดอร์ entry เนื้อตรง",
      added.ok && after.length === before.length + 1 && row.caption === "" && row.sortOrder > Math.max(...before.map((b) => b.sortOrder)) &&
        !ai.isAutomaticProductImage(row.filename) && /^[0-9a-f-]{36}\.jpg$/.test(row.filename) &&
        fs.readFileSync(path.join(root, entryId, row.filename), "utf8") === shopBytes["p1.jpg"],
      JSON.stringify({ added, after }));
    const L3 = await lib.getPhotoLibrary(entryId, root);
    check("คลังรูป: รูปที่เพิ่มแล้วขึ้นธงอยู่ในรูปสินค้าแล้ว", L3.shopPhotos[0].inProductImages && !L3.shopPhotos[0].isCurrentSource, JSON.stringify(L3.shopPhotos));
    const again = await lib.addPhotoToProductImages({ root, entryId, image: { buffer: Buffer.from(shopBytes["p1.jpg"]), mimeType: "image/jpeg" } });
    check("เพิ่มรูปเดิมซ้ำ (เนื้อไฟล์เดียวกัน) → ok=false ข้อความไทย · ไม่มีแถว/ไฟล์ใหม่",
      !again.ok && again.message.includes("อยู่ในรูปสินค้าแล้ว") && (await prisma.productImage.count({ where: { entryId } })) === after.length &&
        fs.readdirSync(path.join(root, entryId)).filter((f) => f !== "flow").length === after.length,
      JSON.stringify(again));
    const cropped = await lib.addPhotoToProductImages({ root, entryId, image: { buffer: Buffer.from("cropped-bytes"), mimeType: "image/png" } });
    check("เพิ่มรูปที่ครอปแล้ว (เนื้อไม่ตรงรูปไหน) → แถวใหม่ .png", cropped.ok && (await prisma.productImage.count({ where: { entryId } })) === after.length + 1, JSON.stringify(cropped));
    const bad = await lib.addPhotoToProductImages({ root, entryId, image: { buffer: Buffer.from("x"), mimeType: "image/heic" } });
    const noEntry = await lib.addPhotoToProductImages({ root, entryId: "no-such-entry", image: { buffer: Buffer.from("x"), mimeType: "image/png" } });
    check("เพิ่มรูปผิดชนิด / entry ไม่มี → ok=false ไม่แตะอะไร", !bad.ok && !noEntry.ok && !fs.existsSync(path.join(root, "no-such-entry")), JSON.stringify({ bad, noEntry }));

    // สินค้าที่ไม่ได้มาจาก Showcase → ไม่มีรูปจากร้าน (โชว์เฉพาะรูปที่ Flow วาด) · ไม่มีงาน = ไม่มีปุ่มเปลี่ยนรูปต้นทาง
    const plain = await newEntry();
    const L4 = await lib.getPhotoLibrary(plain, root);
    check("entry ไม่ได้มาจาก Showcase + ไม่มีงาน → คลังว่าง · ไม่มีรูปต้นทาง · ไม่มีปุ่มเปลี่ยน",
      L4.shopPhotos.length === 0 && L4.flowImages.length === 0 && L4.currentSource === null && L4.sourceChange === null, JSON.stringify(L4));
  } finally {
    await prisma.candidateBatch.deleteMany({ where: { id: { in: [batch.id, batch2.id] } } });
    fs.rmSync(root, { recursive: true, force: true });
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
    await queueOnlyUnpauses();
    await shortNameReleases();
    await promptSaves();
    await changeSources();
    await newJobAttempts();
    await photoLibrary();
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
