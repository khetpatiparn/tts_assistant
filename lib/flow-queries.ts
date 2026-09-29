import { readdir } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { UPLOAD_ROOT, joinPath } from "@/lib/upload-paths";
import { loadWorkerConfig } from "@/worker/config";
import { FLOW_STATUS, WORKER_STATE_ID, isWorkerAlive, summarizeQueue } from "@/lib/flow-jobs";

export type FlowImageRow = {
  id: string;
  kind: string;
  round: number;
  attempt: number;
  index: number;
  filename: string;
  chosen: boolean;
  /** ข้อความเพิ่มเติมที่ใช้ตอนวาดรูปนี้ (candidate เท่านั้น) · "" = พรอมต์ตั้งต้น */
  promptExtra: string;
};

/** ภาพจุดเช็กที่บอทถ่ายไว้ระหว่างทำงาน (worker/flow-driver.ts checkpoint) — path ใต้ uploads/ สำหรับ /api/uploads */
export type FlowCheckpoint = { label: string; path: string };

export type FlowJobRow = {
  id: string;
  entryId: string;
  productName: string;
  status: string;
  round: number;
  attempt: number;
  failedStep: string;
  errorKind: string;
  errorMessage: string;
  failureDir: string;
  /** ข้อความเพิ่มเติมที่จะใช้กับการวาดครั้งถัดไป */
  extraPrompt: string;
  /** ภาพจุดเช็กของรอบ/attempt ล่าสุดที่บอทลงมือแล้ว (ว่าง = ยังไม่มี/ลบไปแล้วหลัง 14 วัน) */
  checkpoints: FlowCheckpoint[];
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  sources: FlowImageRow[];
  /** candidate ของรอบ/attempt ปัจจุบันเท่านั้น (attempt เก่าเก็บไว้ในตาราง ไม่โชว์) */
  candidates: FlowImageRow[];
  chosenRound1: FlowImageRow | null;
  chosenRound2: FlowImageRow | null;
};

export type FlowWorkerView = {
  alive: boolean;
  lastSeenAt: Date | null;
  pausedReason: string;
  pausedAt: Date | null;
  todayBatches: number;
  dailyBatchCap: number;
  nextWakeAt: Date | null;
  currentJobId: string | null;
};

const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const CHECKPOINT_LABELS: Record<string, string> = {
  settings: "ตั้งค่า",
  reference: "แนบรูป",
  prompt: "พรอมต์ก่อนกด",
  results: "ผลลัพธ์",
};

/**
 * ไฟล์ `r{round}-a{attempt}-{n}-{name}.jpg` ของ attempt ล่าสุดที่มีภาพ — เลือกจากชื่อไฟล์เอง ไม่ใช่จาก job.attempt
 * เพราะตอนรอคิว/กำลังวาด attempt ปัจจุบันยังไม่มีภาพ ควรเห็นภาพของครั้งก่อนหน้าแทนความว่างเปล่า
 */
async function listCheckpoints(entryId: string): Promise<FlowCheckpoint[]> {
  let files: string[];
  try {
    files = await readdir(joinPath(UPLOAD_ROOT, entryId, "flow", "checkpoints"));
  } catch {
    return [];
  }
  const parsed = files
    .map((f) => /^r(\d)-a(\d+)-(\d)-([a-z]+)\.jpg$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ file: m[0], key: Number(m[1]) * 1000 + Number(m[2]), n: Number(m[3]), name: m[4] }));
  if (parsed.length === 0) return [];
  const latest = Math.max(...parsed.map((p) => p.key));
  return parsed
    .filter((p) => p.key === latest)
    .sort((a, b) => a.n - b.n)
    .map((p) => ({ label: CHECKPOINT_LABELS[p.name] ?? p.name, path: `${entryId}/flow/checkpoints/${p.file}` }));
}

/** ลำดับแสดง: รอคุณเลือกก่อน (คนต้องทำ) → พัง → รอบอท/กำลังทำ → เสร็จ/ข้าม */
function rank(status: string): number {
  if (status.startsWith("review_")) return 0;
  if (status === FLOW_STATUS.FAILED) return 1;
  if (status.startsWith("queued_") || status.startsWith("running_")) return 2;
  return 3;
}

export async function getFlowQueueData(): Promise<{
  jobs: FlowJobRow[];
  worker: FlowWorkerView;
  summary: ReturnType<typeof summarizeQueue>;
}> {
  const since = new Date(Date.now() - DONE_WINDOW_MS);
  const [raw, state] = await Promise.all([
    prisma.flowJob.findMany({
      where: {
        OR: [
          { status: { notIn: [FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED] } },
          { updatedAt: { gte: since } },
        ],
      },
      include: {
        entry: { select: { productName: true } },
        images: { orderBy: [{ round: "asc" }, { attempt: "asc" }, { index: "asc" }] },
      },
    }),
    prisma.flowWorkerState.findUnique({ where: { id: WORKER_STATE_ID } }),
  ]);

  const jobs: FlowJobRow[] = raw
    .map((j) => {
      const imgs: FlowImageRow[] = j.images.map((i) => ({
        id: i.id, kind: i.kind, round: i.round, attempt: i.attempt, index: i.index, filename: i.filename, chosen: i.chosen,
        promptExtra: i.promptExtra,
      }));
      return {
        id: j.id,
        entryId: j.entryId,
        productName: j.entry.productName,
        status: j.status,
        round: j.round,
        attempt: j.attempt,
        failedStep: j.failedStep,
        errorKind: j.errorKind,
        errorMessage: j.errorMessage,
        failureDir: j.failureDir,
        extraPrompt: j.extraPrompt,
        checkpoints: [],
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        sources: imgs.filter((i) => i.kind === "source"),
        candidates: imgs.filter((i) => i.kind === "candidate" && i.round === j.round && i.attempt === j.attempt),
        chosenRound1: imgs.find((i) => i.kind === "candidate" && i.round === 1 && i.chosen) ?? null,
        chosenRound2: imgs.find((i) => i.kind === "candidate" && i.round === 2 && i.chosen) ?? null,
      };
    })
    .sort((a, b) => rank(a.status) - rank(b.status) || a.createdAt.getTime() - b.createdAt.getTime());

  // อ่านโฟลเดอร์ภาพจุดเช็กพร้อมกันทุกงาน (งานที่โชว์มีไม่กี่สิบงาน — ไม่ใช่ภาระ)
  const withCheckpoints = await Promise.all(
    jobs.map(async (j) => ({ ...j, checkpoints: await listCheckpoints(j.entryId) }))
  );

  const cfg = loadWorkerConfig();
  const now = new Date();
  const worker: FlowWorkerView = {
    alive: isWorkerAlive(state?.lastSeenAt ?? null, now, cfg.heartbeatMs),
    lastSeenAt: state?.lastSeenAt ?? null,
    pausedReason: state?.pausedReason ?? "",
    pausedAt: state?.pausedAt ?? null,
    todayBatches: state?.todayBatches ?? 0,
    dailyBatchCap: cfg.dailyBatchCap,
    nextWakeAt: state?.nextWakeAt ?? null,
    currentJobId: state?.currentJobId ?? null,
  };

  return { jobs: withCheckpoints, worker, summary: summarizeQueue(withCheckpoints) };
}

export async function getOpenFlowJobForEntry(
  entryId: string
): Promise<{ id: string; status: string; round: number; attempt: number } | null> {
  const job = await prisma.flowJob.findFirst({
    where: { entryId, status: { notIn: [FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, round: true, attempt: true },
  });
  return job;
}
