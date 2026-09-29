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
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type FlowStatus = (typeof FLOW_STATUS)[keyof typeof FLOW_STATUS];
export type FlowRound = 1 | 2;

export const FLOW_ROUND_1_STATUSES: FlowStatus[] = [
  FLOW_STATUS.QUEUED_R1,
  FLOW_STATUS.RUNNING_R1,
  FLOW_STATUS.REVIEW_R1,
];

export const WORKER_STATE_ID = "singleton";

export function queuedStatus(round: FlowRound): FlowStatus {
  return round === 1 ? FLOW_STATUS.QUEUED_R1 : FLOW_STATUS.QUEUED_R2;
}
export function runningStatus(round: FlowRound): FlowStatus {
  return round === 1 ? FLOW_STATUS.RUNNING_R1 : FLOW_STATUS.RUNNING_R2;
}
export function reviewStatus(round: FlowRound): FlowStatus {
  return round === 1 ? FLOW_STATUS.REVIEW_R1 : FLOW_STATUS.REVIEW_R2;
}

/** รอบที่ status นี้อยู่ · done = 2 · failed/skipped ไม่รู้จากชื่อ (ใช้ job.round แทน) */
export function roundOf(status: string): FlowRound | null {
  if (status.endsWith("_r1")) return 1;
  if (status.endsWith("_r2") || status === FLOW_STATUS.DONE) return 2;
  return null;
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

export function afterChoose(status: string): { status: FlowStatus } {
  if (status === FLOW_STATUS.REVIEW_R1) return { status: FLOW_STATUS.QUEUED_R2 };
  if (status === FLOW_STATUS.REVIEW_R2) return { status: FLOW_STATUS.DONE };
  throw new Error("งานนี้ไม่ได้อยู่ในขั้นรอเลือกรูป");
}

export function afterRedo(status: string): { status: FlowStatus } {
  if (status === FLOW_STATUS.REVIEW_R1) return { status: FLOW_STATUS.QUEUED_R1 };
  if (status === FLOW_STATUS.REVIEW_R2) return { status: FLOW_STATUS.QUEUED_R2 };
  throw new Error("วาดใหม่ได้เฉพาะงานที่รอเลือกรูป");
}

export function afterResume(round: FlowRound): { status: FlowStatus } {
  return { status: queuedStatus(round) };
}

export function summarizeQueue(jobs: { status: string }[]): {
  waitingBot: number;
  waitingUser: number;
  done: number;
  failed: number;
} {
  let waitingBot = 0, waitingUser = 0, done = 0, failed = 0;
  for (const j of jobs) {
    if (j.status.startsWith("queued_") || j.status.startsWith("running_")) waitingBot++;
    else if (j.status.startsWith("review_")) waitingUser++;
    else if (j.status === FLOW_STATUS.DONE) done++;
    else if (j.status === FLOW_STATUS.FAILED) failed++;
  }
  return { waitingBot, waitingUser, done, failed };
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
  done: "เสร็จ · 2 รูปอยู่ใน entry แล้ว",
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
};

export const ERROR_KIND_LABELS: Record<string, string> = {
  selector_drift: "หาปุ่ม/ช่องไม่เจอ — Flow อาจเปลี่ยนหน้า",
  login_required:
    "session หลุด — บอทปิดตัวเองแล้ว: เปิด Flow Login ล็อกอินบัญชีสำรอง → ปิด Chrome → เปิด start.bat ใหม่ (งานที่ค้างจะรันต่อเอง)",
  captcha: "โดน captcha / ถูกปฏิเสธ (403) — พักอย่างน้อย 1 ชั่วโมงก่อนรันต่อ",
  generation_timeout: "รอผลนานเกินกำหนด",
  flow_error: "Flow แจ้ง error",
  download_failed: "โหลดรูปกลับไม่ครบ",
  worker_crash: "บอทล้มโดยไม่ทราบสาเหตุ",
  host_unsupported: "บัญชีอยู่บนโฮสต์ที่ยังไม่รองรับ",
};
