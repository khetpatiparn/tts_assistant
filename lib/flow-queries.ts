import { readdir } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { UPLOAD_ROOT, joinPath } from "@/lib/upload-paths";
import { loadWorkerConfig } from "@/worker/config";
import { isTakeoverKind, summarizeActivity } from "@/lib/flow-activity";
import { FLOW_STATUS, WORKER_STATE_ID, isWorkerAlive, queueCategory, summarizeQueue } from "@/lib/flow-jobs";
import { parseExportDetail, type ExportRecord } from "@/lib/clip-export";
import { entryStatus } from "@/lib/entry-rows";
import { shopPhotosForEntry, type ShopPhoto } from "@/lib/showcase";
import { loadHashtagsByProduct } from "@/lib/hashtag-queries";
import { hashtagsForEntries } from "@/lib/required-hashtag";

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

/** ภาพจุดเช็กที่บอทถ่ายไว้ระหว่างทำงาน (worker/flow-session.ts checkpoint) — path ใต้ uploads/ สำหรับ /api/uploads */
export type FlowCheckpoint = { label: string; path: string };

/**
 * Product ID ของสินค้าจาก Showcase ที่ผูกกับ entry (ProductCandidate.linkedEntryId → sourceProductId) — ไม่มีคอลัมน์ใหม่
 * entry ที่ไม่ได้มาจาก Showcase ไม่มีในผลลัพธ์ · แถวผูกซ้ำใช้แถวล่าสุด
 */
export async function getProductIdsByEntry(entryIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (entryIds.length === 0) return map;
  const rows = await prisma.productCandidate.findMany({
    where: { linkedEntryId: { in: entryIds }, sourceProductId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { linkedEntryId: true, sourceProductId: true },
  });
  for (const r of rows) {
    if (r.linkedEntryId !== null && r.sourceProductId !== null && !map.has(r.linkedEntryId)) map.set(r.linkedEntryId, r.sourceProductId);
  }
  return map;
}

/**
 * แฮชแท็กที่ต้องลงของแต่ละ entry — ผ่านสินค้า Showcase ที่ผูกอยู่ (รับ map entry→Product ID จาก getProductIdsByEntry
 * ไม่คิวรีซ้ำ) · entry ที่ไม่มีแฮชแท็กไม่อยู่ใน map
 */
export async function getRequiredHashtagsByEntry(productIds: Map<string, string>): Promise<Map<string, string[]>> {
  const tagsByProduct = await loadHashtagsByProduct([...new Set(productIds.values())]);
  return hashtagsForEntries(productIds, tagsByProduct);
}

/**
 * รูปจากร้าน (Shop photos) ของแต่ละ entry — ตัวเลือก "เปลี่ยนรูปต้นทาง" ของหน้า /flow · entry ที่ไม่ได้มาจาก Showcase = ไม่มีใน map
 * ดึงแถวของสินค้าที่ผูกกับ entry + แถวสแกนซ้ำ (sourceProductId เดียวกัน) แล้วให้ shopPhotosForEntry (lib/showcase.ts) เลือกชุดเดียว
 */
export async function getShopPhotosByEntry(entryIds: string[]): Promise<Map<string, ShopPhoto[]>> {
  const map = new Map<string, ShopPhoto[]>();
  if (entryIds.length === 0) return map;
  const linked = await prisma.productCandidate.findMany({
    where: { linkedEntryId: { in: entryIds }, sourceProductId: { not: null } },
    select: { sourceProductId: true },
  });
  const pids = [...new Set(linked.map((r) => r.sourceProductId as string))];
  if (pids.length === 0) return map;
  const rows = await prisma.productCandidate.findMany({
    where: { sourceProductId: { in: pids } },
    select: {
      id: true, sourceProductId: true, linkedEntryId: true, capturedOn: true,
      images: { orderBy: { sortOrder: "asc" }, select: { id: true, filename: true } },
    },
  });
  const typed = rows.map((r) => ({ ...r, sourceProductId: r.sourceProductId as string }));
  for (const entryId of entryIds) {
    const photos = shopPhotosForEntry(typed, entryId);
    if (photos.length > 0) map.set(entryId, photos);
  }
  return map;
}

/** งานไหนเคย "ทำต่อเอง" (แถว FlowActivity user_take_over หรือ user_finish_manual ของปุ่มเก่า) — ป้าย "ทำเอง" มาจากตรงนี้ ไม่มีคอลัมน์ในงาน */
export async function getTookOverJobIds(jobIds: string[]): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();
  const rows = await prisma.flowActivity
    .findMany({ where: { jobId: { in: jobIds }, kind: { in: ["user_take_over", "user_finish_manual"] } }, select: { jobId: true, kind: true } })
    .catch(() => [] as { jobId: string | null; kind: string }[]);
  return new Set(rows.filter((r) => r.jobId !== null && isTakeoverKind(r.kind)).map((r) => r.jobId as string));
}

export type FlowJobRow = {
  id: string;
  /** เคยกด "ทำต่อเอง" (ป้าย "ทำเอง") */
  tookOver: boolean;
  /** Product ID จาก Showcase (null = ไม่ได้มาจาก Showcase) — แสดงพร้อมปุ่มคัดลอก */
  productId: string | null;
  /** แฮชแท็กที่ต้องลงของสินค้าจาก Showcase (ว่าง = ไม่ต้องลงอะไร หรือไม่ได้มาจาก Showcase) */
  requiredHashtags: string[];
  /** โฟลเดอร์ใน TTS ที่ส่งคลิปไปแล้ว (จาก FlowActivity user_export_clip ล่าสุด) · null = ยังไม่เคยส่ง */
  exportedPath: string | null;
  /** ชื่อไฟล์คลิปของงานตอนส่งครั้งล่าสุด (เทียบกับ video.filename เพื่อชวนอัปเดต) · null = ไม่เคยส่ง/แถวเก่าที่ไม่ได้เก็บ */
  exportedVideo: string | null;
  entryId: string;
  productName: string;
  /** 10-part prompt ของ Entry — ใช้ในแผง "ทำคลิปเองใน Flow" ("" = ยังไม่ได้สร้าง) */
  prompt: string;
  /** แคปชัน/แฮชแท็ก/angle ของ Entry — ใช้ในการ์ด "พร้อมโพสต์" ของคลิปที่เสร็จ ("" = ยังไม่มี) */
  caption: string;
  hashtags: string;
  angle: string;
  status: string;
  round: number;
  attempt: number;
  failedStep: string;
  errorKind: string;
  errorMessage: string;
  failureDir: string;
  /** id โปรเจกต์ใน Flow ("" = ยังไม่มี) — ใช้ทำลิงก์เปิดโปรเจกต์เมื่อโหลดคลิปเองไม่ได้ */
  flowProjectId: string;
  /** ข้อความเพิ่มเติมที่จะใช้กับการวาดครั้งถัดไป */
  extraPrompt: string;
  /** ภาพจุดเช็กของรอบ/attempt ล่าสุดที่บอทลงมือแล้ว (ว่าง = ยังไม่มี/ลบไปแล้วหลัง 14 วัน) */
  checkpoints: FlowCheckpoint[];
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** แถวรูปต้นทางทุกแถว (หลังเปลี่ยนรูปต้นทางมีหลายแถว — รูปปัจจุบันเลือกด้วย currentSourceImage) */
  sources: FlowImageRow[];
  /** รูปจากร้านของสินค้า (ว่าง = ไม่ได้มาจาก Showcase) — ตัวเลือกของ "เปลี่ยนรูปต้นทาง" */
  shopPhotos: ShopPhoto[];
  /** candidate ของรอบ/attempt ปัจจุบันเท่านั้น (attempt เก่าเก็บไว้ในตาราง ไม่โชว์) */
  candidates: FlowImageRow[];
  chosenRound1: FlowImageRow | null;
  chosenRound2: FlowImageRow | null;
  /**
   * คลิปของงาน (Render) — มีได้แถวเดียว: ตัวอย่าง 720p ของ attempt ปัจจุบัน หรือไฟล์ 1080p ของคลิปที่ผ่าน (chosen)
   * null = ยังไม่ได้ Render / เพิ่งกดเรนเดอร์ใหม่ (ตัวอย่างเก่าถูกลบ)
   */
  video: FlowImageRow | null;
  /** โพสต์แล้วไหม — กติกาเดียวกับหน้ารายการ (entryStatus: videoUrl ไม่ว่าง) · postedAt = UTC midnight ของวันโพสต์ */
  posted: boolean;
  postedAt: Date | null;
};

export type FlowWorkerView = {
  alive: boolean;
  lastSeenAt: Date | null;
  pausedReason: string;
  pausedAt: Date | null;
  todayBatches: number;
  dailyBatchCap: number;
  todayRenders: number;
  videoDailyCap: number;
  nextWakeAt: Date | null;
  currentJobId: string | null;
  /** บอท Render คลิปเองไหม (flow-worker.config.json) — ปิด = โชว์แผงทำคลิปเองแทน */
  renderEnabled: boolean;
  /** สรุปสมุดบันทึกการกระทำ (FlowActivity) — วันนี้ยิงกี่ครั้ง · ถี่สุดต่อ 10 นาที (24 ชม.ล่าสุด) · สัญญาณเตือนล่าสุด */
  activity: { today: number; peakPer10Min: number; lastWarnAt: Date | null };
};

const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const CHECKPOINT_LABELS: Record<string, string> = {
  settings: "ตั้งค่า",
  reference: "แนบรูป",
  prompt: "พรอมต์ก่อนกด",
  results: "ผลลัพธ์",
  menu: "เมนูโหลดคลิป",
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

/** ลำดับแสดง: รอคุณเลือก/ดูคลิปก่อน (คนต้องทำ) → พัง → รอบอท/กำลังทำ/รอพรอมต์ → เสร็จ/ข้าม */
function rank(status: string): number {
  const cat = queueCategory(status);
  if (cat === "waitingUser") return 0;
  if (cat === "failed") return 1;
  if (cat === "waitingBot") return 2;
  return 3;
}

export async function getFlowQueueData(): Promise<{
  jobs: FlowJobRow[];
  worker: FlowWorkerView;
  summary: ReturnType<typeof summarizeQueue>;
}> {
  const since = new Date(Date.now() - DONE_WINDOW_MS);
  const [raw, state, activityRows] = await Promise.all([
    prisma.flowJob.findMany({
      where: {
        OR: [
          { status: { notIn: [FLOW_STATUS.DONE, FLOW_STATUS.SKIPPED] } },
          { updatedAt: { gte: since } },
        ],
      },
      include: {
        entry: { select: { productName: true, chatgptOutput: true, caption: true, hashtags: true, angle: true, videoUrl: true, postedAt: true } },
        images: { orderBy: [{ round: "asc" }, { attempt: "asc" }, { index: "asc" }] },
      },
    }),
    prisma.flowWorkerState.findUnique({ where: { id: WORKER_STATE_ID } }),
    prisma.flowActivity.findMany({
      where: { at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      select: { at: true, kind: true },
    }).catch((e: unknown) => {
      // dev.db ที่ยังไม่ migrate (ไม่มีตาราง FlowActivity) ต้องไม่ทำให้ทั้งหน้า /flow ล่ม — โชว์ยิง 0 แทน
      console.error("อ่าน FlowActivity ไม่ได้ (ยังไม่ได้ migrate?):", e instanceof Error ? e.message : e);
      return [] as { at: Date; kind: string }[];
    }),
  ]);

  const entryIds = [...new Set(raw.map((j) => j.entryId))];
  const [tookOverIds, productIds, shopPhotos] = await Promise.all([
    getTookOverJobIds(raw.map((j) => j.id)),
    getProductIdsByEntry(entryIds),
    getShopPhotosByEntry(entryIds),
  ]);
  const requiredHashtags = await getRequiredHashtagsByEntry(productIds);

  const jobs: FlowJobRow[] = raw
    .map((j) => {
      const imgs: FlowImageRow[] = j.images.map((i) => ({
        id: i.id, kind: i.kind, round: i.round, attempt: i.attempt, index: i.index, filename: i.filename, chosen: i.chosen,
        promptExtra: i.promptExtra,
      }));
      return {
        id: j.id,
        tookOver: tookOverIds.has(j.id),
        productId: productIds.get(j.entryId) ?? null,
        requiredHashtags: requiredHashtags.get(j.entryId) ?? [],
        exportedPath: null as string | null,
        exportedVideo: null as string | null,
        entryId: j.entryId,
        productName: j.entry.productName,
        prompt: j.entry.chatgptOutput,
        caption: j.entry.caption,
        hashtags: j.entry.hashtags,
        angle: j.entry.angle,
        status: j.status,
        round: j.round,
        attempt: j.attempt,
        failedStep: j.failedStep,
        errorKind: j.errorKind,
        errorMessage: j.errorMessage,
        failureDir: j.failureDir,
        flowProjectId: j.flowProjectId,
        extraPrompt: j.extraPrompt,
        checkpoints: [],
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        sources: imgs.filter((i) => i.kind === "source"),
        shopPhotos: shopPhotos.get(j.entryId) ?? [],
        candidates: imgs.filter((i) => i.kind === "candidate" && i.round === j.round && i.attempt === j.attempt),
        chosenRound1: imgs.find((i) => i.kind === "candidate" && i.round === 1 && i.chosen) ?? null,
        chosenRound2: imgs.find((i) => i.kind === "candidate" && i.round === 2 && i.chosen) ?? null,
        video: imgs.find((i) => i.kind === "video") ?? null,
        posted: entryStatus({ hasOutput: j.entry.chatgptOutput !== "", videoUrl: j.entry.videoUrl }) === "posted",
        postedAt: j.entry.postedAt,
      };
    })
    .sort((a, b) => rank(a.status) - rank(b.status) || a.createdAt.getTime() - b.createdAt.getTime());

  // ส่งเข้าโฟลเดอร์ TTS ไปแล้วหรือยัง — ให้รู้แม้ปิดแอปแล้วเปิดใหม่ (ไม่มีตาราง FlowActivity = ถือว่ายังไม่ส่ง)
  const exportRows = await prisma.flowActivity.findMany({
    where: { kind: "user_export_clip", jobId: { in: jobs.map((j) => j.id) } },
    orderBy: { at: "desc" },
    select: { jobId: true, detail: true },
  }).catch(() => [] as { jobId: string | null; detail: string }[]);
  // แถวล่าสุดต่องานเท่านั้น (เรียง desc) — ตรงกับที่ exportClipToFolder ใช้ตัดสิน · detail เสีย = ถือว่ายังไม่ส่ง
  const exported = new Map<string, ExportRecord | null>();
  for (const r of exportRows) {
    if (r.jobId === null || exported.has(r.jobId)) continue;
    exported.set(r.jobId, parseExportDetail(r.detail));
  }
  for (const j of jobs) {
    const rec = exported.get(j.id) ?? null;
    j.exportedPath = rec?.path ?? null;
    j.exportedVideo = rec?.video ?? null;
  }

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
    todayRenders: state?.todayRenders ?? 0,
    videoDailyCap: cfg.videoDailyCap,
    nextWakeAt: state?.nextWakeAt ?? null,
    currentJobId: state?.currentJobId ?? null,
    renderEnabled: cfg.renderEnabled,
    activity: summarizeActivity(activityRows, now),
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

/**
 * คลิปที่บอท Render ของ entry นี้ (หน้า entry แท็บผลลัพธ์) — เลือกไฟล์ 1080p ของคลิปที่ผ่านก่อน (ล่าสุด)
 * ไม่มีก็เอาคลิปตัวอย่าง 720p ล่าสุด · stage บอกว่าเป็นไฟล์ไหน ให้หน้าเว็บเขียนป้ายได้ถูก
 * (entry เดียวมีงาน Flow ได้หลายงานถ้าเคยข้าม/เลือกรูปใหม่ — งานที่ถูกข้ามไม่นับ)
 */
export type EntryRenderVideo = {
  path: string;
  stage: "final" | "approved" | "preview";
};

export async function getRenderVideoForEntry(entryId: string): Promise<EntryRenderVideo | null> {
  const rows = await prisma.flowJobImage.findMany({
    where: { kind: "video", job: { entryId, status: { not: FLOW_STATUS.SKIPPED } } },
    include: { job: { select: { status: true, round: true } } },
    orderBy: { createdAt: "desc" },
  });
  const pick = rows.find((r) => r.chosen) ?? rows[0];
  if (pick === undefined) return null;
  // round 4 = ผู้ใช้กดผ่านแล้ว บอทกำลัง/จะโหลด 1080p (รวมตอนที่การโหลดพังค้างอยู่)
  const stage = pick.chosen ? "final" : pick.job.round === 4 ? "approved" : "preview";
  return { path: `${entryId}/flow/${pick.filename}`, stage };
}
