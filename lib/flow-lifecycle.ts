/**
 * วงจรชีวิตของงานในคิว Flow (FlowJob) — ที่เดียวที่รู้ว่าแต่ละจังหวะเปลี่ยนงานเป็นอะไร: ผู้ใช้กดที่ Checkpoint
 * (เลือกรูป / วาดใหม่ / ผ่าน / รันต่อ / ข้าม / ทำต่อเอง) · บอทหยิบงาน ทำรอบเสร็จ หรือพัง · เปิดบอทแล้วกวาดงานค้าง
 * แต่ละจังหวะคืน "แผน" (Plan) = แพตช์ของ FlowJob + ผลข้างเคียงในตาราง Flow (ลบ/สร้างแถวคลิป, ปลดการหยุดของบอท)
 * ซึ่ง lib/flow-lifecycle-db.ts เขียนลง DB ทีเดียว (ทรานแซกชันเดียวถ้ามีหลายขั้น) — app/actions.ts และ worker/index.ts
 * ไม่เขียน FlowJob เอง จึงไม่มีจุดไหนลืมล้างช่อง error / ล้าง extraPrompt / ปลด pause / ลบแถวคลิปอีก
 *
 * pure ล้วน (ไม่มี Prisma ไม่มี node:*) เพราะ client component import gate (canApproveRender ฯลฯ) และ friendlyJobMessage
 * ตรวจด้วย scripts/check-flow-lifecycle.mjs · ไฟล์บนดิสก์ / revalidatePath / FlowActivity / แจ้งเตือน ยังเป็นงานของผู้เรียก
 */
import {
  FINAL_VIDEO_FILENAME,
  FLOW_STATUS,
  candidateFilename,
  isOpenStatus,
  normalizeExtraPrompt,
  queuedStatus,
  reviewStatus,
  runningStatus,
  toJobRound,
  videoFilename,
  type FlowRound,
  type FlowStatus,
  type JobRound,
} from "@/lib/flow-jobs";

/** ช่องของ FlowJob ที่วงจรชีวิตเปลี่ยนได้ (ไม่ระบุ = ไม่แตะ) */
export type JobPatch = {
  status?: FlowStatus;
  round?: JobRound;
  attempt?: number;
  extraPrompt?: string;
  flowProjectId?: string;
  startedAt?: Date;
  finishedAt?: Date | null;
  failedStep?: string;
  errorKind?: string;
  errorMessage?: string;
  failureDir?: string;
};

/** แถว FlowJobImage ใหม่ของงาน (jobId เติมตอนเขียน) */
export type ImageRow = {
  kind: "source" | "candidate" | "video";
  round: number;
  attempt: number;
  index: number;
  filename: string;
  mimeType: string;
  promptExtra?: string;
  flowMediaId?: string;
};

/** แผนของงานเดียว — lib/flow-lifecycle-db.ts เขียนตามลำดับ: markChosen → deleteVideoRows → createImages → finalizeVideoRowId → job → unpauseWorker */
export type Plan = {
  job: JobPatch;
  /** Checkpoint รูป: ปลด chosen ทุกรูป candidate ของรอบนี้ แล้วตั้งรูปที่เลือก */
  markChosen?: { round: number; imageId: string };
  /** ลบแถวคลิป (kind "video") ทั้งหมดของงาน — งานมีแถวคลิปได้แถวเดียว · ไฟล์บนดิสก์ผู้เรียกลบเอง */
  deleteVideoRows?: boolean;
  createImages?: ImageRow[];
  /** แถวคลิปเดิม (Preview clip ที่ผ่าน) กลายเป็น Final clip */
  finalizeVideoRowId?: string;
  /** ปลดการหยุดของบอท (FlowWorkerState) พร้อมกัน */
  unpauseWorker?: boolean;
};

/** แผนแบบมีเงื่อนไข (updateMany) — ใช้ตอนหยิบงาน กวาดงานค้าง และส่งต่อหลังพรอมต์พร้อม · ผู้เรียกเติมขอบเขต (id / entryId) */
export type BulkPlan = {
  where: { status: FlowStatus | FlowStatus[]; errorKind?: string; round?: number };
  job: JobPatch;
};

/** ล้างร่องรอยการพังของรอบก่อน — ทุกครั้งที่งานกลับเข้าคิว/เริ่มรอบใหม่ */
const CLEARED_FAILURE = { failedStep: "", errorKind: "", errorMessage: "", failureDir: "" } as const;

/** errorMessage เก็บได้ไม่เกินนี้ (ข้อความดิบจาก Playwright ยาวได้หลายหมื่นตัว) */
const MESSAGE_MAX = 2000;

// ---------------------------------------------------------------------------
// errorMessage ของงานที่จบด้วย Preview clip (720p) — โปรโตคอลในข้อความ (ไม่มีคอลัมน์แยก) ที่นี่ที่เดียวที่เขียนและอ่าน
// ---------------------------------------------------------------------------

const PREVIEW_ONLY_PREFIX = "ได้ 720p";

/** เขียน: งาน done ที่ได้แค่ Preview clip เพราะโหลด Final clip ไม่ได้ — detail = เหตุผล */
export function previewOnlyMessage(detail: string): string {
  return `${PREVIEW_ONLY_PREFIX} (${detail})`.slice(0, MESSAGE_MAX);
}

/** อ่าน: errorMessage นี้คือ "จบด้วย 720p" (หน้า /flow สรุปเป็นบรรทัดเดียวแทนข้อความดิบ) */
export function isPreviewOnlyMessage(errorMessage: string): boolean {
  return errorMessage.trim().startsWith(PREVIEW_ONLY_PREFIX);
}

/** errorMessage ของงาน Render ที่บอทตายหลังกดสร้างคลิป (stale sweep ใน worker/index.ts) — หน้า /flow โชว์ลิงก์โปรเจกต์ + ปุ่มปิดงาน */
export const STALE_RENDER_MESSAGE =
  "บอทหยุดกลางทางหลังกดสร้างคลิป — คลิปน่าจะอยู่ในโปรเจกต์ Flow แล้ว: เปิดโปรเจกต์ดู/โหลดเอง แล้วปิดงาน หรือกด เรนเดอร์ใหม่ (เสีย 15 เครดิต)";

/**
 * ข้อความของงาน (errorMessage) แบบคนอ่านรู้เรื่อง — summary บรรทัดเดียวภาษาไทยธรรมดา + detail คือข้อความดิบเต็ม
 * (ไว้พับใน <details>) · ว่าง = ไม่มีอะไรให้โชว์ · ข้อความสั้นที่เป็นภาษาไทยอยู่แล้วและไม่ใช่ error ดิบ แสดงตามเดิมไม่พับ
 */
export function friendlyJobMessage(status: string, errorMessage: string): { summary: string; detail: string | null } {
  const raw = errorMessage.trim();
  if (raw === "") return { summary: "", detail: null };
  if (isPreviewOnlyMessage(raw)) return { summary: "ได้คลิป 720p — โหลด 1080p ไม่สำเร็จ", detail: raw };
  const looksTechnical =
    raw.length > 140 || /Timeout \d+ms|Call log|locator\.|page\.|net::|at \S+:\d+|\n/.test(raw);
  if (!looksTechnical) return { summary: raw, detail: null };
  const summary =
    status === FLOW_STATUS.FAILED ? "บอทแจ้งข้อผิดพลาดทางเทคนิค — ดูรายละเอียดด้านล่าง" : "มีข้อความทางเทคนิคจากบอท — ดูรายละเอียดด้านล่าง";
  return { summary, detail: raw };
}

// ---------------------------------------------------------------------------
// gate ของปุ่มในหน้า /flow — server action ใช้ตัวเดียวกันตรวจซ้ำ (client อาจค้างหน้าเก่า)
// ---------------------------------------------------------------------------

/** review_r3 ที่ไม่มีไฟล์ (โหลดไม่ได้ทั้งสองทาง): กด "ผ่าน" ไม่ได้ (ไม่มีไฟล์ให้ผ่าน) แต่ "เรนเดอร์ใหม่" ได้ */
export function canApproveRender(status: string, hasVideoFile: boolean): boolean {
  return status === FLOW_STATUS.REVIEW_R3 && hasVideoFile;
}

/**
 * งานที่จบด้วยตัวอย่าง 720p (โหลด 1080p ไม่ได้) → "ลองโหลด 1080p อีกครั้ง" ได้ ไม่เสียเครดิต ไม่เรนเดอร์ใหม่
 * ต้องมีแถวคลิปที่ยังไม่ใช่ไฟล์ 1080p และรู้โปรเจกต์ที่คลิปอยู่
 */
export function canRetryUpscale(
  status: string,
  video: { filename: string; chosen: boolean } | null,
  flowProjectId: string,
): boolean {
  return status === FLOW_STATUS.DONE && video !== null && !video.chosen && video.filename !== FINAL_VIDEO_FILENAME && flowProjectId !== "";
}

/** บอทกำลังทำงานนี้อยู่ (running_*) — หน้าจอใช้ตัวนี้แทนเช็ก prefix ของชื่อสถานะเอง */
export function isBotWorking(status: string): boolean {
  return ([1, 2, 3, 4] as const).some((round) => runningStatus(round) === status);
}

/** รอบอทหยิบงาน (queued_*) */
export function isWaitingForBot(status: string): boolean {
  return ([1, 2, 3, 4] as const).some((round) => queuedStatus(round) === status);
}

/**
 * สถานะที่ผู้ใช้ "ทำต่อเอง" ได้ = ทุกสถานะเปิดยกเว้น running_* (บอทกำลังทำ) — รายการเดียว ใช้ร่วมทั้ง gate (canTakeOver/takeOver),
 * adapter (lib/flow-lifecycle-db.ts applyTakeOver) และหน้าจอ · derive จากรายการสถานะ ไม่เขียนซ้ำ
 */
export const TAKEOVER_STATUSES: readonly FlowStatus[] = (Object.values(FLOW_STATUS) as FlowStatus[]).filter(
  (s) => isOpenStatus(s) && !isBotWorking(s),
);

/** ปุ่ม "ทำต่อเอง": งานที่บอทไม่ได้กำลังทำอยู่ (และยังไม่จบ) */
export function canTakeOver(status: string): boolean {
  return (TAKEOVER_STATUSES as readonly string[]).includes(status);
}

/** ข้อความปฏิเสธเมื่อบอทหยิบงานไปก่อนผู้ใช้กด — ที่เดียว (takeOver, action ที่ได้ 0 แถว, หน้าจอ) */
export const TAKEOVER_BOT_BUSY_MESSAGE = "บอทเพิ่งเริ่มทำงานนี้ — รอให้เสร็จแล้วค่อยกดทำต่อเอง";

/** อยู่ขั้นทำคลิป (รอพรอมต์/รอคิว/รอดู/พังตอนทำคลิป) — หน้า /flow ใช้ตัดสินว่าจะโชว์แผงทำคลิปเองตอนปิด Render อัตโนมัติ */
export function isInRenderStage(status: string, round: number): boolean {
  return (
    status === FLOW_STATUS.AWAITING_PROMPT ||
    status === FLOW_STATUS.QUEUED_R3 ||
    status === FLOW_STATUS.REVIEW_R3 ||
    (status === FLOW_STATUS.FAILED && round >= 3)
  );
}

// ---------------------------------------------------------------------------
// แก้ 10-part prompt ที่หน้า /flow (PromptEntry.chatgptOutput — ช่องเดียวกับหน้า entry)
// ---------------------------------------------------------------------------

/**
 * "ok" = แก้ได้ (queued_r3 / review_r3 / failed รอบ 3) · "bot_running" = บอทกำลังเรนเดอร์ (running_r3): หน้าจออ่านอย่างเดียว
 * แต่ถ้ากดบันทึกทันเวลาที่บอทหยิบไป action ยังบันทึกให้ แล้วบอกว่ารอบนี้ใช้พรอมต์เดิม · "refused" = สถานะอื่น ไม่บันทึก
 */
export function promptSaveGate(status: string, round: number): "ok" | "bot_running" | "refused" {
  if (status === FLOW_STATUS.QUEUED_R3 || status === FLOW_STATUS.REVIEW_R3) return "ok";
  if (status === FLOW_STATUS.FAILED && round === 3) return "ok";
  if (status === FLOW_STATUS.RUNNING_R3) return "bot_running";
  return "refused";
}

/** "บันทึกแล้วเรนเดอร์ใหม่" ทำได้เฉพาะตอนรอดูคลิป (มีคลิปตัวอย่างให้ทิ้ง) */
export function canRerenderWithPrompt(status: string): boolean {
  return status === FLOW_STATUS.REVIEW_R3;
}

export const PROMPT_BOT_RUNNING_MESSAGE = "บันทึกพรอมต์แล้ว — แต่บอทเพิ่งเริ่มเรนเดอร์รอบนี้ รอบนี้ใช้พรอมต์เดิม พรอมต์ใหม่ใช้ตอนเรนเดอร์ครั้งถัดไป";
export const PROMPT_REFUSED_MESSAGE = "งานนี้อยู่ขั้นที่แก้พรอมต์ไม่ได้แล้ว — ไม่ได้บันทึก";

/** null = ใช้ได้ · ไม่ใช่ null = ข้อความไทยบอกเหตุ (พรอมต์ว่างจะทำให้บอทไม่ได้พิมพ์อะไรลง Flow) */
export function checkPromptText(text: string): string | null {
  return text.trim() === "" ? "พรอมต์ว่างเปล่า — ไม่ได้บันทึก" : null;
}

/** ตัดช่องว่างหัวท้าย เหมือนที่หน้า entry ทำกับ chatgptOutput */
export function normalizePromptText(text: string): string {
  return text.trim();
}

// ---------------------------------------------------------------------------
// ผู้ใช้ (หน้า /flow, Showcase, หน้า entry)
// ---------------------------------------------------------------------------

/** เข้าคิว: งานใหม่เริ่มรอบ 1 + แถวรูปต้นทาง (ชื่อไฟล์ให้ผู้เรียกเขียนไฟล์ก่อนสร้างแถว) */
export function enqueue(
  extraPrompt: unknown,
  sources: { filename: string; mimeType: string }[],
): { job: { status: FlowStatus; round: JobRound; attempt: number; extraPrompt: string }; sourceRows: ImageRow[] } {
  return {
    job: { status: FLOW_STATUS.QUEUED_R1, round: 1, attempt: 1, extraPrompt: normalizeExtraPrompt(extraPrompt) },
    sourceRows: sources.map((s, index) => ({ kind: "source", round: 0, attempt: 1, index, filename: s.filename, mimeType: s.mimeType })),
  };
}

/**
 * Checkpoint รูป: เลือก 1 ใน 4 — รอบ 1 → เข้าคิวรอบ 2 · รอบ 2 → รอ 10-part prompt ก่อน Render (awaiting_prompt, รอบ 3)
 * หรือจบงานถ้าปิด Render อัตโนมัติ (renderEnabled ของ flow-worker.config.json) · รอบ 2 ผู้เรียกก๊อป 2 รูปที่เลือกเป็น
 * ProductImage ในทรานแซกชันเดียวกัน (copyToProductImages)
 * @param renderEnabled อ่านหลังตรวจรูปเสมอ (ลำดับ error เดิม: รูปผิดรอบ → config → สถานะ)
 */
export function choose<I extends { id: string; kind: string; round: number; attempt: number }>(
  job: { status: string; round: number; attempt: number },
  image: I | undefined,
  renderEnabled: () => boolean,
  now: Date,
): Plan & { next: FlowStatus; copyToProductImages: boolean; image: I } {
  if (!image || image.kind !== "candidate" || image.round !== job.round || image.attempt !== job.attempt) {
    throw new Error("รูปที่เลือกไม่ใช่ของรอบปัจจุบัน");
  }
  const render = renderEnabled();
  const markChosen = { round: job.round, imageId: image.id };
  if (job.status === FLOW_STATUS.REVIEW_R1) {
    return {
      next: FLOW_STATUS.QUEUED_R2,
      image,
      copyToProductImages: false,
      markChosen,
      // รอบ 2 เริ่มด้วยพรอมต์ตั้งต้นเสมอ — ข้อความเพิ่มเติมของรอบ 1 มักสั่งเฉพาะภาพพื้นหลังขาว พอติดไปรอบ 2
      // ภาพ "ตอนใช้งาน" ออกมาเหมือนรอบ 1 (ผู้ใช้เจอจริง 2026-10-02) · อยากสั่งรอบ 2 ให้พิมพ์แล้วกด "วาดใหม่" ในรอบ 2
      job: { status: FLOW_STATUS.QUEUED_R2, round: 2, attempt: 1, extraPrompt: "" },
    };
  }
  if (job.status === FLOW_STATUS.REVIEW_R2) {
    // ปิด Render อัตโนมัติ = งานจบที่รูป 2 รอบ ผู้ใช้ทำคลิปเองใน Flow บัญชีหลัก
    if (!render) {
      return { next: FLOW_STATUS.DONE, image, copyToProductImages: true, markChosen, job: { status: FLOW_STATUS.DONE, finishedAt: now } };
    }
    return {
      next: FLOW_STATUS.AWAITING_PROMPT,
      image,
      copyToProductImages: true,
      markChosen,
      // ล้างข้อความเพิ่มเติม — ข้อความของรอบรูป (เช่น "เอาแค่แผ่นเดียว") พูดถึงรูปอ้างอิง ไม่ใช่คลิป
      // ถ้าติดไปต่อท้าย 10-part prompt จะกลายเป็นคำสั่งแปลกๆ ท้ายพรอมต์วิดีโอ
      job: { status: FLOW_STATUS.AWAITING_PROMPT, round: 3, attempt: 1, extraPrompt: "" },
    };
  }
  throw new Error("งานนี้ไม่ได้อยู่ในขั้นรอเลือกรูป");
}

/** generateWithAI บันทึก 10-part prompt สำเร็จ → งานที่รอพรอมต์ของ entry นั้นเข้าคิว Render (ผู้เรียกเติม entryId) */
export function promptReady(): BulkPlan {
  return { where: { status: FLOW_STATUS.AWAITING_PROMPT }, job: { status: FLOW_STATUS.QUEUED_R3 } };
}

/**
 * "ไม่ผ่านสักรูป วาดใหม่" / "เรนเดอร์ใหม่" — attempt+1 · รูป candidate เก่าเก็บไว้ · Preview clip ที่ไม่ผ่านลบทั้งแถว
 * (deleteVideoRows — ผู้เรียกลบไฟล์ก่อน) · extraPrompt: undefined = ใช้ค่าเดิม · "" = กลับเป็นพรอมต์ตั้งต้น
 */
export function redo(
  job: { status: string; attempt: number; extraPrompt: string },
  extraPrompt: string | undefined,
): Plan & { isRender: boolean; extraPrompt: string } {
  const isRender = job.status === FLOW_STATUS.REVIEW_R3;
  const next =
    job.status === FLOW_STATUS.REVIEW_R1
      ? FLOW_STATUS.QUEUED_R1
      : job.status === FLOW_STATUS.REVIEW_R2
        ? FLOW_STATUS.QUEUED_R2
        : isRender
          ? FLOW_STATUS.QUEUED_R3
          : null;
  if (next === null) throw new Error("ทำใหม่ได้เฉพาะงานที่รอคุณเลือกรูป/ดูคลิป");
  const extra = extraPrompt === undefined ? undefined : normalizeExtraPrompt(extraPrompt);
  return {
    isRender,
    extraPrompt: extra ?? job.extraPrompt,
    deleteVideoRows: isRender,
    job: { status: next, attempt: job.attempt + 1, ...(extra === undefined ? {} : { extraPrompt: extra }) },
  };
}

/** "ผ่าน" Preview clip → บอทโหลดคลิปเดิมแบบ 1080p (round 4) · งานจบเมื่อโหลดสำเร็จ */
export function approveRender(job: { status: string }, hasVideoRow: boolean): Plan {
  if (job.status !== FLOW_STATUS.REVIEW_R3) throw new Error("งานนี้ไม่ได้อยู่ในขั้นรอดูคลิป");
  // กันกดผ่านทั้งที่ไม่มีไฟล์คลิป (ปุ่มถูก disable ในหน้าเว็บอยู่แล้ว แต่ action ต้องกันเองด้วย)
  if (!hasVideoRow) throw new Error("ยังไม่มีไฟล์คลิป — กด เรนเดอร์ใหม่ หรือโหลดเองแล้วปิดงาน");
  return { job: { status: FLOW_STATUS.QUEUED_UPSCALE, round: 4 } };
}

/** "ลองโหลด 1080p อีกครั้ง" — งานที่จบด้วย 720p กลับเข้าคิวรอบ 4 (ไม่เรนเดอร์ใหม่ ไม่เสียเครดิต) */
export function retryUpscale(
  job: { status: string; flowProjectId: string },
  video: { filename: string; chosen: boolean } | null,
): Plan {
  if (!canRetryUpscale(job.status, video, job.flowProjectId)) {
    throw new Error("งานนี้ลองโหลด 1080p ใหม่ไม่ได้ (ยังไม่จบ ได้ 1080p แล้ว หรือไม่มีคลิป)");
  }
  return { job: { status: FLOW_STATUS.QUEUED_UPSCALE, round: 4, finishedAt: null, ...CLEARED_FAILURE } };
}

/** "รันต่อ (หลังซ่อม)" — งานที่พังกลับเข้าคิวรอบเดิม (round 3 = คิว Render ไม่ใช่วาดรูปใหม่) และปลดการหยุดของบอท */
export function resume(job: { status: string; round: number }): Plan {
  if (job.status !== FLOW_STATUS.FAILED) throw new Error("รันต่อได้เฉพาะงานที่พัง");
  return { job: { status: queuedStatus(toJobRound(job.round)), ...CLEARED_FAILURE }, unpauseWorker: true };
}

/** "ข้าม" — ทิ้งงาน ปลดการหยุดของบอทให้ทำงานอื่นต่อ · งานที่จบแล้ว = null (ไม่ทำอะไร) */
export function skip(job: { status: string }, now: Date): Plan | null {
  if (!isOpenStatus(job.status)) return null;
  return { job: { status: FLOW_STATUS.SKIPPED, finishedAt: now }, unpauseWorker: true };
}

/**
 * "ทำต่อเอง" (Manual takeover) — ผู้ใช้รับงานไปทำเองใน Flow บัญชีหลัก กดครั้งเดียว งานจบ (done) ทันที บอทไม่แตะอีก
 * ทำได้ทุกขั้นที่บอทไม่ได้กำลังทำอยู่ (canTakeOver) · งานพังที่ทำต่อเอง = ปลดการหยุดของบอทเหมือน "ข้ามงานนี้"
 * ไม่ล้างร่องรอยพัง/ไม่แตะ round — ป้าย "ทำเอง" มาจากแถว FlowActivity user_take_over ไม่ใช่จากงาน
 * ผู้เรียกต้องเขียนด้วย applyTakeOver (where status กันแข่งกับบอท) ไม่ใช่ applyPlan
 */
export function takeOver(job: { status: string }, now: Date): Plan {
  if (!canTakeOver(job.status)) {
    throw new Error(
      isOpenStatus(job.status) ? TAKEOVER_BOT_BUSY_MESSAGE : "งานนี้จบแล้ว — ทำต่อเองไม่ได้",
    );
  }
  return { job: { status: FLOW_STATUS.DONE, finishedAt: now }, unpauseWorker: job.status === FLOW_STATUS.FAILED };
}

// ---------------------------------------------------------------------------
// บอท (worker/index.ts)
// ---------------------------------------------------------------------------

/** หยิบงาน: queued → running ของรอบนั้น (where กันหยิบซ้ำ — ผู้เรียกเติม id) ล้างร่องรอยการพังของรอบก่อน */
export function claim(round: JobRound, now: Date): BulkPlan {
  return { where: { status: queuedStatus(round) }, job: { status: runningStatus(round), startedAt: now, ...CLEARED_FAILURE } };
}

/** claim สำเร็จแล้วแต่ดึงรายละเอียดงานกลับไม่ได้ — พังทันที ไม่ปล่อยค้าง running_* (main() หยุดคิวต่อเอง) */
export function claimCrashed(message: string): Plan {
  return { job: { status: FLOW_STATUS.FAILED, failedStep: "unknown", errorKind: "worker_crash", errorMessage: message.slice(0, MESSAGE_MAX) } };
}

/** รอบรูปเสร็จ → แถว candidate ใหม่ + รอผู้ใช้ที่ Checkpoint · exts = นามสกุลไฟล์ที่โหลดมา (jpg นอกนั้นถือเป็น png) */
export function imagesReady(
  round: FlowRound,
  job: { attempt: number; extraPrompt: string },
  exts: string[],
  projectId: string,
): Plan {
  return {
    createImages: exts.map((raw, index) => {
      const ext = raw === "jpg" ? "jpg" : "png";
      return {
        kind: "candidate" as const,
        round,
        attempt: job.attempt,
        index,
        filename: candidateFilename(round, job.attempt, index, ext),
        mimeType: ext === "jpg" ? "image/jpeg" : "image/png",
        promptExtra: job.extraPrompt,
      };
    }),
    job: { status: reviewStatus(round), flowProjectId: projectId },
  };
}

/**
 * Render เสร็จ (เสีย 15 เครดิตแล้ว) → review_r3 เสมอ ไม่มีทาง failed · ได้ไฟล์ = แถวคลิปใหม่ชื่อ videoFilename(attempt)
 * ไม่ได้ไฟล์ = ไม่มีแถวคลิป + errorMessage บอกเหตุ (UI ปิดปุ่ม "ผ่าน" ผ่าน canApproveRender) · แถวคลิปเก่าที่ค้าง
 * (รันต่อหลังพัง) ถูกแทนที่ — งานมีแถวคลิปได้แถวเดียว
 */
export function previewReady(input: {
  gotFile: boolean;
  downloadFailed: string | null;
  job: { attempt: number; extraPrompt: string };
  mediaId: string;
  projectId: string;
}): Plan {
  const { gotFile, job } = input;
  return {
    deleteVideoRows: true,
    createImages: gotFile
      ? [{
          kind: "video",
          round: 3,
          attempt: job.attempt,
          index: 0,
          filename: videoFilename(job.attempt),
          mimeType: "video/mp4",
          promptExtra: job.extraPrompt,
          flowMediaId: input.mediaId,
        }]
      : [],
    job: {
      status: FLOW_STATUS.REVIEW_R3,
      flowProjectId: input.projectId,
      errorMessage: gotFile ? "" : `โหลดคลิปมาไม่ได้ (คลิปอยู่ในโปรเจกต์ Flow แล้ว): ${input.downloadFailed ?? ""}`.slice(0, MESSAGE_MAX),
    },
  };
}

/** ได้คลิปแล้วแต่บันทึกผล Render ลง DB ไม่ได้ (ลองครบแล้ว) — ย้ายไปสถานะที่ผู้ใช้กู้เองได้ */
export function previewUnsaved(): Plan {
  return {
    job: {
      status: FLOW_STATUS.REVIEW_R3,
      errorMessage: "คลิปเสร็จแล้วแต่บันทึกลง DB ไม่ได้ — ดูไฟล์ในโฟลเดอร์ flow ของ entry หรือกดเรนเดอร์ใหม่",
    },
  };
}

/** ได้ Final clip — แถวคลิปเดิมกลายเป็นไฟล์ 1080p · ล้างหมายเหตุ "ได้ 720p" ของรอบก่อน (กรณี "ลองโหลด 1080p อีกครั้ง") */
export function finalClipSaved(videoRowId: string, now: Date): Plan {
  return { finalizeVideoRowId: videoRowId, job: { status: FLOW_STATUS.DONE, finishedAt: now, errorMessage: "" } };
}

/** ได้ไฟล์ 1080p แต่บันทึกลง DB ไม่ได้ (ลองครบแล้ว) */
export function finalClipUnsaved(now: Date): Plan {
  return {
    job: { status: FLOW_STATUS.DONE, finishedAt: now, errorMessage: "ได้ไฟล์ 1080p แต่บันทึกลง DB ไม่ได้ — ดู r3-final.mp4 ในโฟลเดอร์ flow ของ entry" },
  };
}

/** รอบ 4 จบโดยไม่ได้ไฟล์ 1080p — งานจบด้วย Preview clip (ผู้ใช้มีคลิปอยู่แล้ว ไม่เสียเครดิต) */
export function finalClipMissing(downloadFailed: string | null, now: Date): Plan {
  return { job: { status: FLOW_STATUS.DONE, finishedAt: now, errorMessage: previewOnlyMessage(`โหลด 1080p ไม่ได้: ${downloadFailed ?? ""}`) } };
}

/** ขั้นที่ Flow เองรายงานว่าวาด/เรนเดอร์ไม่สำเร็จ (การ์ด "failed to generate" ไม่เสียเครดิต) — ขั้นเดียวที่ข้ามไปงานถัดไปได้ */
const AUTO_CONTINUE_STEPS: ReadonlySet<string> = new Set(["wait-results", "wait-render"]);

/** พังแบบที่เข้าข่ายให้บอทข้ามไปงานถัดไป (ก่อนดูเพดาน/กฎติดกัน) — หน้า /flow ใช้ตัดสินข้อความ "บอทข้ามไปแล้ว" ด้วย */
export function isAutoContinueFailure(kind: string, step: string, round: number): boolean {
  return kind === "flow_error" && AUTO_CONTINUE_STEPS.has(step) && round !== 4;
}

/**
 * นโยบายตอนงานพัง: "continue" = งานเป็น failed แต่บอทไม่หยุดคิว ไปงานถัดไปหลังพักปกติ · "pause" = หยุดทั้งคิว (ของเดิม)
 * ข้ามได้เฉพาะ flow_error ที่ wait-results/wait-render (Flow วาดไม่สำเร็จเอง) ทุกอย่างอื่นหยุดเหมือนเดิม ·
 * เพดาน cap ครั้ง/วัน (0 = ปิดฟีเจอร์) · ห้ามข้ามติดกัน: ถ้าการข้ามล่าสุดใหม่กว่างานที่บอททำสำเร็จล่าสุด (หรือยังไม่เคยสำเร็จเลย)
 * แปลว่าสองสินค้าพังติดกัน = น่าจะเป็นที่ระบบ → หยุดคิว
 */
export function failurePolicy(input: {
  kind: string;
  step: string;
  round: number;
  autoContinuesToday: number;
  lastAutoContinueAt: Date | null;
  lastSuccessAt: Date | null;
  cap: number;
}): "continue" | "pause" {
  if (!isAutoContinueFailure(input.kind, input.step, input.round)) return "pause";
  if (input.cap <= 0 || input.autoContinuesToday >= input.cap) return "pause";
  if (input.lastAutoContinueAt !== null) {
    if (input.lastSuccessAt === null || input.lastAutoContinueAt.getTime() > input.lastSuccessAt.getTime()) return "pause";
  }
  return "continue";
}

/** ข้อความสั้นใต้งานที่พัง เมื่อบอทข้ามไปทำงานอื่นแล้ว (คิวไม่หยุด) · null = ไม่ใช่กรณีนี้ */
export function botMovedOnNote(job: { status: string; round: number; errorKind: string; failedStep: string }, queuePaused: boolean): string | null {
  if (queuePaused || job.status !== FLOW_STATUS.FAILED) return null;
  if (!isAutoContinueFailure(job.errorKind, job.failedStep, job.round)) return null;
  return "Flow วาดไม่สำเร็จ — บอทข้ามไปทำงานอื่นก่อนแล้ว กด รันต่อ เพื่อลองงานนี้อีกครั้ง";
}

/**
 * รอบพัง (บอทเก็บหลักฐานไว้ที่ failureDir แล้ว) — ปกติ = failed + หยุดทั้งคิว (pause = kind ให้บอทหยุดและแจ้งเตือนเอง)
 * ยกเว้นรอบ 4 (โหลด 1080p) ที่มี Preview clip แล้ว: จบงานด้วย 720p ไม่หยุดคิว — เว้นแต่สัญญาณบอท/หลุด login ที่ต้องหยุด
 * เพื่อป้องกันบัญชีเหมือนเดิม (เจอจริง 2026-10-01: find-video หยุดคิวทั้งที่มีคลิปแล้ว)
 */
export function roundFailed<K extends string>(input: {
  round: JobRound;
  hasVideoRow: boolean;
  step: string;
  kind: K;
  message: string;
  failureDir: string;
  now: Date;
  /** failurePolicy ตัดสินแล้วว่า "continue" — งานยัง failed เหมือนเดิมทุกอย่าง แต่ไม่หยุดคิว (pause = null) */
  skipPause?: boolean;
}): { plan: Plan; pause: K | null } {
  const { round, kind, step, message, failureDir } = input;
  if (round === 4 && kind !== "captcha" && kind !== "login_required" && input.hasVideoRow) {
    return {
      plan: {
        job: {
          status: FLOW_STATUS.DONE,
          finishedAt: input.now,
          failureDir,
          errorMessage: previewOnlyMessage(`โหลด 1080p ไม่ได้ที่ขั้น ${step}: ${message}`),
        },
      },
      pause: null,
    };
  }
  return {
    plan: { job: { status: FLOW_STATUS.FAILED, failedStep: step, errorKind: kind, errorMessage: message.slice(0, MESSAGE_MAX), failureDir } },
    pause: input.skipPause === true ? null : kind,
  };
}

// ---------------------------------------------------------------------------
// เปิดบอท: กวาดงานค้างจากบอทรอบก่อน (หลัง launchFlowBrowser เท่านั้น — ดู docs/agents/flow-bot.md)
// ---------------------------------------------------------------------------

/**
 * งานค้าง running_upscale: มี Preview clip แล้ว = คลิปเรนเดอร์เสร็จ (เครดิตจ่ายแล้ว) → จบด้วย 720p ไม่พัง ไม่หยุดคิว
 * (เจอจริง 2026-10-01: Chrome crash ตอนโหลด 1080p) · ไม่มีคลิป = null (ปล่อยให้ staleRunning ตีเป็น failed)
 */
export function staleUpscale(hasVideoRow: boolean, now: Date): Plan | null {
  if (!hasVideoRow) return null;
  return {
    job: {
      status: FLOW_STATUS.DONE,
      finishedAt: now,
      errorMessage: previewOnlyMessage("บอทปิดกลางทางตอนโหลด 1080p — กด ลองโหลด 1080p อีกครั้ง ได้"),
    },
  };
}

/**
 * งานค้าง running_r3: ถ้ามีแถว FlowActivity generate_video ของงานนี้ตั้งแต่ startedAt แปลว่ากดสร้างคลิปไปแล้ว (เสีย 15 เครดิต
 * คลิปอยู่ในโปรเจกต์) → "review" = review_r3 ไม่มีแถว video ไม่หยุดคิว (failed + "รันต่อ" = เรนเดอร์ซ้ำเสียเครดิตอีกรอบ)
 * · ไม่มี/ไม่รู้ startedAt → "failed" + หยุดคิวเหมือนงานค้างอื่น
 */
export function staleRenderRecovery(startedAt: Date | null, generateVideoAt: Date[]): "review" | "failed" {
  if (startedAt === null) return "failed";
  return generateVideoAt.some((at) => at.getTime() >= startedAt.getTime()) ? "review" : "failed";
}

/** แผนของ staleRenderRecovery = "review" · null = ปล่อยให้ staleRunning ตีเป็น failed */
export function staleRender(startedAt: Date | null, generateVideoAt: Date[]): Plan | null {
  if (staleRenderRecovery(startedAt, generateVideoAt) !== "review") return null;
  // แถวคลิปที่ค้าง (ถ้ามี) เป็นของ attempt ก่อน — ห้ามให้ปุ่ม "ผ่าน" ไปอนุมัติคลิปผิดตัว
  return { deleteVideoRows: true, job: { status: FLOW_STATUS.REVIEW_R3, errorMessage: STALE_RENDER_MESSAGE } };
}

/** งาน running_* ที่เหลือ = บอทรอบก่อนตายกลางคัน → failed ไม่ reset เป็น queued เอง (กัน loop) · มีสักงาน = หยุดคิว (pause) */
export function staleRunning(): BulkPlan & { pause: "worker_crash" } {
  return {
    where: {
      status: [FLOW_STATUS.RUNNING_R1, FLOW_STATUS.RUNNING_R2, FLOW_STATUS.RUNNING_R3, FLOW_STATUS.RUNNING_UPSCALE],
    },
    job: { status: FLOW_STATUS.FAILED, failedStep: "unknown", errorKind: "worker_crash", errorMessage: "worker ตายกลางคันในรอบก่อน" },
    pause: "worker_crash",
  };
}

/**
 * เปิดบอทใหม่แล้ว session ใช้ได้ หลังรอบก่อนหยุดเพราะ login_required (การเปิดบอทใหม่คือการกระทำของคน ไม่ใช่บอท retry เอง)
 * → คืนงานที่พังเพราะ login เข้าคิวรอบเดิมแบบเดียวกับ resume (ทีละรอบ) · ผู้เรียกปลดการหยุดของบอทต่อ
 */
export function loginRecovered(): BulkPlan[] {
  return ([1, 2, 3, 4] as JobRound[]).map((round) => ({
    where: { status: FLOW_STATUS.FAILED, errorKind: "login_required", round },
    job: { status: queuedStatus(round), ...CLEARED_FAILURE },
  }));
}
