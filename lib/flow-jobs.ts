/**
 * ตรรกะ pure ของคิว Flow — ไม่มี Prisma ไม่มี node:* เพราะ client component ก็ import
 * (แนวเดียวกับ lib/entry-rows.ts) ทดสอบด้วย scripts/check-flow-jobs.mjs
 */
export const FLOW_STATUS = {
  QUEUED_R1: "queued_r1",
  RUNNING_R1: "running_r1",
  REVIEW_R1: "review_r1",
  QUEUED_R2: "queued_r2",
  RUNNING_R2: "running_r2",
  REVIEW_R2: "review_r2",
  /**
   * รอบ 3 = Render คลิป (spec 2026-09-30-flow-video-render-design.md) — เลือกรูปรอบ 2 แล้วมาหยุดรอที่นี่
   * จนกว่า generateWithAI จะบันทึก 10-part prompt สำเร็จ (พรอมต์ของคลิปคือ chatgptOutput ของ Entry)
   */
  AWAITING_PROMPT: "awaiting_prompt",
  QUEUED_R3: "queued_r3",
  RUNNING_R3: "running_r3",
  REVIEW_R3: "review_r3",
  /**
   * round 4 = ผู้ใช้กด "ผ่าน" คลิปตัวอย่าง 720p แล้ว → บอทกลับไปโปรเจกต์เดิม โหลดคลิปเดิมแบบ 1080p Upscaled
   * (ไม่เสียเครดิต แต่รอนาน) — ขยายเฉพาะคลิปที่ผ่าน ไม่เสียเวลารอ upscale คลิปที่จะทิ้ง
   */
  QUEUED_UPSCALE: "queued_upscale",
  RUNNING_UPSCALE: "running_upscale",
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type FlowStatus = (typeof FLOW_STATUS)[keyof typeof FLOW_STATUS];
/** รอบวาดรูป (มี 4 รูปให้เลือก) */
export type FlowRound = 1 | 2;
/** รอบของงานทั้งหมด — 3 = Render คลิป · 4 = โหลดคลิปที่ผ่านแบบ 1080p (FlowJob.round บอกว่างานที่พังพังตอนไหน) */
export type JobRound = FlowRound | 3 | 4;

/** FlowJob.round (Int ใน DB) → JobRound · ค่าแปลกๆ ถือเป็นรอบ 1 เหมือนพฤติกรรมเดิม */
export function toJobRound(n: number): JobRound {
  return n === 4 ? 4 : n === 3 ? 3 : n === 2 ? 2 : 1;
}

export const FLOW_ROUND_1_STATUSES: FlowStatus[] = [
  FLOW_STATUS.QUEUED_R1,
  FLOW_STATUS.RUNNING_R1,
  FLOW_STATUS.REVIEW_R1,
];

export const WORKER_STATE_ID = "singleton";

const QUEUED_BY_ROUND: Record<JobRound, FlowStatus> = {
  1: FLOW_STATUS.QUEUED_R1,
  2: FLOW_STATUS.QUEUED_R2,
  3: FLOW_STATUS.QUEUED_R3,
  4: FLOW_STATUS.QUEUED_UPSCALE,
};
const RUNNING_BY_ROUND: Record<JobRound, FlowStatus> = {
  1: FLOW_STATUS.RUNNING_R1,
  2: FLOW_STATUS.RUNNING_R2,
  3: FLOW_STATUS.RUNNING_R3,
  4: FLOW_STATUS.RUNNING_UPSCALE,
};

export function queuedStatus(round: JobRound): FlowStatus {
  return QUEUED_BY_ROUND[round];
}
export function runningStatus(round: JobRound): FlowStatus {
  return RUNNING_BY_ROUND[round];
}
/** รอบ 4 (โหลด 1080p) ไม่มีขั้นรอคน — เสร็จแล้วจบงานเลย */
export function reviewStatus(round: 1 | 2 | 3): FlowStatus {
  return round === 1 ? FLOW_STATUS.REVIEW_R1 : round === 2 ? FLOW_STATUS.REVIEW_R2 : FLOW_STATUS.REVIEW_R3;
}

/**
 * รอบที่ status นี้อยู่ · failed/skipped/done ไม่รู้จากชื่อ (ใช้ job.round แทน) — done เคยตอบ 2 แต่ตั้งแต่มี
 * Render งานที่เสร็จอาจจบที่รอบ 2 (งานเก่าก่อนมีคลิป) หรือรอบ 4 ก็ได้
 */
export function roundOf(status: string): JobRound | null {
  if (status.endsWith("_r1")) return 1;
  if (status.endsWith("_r2")) return 2;
  if (status.endsWith("_r3") || status === FLOW_STATUS.AWAITING_PROMPT) return 3;
  if (status.endsWith("_upscale")) return 4;
  return null;
}

/**
 * ลำดับรอบที่บอทหยิบ: โหลด 1080p ก่อนสุด (สั้น ไม่เสียเครดิต ไม่นับเพดานไหนเลย) → รอบ 2 (คนรอ) → Render → รอบ 1
 * ครบเพดานรูป (dailyBatchCap) ข้ามรอบ 1/2 · ครบเพดานคลิป (videoDailyCap) ข้าม Render — ฝั่งที่เหลือยังทำต่อ
 */
export function claimOrder(imagesAllowed: boolean, rendersAllowed: boolean): JobRound[] {
  const order: JobRound[] = [4];
  if (imagesAllowed) order.push(2);
  if (rendersAllowed) order.push(3);
  if (imagesAllowed) order.push(1);
  return order;
}

/** ยังไม่จบ = entry นี้มีงานค้าง ห้ามเข้าคิวซ้ำ */
export function isOpenStatus(status: string): boolean {
  return status !== FLOW_STATUS.DONE && status !== FLOW_STATUS.SKIPPED;
}

/** พรอมต์ตายตัว (spec §3) — worker/flow-driver.ts มีสำเนาเดียวกัน ต้องแก้พร้อมกัน */
export function buildFlowPrompt(round: FlowRound, productName: string, extra = ""): string {
  const base =
    round === 1
      ? `ขอภาพสินค้าอย่างเดียวเท่านั้น พื้นหลังขาว สินค้าคือ "${productName}"`
      : `ขอภาพสินค้าตอนใช้งาน สินค้าคือ "${productName}"`;
  // ข้อความเพิ่มเติมของผู้ใช้ต่อท้ายเสมอ ไม่แทนพรอมต์ตั้งต้น (ว่าง = เหมือนเดิมทุกตัวอักษร)
  return extra === "" ? base : `${base} ${extra}`;
}

/** จำกัดความยาว — บอทพิมพ์ทีละตัวแบบคน ข้อความยาว = รอนานขึ้นทุกรอบ และพรอมต์สั้นๆ ก็พอบอกทิศทาง */
export const EXTRA_PROMPT_MAX = 200;

/** ทำความสะอาดข้อความเพิ่มเติมก่อนเก็บ: ยุบช่องว่าง/ขึ้นบรรทัดเป็นช่องว่างเดียว (ช่องพรอมต์ของ Flow กด Enter = ส่ง) */
export function normalizeExtraPrompt(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, EXTRA_PROMPT_MAX);
}

export function candidateFilename(round: FlowRound, attempt: number, index: number, ext: "png" | "jpg"): string {
  return `r${round}-a${attempt}-${index}.${ext}`;
}
export function sourceFilename(index: number, ext: string): string {
  return `source-${index}.${ext}`;
}
/**
 * คลิปตัวอย่าง 720p ของ Render ครั้งที่ attempt — worker/flow-driver.ts เขียนเป็น `${filePrefix}.mp4` (filePrefix = r3-a<attempt>)
 * ลบทิ้งเมื่อกด "เรนเดอร์ใหม่" หรือเมื่อโหลดไฟล์ 1080p ของคลิปที่ผ่านสำเร็จ
 */
export function videoFilename(attempt: number): string {
  return `r3-a${attempt}.mp4`;
}
/** คลิปที่ผ่านแล้ว แบบ 1080p Upscaled — 1 งานมีได้ไฟล์เดียว */
export const FINAL_VIDEO_PREFIX = "r3-final";
export const FINAL_VIDEO_FILENAME = `${FINAL_VIDEO_PREFIX}.mp4`;

/** ชื่อไฟล์ตอนกด "ดาวน์โหลดคลิป" — ชื่อสินค้าเป็นภาษาไทยได้ แต่ตัดอักขระที่ Windows ห้ามใช้ในชื่อไฟล์ออก */
export function videoDownloadName(productName: string): string {
  const safe = productName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${safe === "" ? "clip" : safe}.mp4`;
}

/**
 * พรอมต์ของ Render = 10-part prompt ของ Entry ทั้งก้อน + ข้อความเพิ่มเติมของผู้ใช้ต่อท้าย (ว่าง = เหมือนเดิมทุกตัวอักษร)
 * ไม่ยุบขึ้นบรรทัดของ 10-part prompt — worker วางด้วย insertText ซึ่งไม่กด Enter (Enter ในช่อง Flow = ส่ง)
 */
export function buildRenderPrompt(tenPartPrompt: string, extra = ""): string {
  return extra === "" ? tenPartPrompt : `${tenPartPrompt} ${extra}`;
}

/**
 * รอบ 1 → รอบ 2 · รอบ 2 → รอ 10-part prompt ก่อน Render (ไม่ใช่ done แล้ว — รูปถูกก๊อปเป็น ProductImage ตอนนี้
 * เหมือนเดิม แต่งานยังไม่จบจนกว่าผู้ใช้กด "ผ่าน" คลิป)
 */
export function afterChoose(status: string, renderEnabled = true): { status: FlowStatus } {
  if (status === FLOW_STATUS.REVIEW_R1) return { status: FLOW_STATUS.QUEUED_R2 };
  // ปิด Render อัตโนมัติ (flow-worker.config.json renderEnabled) = งานจบที่รูป 2 รอบ ผู้ใช้ทำคลิปเองใน Flow
  if (status === FLOW_STATUS.REVIEW_R2) return { status: renderEnabled ? FLOW_STATUS.AWAITING_PROMPT : FLOW_STATUS.DONE };
  throw new Error("งานนี้ไม่ได้อยู่ในขั้นรอเลือกรูป");
}

export function afterRedo(status: string): { status: FlowStatus } {
  if (status === FLOW_STATUS.REVIEW_R1) return { status: FLOW_STATUS.QUEUED_R1 };
  if (status === FLOW_STATUS.REVIEW_R2) return { status: FLOW_STATUS.QUEUED_R2 };
  if (status === FLOW_STATUS.REVIEW_R3) return { status: FLOW_STATUS.QUEUED_R3 };
  throw new Error("ทำใหม่ได้เฉพาะงานที่รอคุณเลือกรูป/ดูคลิป");
}

/** review_r3 ที่ไม่มีไฟล์ (โหลดไม่ได้ทั้งสองทาง): กด "ผ่าน" ไม่ได้ (ไม่มีไฟล์ให้ผ่าน) แต่ "เรนเดอร์ใหม่" ได้ */
export function canApproveRender(status: string, hasVideoFile: boolean): boolean {
  return status === FLOW_STATUS.REVIEW_R3 && hasVideoFile;
}

/** "ผ่าน" คลิปตัวอย่าง → ให้บอทโหลดคลิปเดิมแบบ 1080p (round 4) · งานจบเมื่อโหลดสำเร็จ */
export function afterApproveRender(status: string): { status: FlowStatus; round: JobRound } {
  if (status === FLOW_STATUS.REVIEW_R3) return { status: FLOW_STATUS.QUEUED_UPSCALE, round: 4 };
  throw new Error("งานนี้ไม่ได้อยู่ในขั้นรอดูคลิป");
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

export function afterResume(round: JobRound): { status: FlowStatus } {
  return { status: queuedStatus(round) };
}

export type QueueCategory = "waitingBot" | "waitingUser" | "done" | "failed";

/**
 * หมวดของงานบนหน้า /flow — ใช้ร่วมกันทั้งตัวนับ (summarizeQueue) และแถบกรอง (components/flow-route.tsx)
 * awaiting_prompt นับเป็น "รอบอท" เพราะ Angle สร้างพรอมต์ให้เอง คนไม่ต้องทำอะไร · skipped ไม่เข้าหมวดไหน
 */
export function queueCategory(status: string): QueueCategory | null {
  if (status.startsWith("queued_") || status.startsWith("running_") || status === FLOW_STATUS.AWAITING_PROMPT) {
    return "waitingBot";
  }
  if (status.startsWith("review_")) return "waitingUser";
  if (status === FLOW_STATUS.DONE) return "done";
  if (status === FLOW_STATUS.FAILED) return "failed";
  return null;
}

export function summarizeQueue(jobs: { status: string }[]): Record<QueueCategory, number> {
  const out: Record<QueueCategory, number> = { waitingBot: 0, waitingUser: 0, done: 0, failed: 0 };
  for (const j of jobs) {
    const cat = queueCategory(j.status);
    if (cat !== null) out[cat]++;
  }
  return out;
}

/** heartbeat หายเกิน 3 รอบ = ถือว่าบอทไม่อยู่แล้ว */
export function isWorkerAlive(lastSeenAt: Date | null, now: Date, heartbeatMs: number): boolean {
  if (lastSeenAt === null) return false;
  return now.getTime() - lastSeenAt.getTime() < heartbeatMs * 3;
}

export const DEFAULT_CAPTIONS: Record<FlowRound, string> = {
  1: "สินค้า พื้นหลังขาว",
  2: "สินค้าตอนใช้งาน",
};

export const STATUS_LABELS: Record<FlowStatus, string> = {
  queued_r1: "รอบอท · รอบ 1",
  running_r1: "บอทกำลังวาด · รอบ 1",
  review_r1: "รอคุณเลือก · รอบ 1 (พื้นหลังขาว)",
  queued_r2: "รอบอท · รอบ 2",
  running_r2: "บอทกำลังวาด · รอบ 2",
  review_r2: "รอคุณเลือก · รอบ 2 (ตอนใช้งาน)",
  awaiting_prompt: "รอ 10-part prompt · ก่อนทำคลิป",
  queued_r3: "รอบอท · ทำคลิป",
  running_r3: "บอทกำลังทำคลิป",
  review_r3: "รอคุณดูคลิป",
  queued_upscale: "ผ่านแล้ว · รอบอทโหลด 1080p",
  running_upscale: "ผ่านแล้ว · บอทกำลังโหลด 1080p",
  done: "เสร็จ",
  failed: "พัง",
  skipped: "ข้ามแล้ว",
};

export const STEP_LABELS: Record<string, string> = {
  "open-flow": "เปิดหน้า Flow",
  "ensure-project": "เปิด/สร้าง project",
  "switch-image-mode": "สลับเป็นโหมดรูป",
  "set-model": "เลือกโมเดล Nano Banana 2",
  "set-aspect-3-4": "ตั้งอัตราส่วน 3:4",
  "set-count-4": "ตั้งจำนวน ×4",
  "attach-reference": "แนบรูปอ้างอิง",
  "type-prompt": "พิมพ์พรอมต์",
  "click-generate": "กดสร้าง",
  "wait-results": "รอผล",
  dwell: "ดูผลก่อนโหลด",
  "download-4": "โหลด 4 รูป",
  "switch-video-mode": "สลับเป็นโหมดวิดีโอ",
  "set-video-settings": "ตั้งค่าคลิป (Ingredients · 9:16 · Omni 1.1 Flash · 720p · 10s · x1)",
  "paste-prompt": "วาง 10-part prompt",
  "wait-render": "รอคลิป",
  "download-preview": "โหลดคลิปตัวอย่าง 720p (ลิงก์ตรง → เมนู)",
  "find-video": "หาคลิปที่ผ่านในโปรเจกต์เดิม",
  "download-final": "โหลดคลิป 1080p Upscaled",
};

export const ERROR_KIND_LABELS: Record<string, string> = {
  selector_drift: "หาปุ่ม/ช่องไม่เจอ — Flow อาจเปลี่ยนหน้า",
  login_required:
    "session หลุด — บอทปิดตัวเองแล้ว: เปิด Flow Login ล็อกอินบัญชีสำรอง → ปิด Chrome → เปิด start.bat ใหม่ (งานที่ค้างจะรันต่อเอง)",
  captcha: "โดน captcha / ถูกปฏิเสธ (403) — พักอย่างน้อย 1 ชั่วโมงก่อนรันต่อ",
  generation_timeout: "รอผลนานเกินกำหนด",
  flow_error: "Flow แจ้ง error",
  download_failed: "โหลดรูป/คลิปกลับไม่ครบ",
  worker_crash: "บอทล้มโดยไม่ทราบสาเหตุ",
  host_unsupported: "บัญชีอยู่บนโฮสต์ที่ยังไม่รองรับ",
};

/**
 * ข้อความของงาน (errorMessage) แบบคนอ่านรู้เรื่อง — summary บรรทัดเดียวภาษาไทยธรรมดา + detail คือข้อความดิบเต็ม
 * (ไว้พับใน <details>) · ว่าง = ไม่มีอะไรให้โชว์ · ข้อความสั้นที่เป็นภาษาไทยอยู่แล้วและไม่ใช่ error ดิบ แสดงตามเดิมไม่พับ
 */
export function friendlyJobMessage(status: string, errorMessage: string): { summary: string; detail: string | null } {
  const raw = errorMessage.trim();
  if (raw === "") return { summary: "", detail: null };
  if (raw.startsWith("ได้ 720p")) return { summary: "ได้คลิป 720p — โหลด 1080p ไม่สำเร็จ", detail: raw };
  const looksTechnical =
    raw.length > 140 || /Timeout \d+ms|Call log|locator\.|page\.|net::|at \S+:\d+|\n/.test(raw);
  if (!looksTechnical) return { summary: raw, detail: null };
  const summary =
    status === FLOW_STATUS.FAILED ? "บอทแจ้งข้อผิดพลาดทางเทคนิค — ดูรายละเอียดด้านล่าง" : "มีข้อความทางเทคนิคจากบอท — ดูรายละเอียดด้านล่าง";
  return { summary, detail: raw };
}
