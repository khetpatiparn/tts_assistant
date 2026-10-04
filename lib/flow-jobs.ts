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

/**
 * ลำดับงานที่บอทลองหยิบ: เรียงรอบตาม `rounds` (claimOrder) ในรอบเดียวกันตามลำดับของ `queued` (ส่งมาเรียงเวลาเข้าคิวแล้ว)
 * · ตัดงานที่ยังไม่ถึงเวลาลองชื่อสั้นใหม่ (`waitingUntil` = jobId → epoch ms เก็บในหน่วยความจำของบอท) — งานยังอยู่ในคิว
 * ไม่ถูกแตะ งานถัดไปขึ้นมาแทน · ทุกงานรออยู่ = รายการว่าง บอทว่างเหมือนไม่มีงาน (ไม่วนเรียกตัวย่อชื่อถี่ๆ)
 */
export function claimSequence(
  rounds: JobRound[],
  queued: { id: string; status: string }[],
  waitingUntil: ReadonlyMap<string, number>,
  now: number,
): { id: string; round: JobRound }[] {
  const out: { id: string; round: JobRound }[] = [];
  for (const round of rounds) {
    for (const j of queued) {
      if (j.status !== queuedStatus(round)) continue;
      if ((waitingUntil.get(j.id) ?? 0) > now) continue;
      out.push({ id: j.id, round });
    }
  }
  return out;
}

/** รอบที่บอทพิมพ์ productName ลงพรอมต์ Flow (buildFlowPrompt) = ต้องมีชื่อสั้นก่อนหยิบ · Render/โหลด 1080p ไม่ใช้ชื่อ */
export function needsShortNameGate(round: JobRound): boolean {
  return round === 1 || round === 2;
}

/** บอทย่อชื่อไม่สำเร็จครั้งที่ n (นับจาก 1) → รอนานเท่านี้ก่อนลองงานนั้นใหม่: 2 → 5 → 15 → 30 นาที (คงที่ 30 ต่อจากนั้น) */
export function shortNameRetryDelayMs(failures: number): number {
  const minutes = [2, 5, 15, 30];
  return minutes[Math.min(Math.max(failures, 1), minutes.length) - 1] * 60_000;
}

/** ยังไม่จบ = entry นี้มีงานค้าง ห้ามเข้าคิวซ้ำ */
export function isOpenStatus(status: string): boolean {
  return status !== FLOW_STATUS.DONE && status !== FLOW_STATUS.SKIPPED;
}

/**
 * พรอมต์ตายตัว (spec §3) — ที่เดียวของพรอมต์รอบรูป: บอทพิมพ์ด้วยฟังก์ชันนี้ (worker/flow-driver.ts) และหน้า /flow
 * โชว์ตัวอย่างด้วยตัวเดียวกัน จึงตรงกันทุกตัวอักษรเสมอ
 */
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

/**
 * รูปแบบลิงก์โปรเจกต์บน flow.google.com — ที่เดียวที่รู้รูปแบบนี้: บอทเปิดโปรเจกต์ด้วยตัวนี้ (`projectUrl` ของชุด
 * `migrated` ใน worker/flow-selectors.ts) และหน้าเว็บใช้ผ่าน flowProjectUrl · ไม่ตรวจ id (บอทได้ id จาก URL ของ Flow เอง)
 */
export function flowGoogleProjectUrl(id: string): string {
  return `https://flow.google.com/project/${id}?hl=en`;
}

/**
 * ลิงก์โปรเจกต์ Flow ของงาน — โปรเจกต์อยู่ใน**บัญชีสำรอง**ของบอท เปิดในเบราว์เซอร์ที่ล็อกอินบัญชีหลักไม่ได้
 * (ต้องเปิดในโปรไฟล์ Chrome ที่ล็อกอินบัญชีสำรอง — ห้ามใช้ .flow-profile ของบอทตอนบอทเปิดอยู่) · "" = ยังไม่มีโปรเจกต์
 */
export function flowProjectUrl(flowProjectId: string): string {
  const id = flowProjectId.trim();
  return /^[A-Za-z0-9-]+$/.test(id) ? flowGoogleProjectUrl(id) : "";
}

/**
 * เลือกโปรไฟล์ Brave ของบัญชีสำรอง จาก profile.info_cache ใน "Local State" ของ Brave — ชื่อโปรไฟล์ต้องมีคำว่า
 * flow / สำรอง / backup (ผู้ใช้ตั้งเอง) และต้องเจอ**ตัวเดียว** ไม่งั้นคืน null (ไม่เดา — เปิดผิดบัญชีไม่มีประโยชน์)
 */
export function pickBackupBrowserProfile(infoCache: Record<string, { name?: unknown }>): string | null {
  const hits = Object.entries(infoCache).filter(([, v]) => typeof v?.name === "string" && /flow|สำรอง|backup/i.test(v.name));
  return hits.length === 1 ? hits[0][0] : null;
}

/** คำนำหน้าชื่อเต็มของร้านที่เก็บไว้ใน productInfo เมื่อ productName ถูกย่อ */
export const FULL_TITLE_PREFIX = "ชื่อเต็มจากร้าน: ";

/**
 * รับชื่อสั้นที่ Gemini ย่อมาเฉพาะเมื่อดูสมเหตุสมผล (1–60 ตัว บรรทัดเดียว ไม่ยาวเท่าชื่อเต็ม) ไม่งั้นใช้ชื่อเต็ม
 * ชื่อ SEO ยาวของร้าน (มีคุณสมบัติ/คำโฆษณา) ทำให้ Flow ใส่ตัวหนังสือลงในรูป — เจอจริง 2026-10-02
 */
export function acceptShortName(candidate: string, fullTitle: string): string {
  return shortNameOutcome(candidate, fullTitle)?.name ?? fullTitle;
}

/**
 * ผลของคำตอบจากตัวย่อชื่อ — `null` = ไม่สำเร็จ ต้องลองใหม่ (ว่าง / เกิน 60 / หลายบรรทัด) · ไม่สั้นกว่าชื่อร้าน = ชื่อร้านสั้นพอ
 * อยู่แล้ว ใช้ชื่อร้านได้ (สำเร็จ — ไม่งั้นงานของสินค้าที่ชื่อร้านสั้นอยู่แล้วจะรอชื่อสั้นตลอดไป)
 */
export function shortNameOutcome(answer: string, fullTitle: string): { name: string } | null {
  const t = answer.replace(/\s+/g, " ").trim();
  if (t === "" || t.length > 60 || /[\r\n]/.test(answer.trim())) return null;
  return { name: t.length >= fullTitle.trim().length ? fullTitle : t };
}

const sameTitle = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/**
 * **ที่เดียวที่ตัดสินว่า "ชื่อยังเป็นชื่อเต็มของร้าน"** (ticket 07) — บอทไม่วาดรอบ 1–2 ของ entry ที่ยังเป็นแบบนี้ (พิมพ์ลงพรอมต์
 * Flow แล้ว Flow ใส่ตัวหนังสือในรูป) · `shopTitles` = ชื่อของ ProductCandidate ที่ผูก entry นี้ (linkedEntryId) · productInfo มี
 * FULL_TITLE_PREFIX = ตัดสินไปแล้ว (ย่อแล้ว / ชื่อร้านสั้นพอ) ไม่ย่อซ้ำ · entry ที่ไม่ได้มาจากร้าน (ไม่มีชื่อผูก) ไม่เข้าข่าย
 */
export function isUnshortenedName(entry: { productName: string; productInfo: string }, shopTitles: string[]): boolean {
  if (entry.productInfo.includes(FULL_TITLE_PREFIX)) return false;
  return shopTitles.some((t) => sameTitle(t, entry.productName));
}

/** productInfo หลังย่อชื่อสำเร็จ — เก็บชื่อเต็มของร้านไว้ให้ 10-part prompt · ไม่ทับสิ่งที่ผู้ใช้เขียนไว้ (ต่อบรรทัดใหม่) */
export function productInfoWithFullTitle(productInfo: string, fullTitle: string): string {
  if (productInfo.includes(FULL_TITLE_PREFIX)) return productInfo;
  const line = `${FULL_TITLE_PREFIX}${fullTitle}`;
  return productInfo.trim() === "" ? line : `${productInfo}\n${line}`;
}

/**
 * เวลารอสูงสุดของการเรียกตัวย่อชื่อแต่ละครั้ง (เบื้องหลัง/บอท) — ไม่ใช่เพดานที่ผู้ใช้รอ (ไม่มีใครรอแล้ว) แค่กันคำขอที่ค้าง
 * ไม่ตอบเลยทำให้ไม่ได้ลองใหม่ / บอทค้าง
 */
export const SHORT_NAME_ATTEMPT_TIMEOUT_MS = 60_000;

/** รอ promise ไม่เกิน ms — เกินแล้วโยน Error ที่มี label (ไม่ยกเลิกงานเดิม แค่เลิกรอ) · งานล้มเองส่ง error เดิมต่อ */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} เกิน ${String(ms / 1000)} วิ`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

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

/**
 * แท็บของหน้า /flow (spec 2026-10-04) — จัดกลุ่มล้วนๆ ตามสิ่งที่ผู้ใช้ต้องทำ ไม่เปลี่ยนสถานะ/พฤติกรรมของงาน
 * choose = เลือกรูปรอบ 1+2 · clip = ดูคลิปตัวอย่าง · failed = พัง · bot = บอททำ/รอคิว/รอพรอมต์ · closed = เสร็จ+ข้าม
 */
export type FlowTab = "choose" | "clip" | "failed" | "bot" | "closed";

/** ลำดับแท็บ = ลำดับที่แสดง และลำดับที่หาแท็บเริ่มต้น (3 แท็บแรกคือแท็บที่รอผู้ใช้) */
export const FLOW_TABS: { key: FlowTab; label: string }[] = [
  { key: "choose", label: "เลือกรูป" },
  { key: "clip", label: "ดูคลิป" },
  { key: "failed", label: "พัง" },
  { key: "bot", label: "บอทกำลังทำ / รอคิว" },
  { key: "closed", label: "เสร็จ / ข้าม" },
];

export function flowTabOf(status: string): FlowTab {
  if (status === FLOW_STATUS.REVIEW_R1 || status === FLOW_STATUS.REVIEW_R2) return "choose";
  if (status === FLOW_STATUS.REVIEW_R3) return "clip";
  if (status === FLOW_STATUS.FAILED) return "failed";
  if (status === FLOW_STATUS.DONE || status === FLOW_STATUS.SKIPPED) return "closed";
  // queued_* / running_* / awaiting_prompt (และสถานะใหม่ที่ยังไม่รู้จัก — ให้เห็นในแท็บบอทดีกว่าหายไป)
  return "bot";
}

export function countByTab(jobs: { status: string }[]): Record<FlowTab, number> {
  const out: Record<FlowTab, number> = { choose: 0, clip: 0, failed: 0, bot: 0, closed: 0 };
  for (const j of jobs) out[flowTabOf(j.status)]++;
  return out;
}

/** แท็บแรกของ เลือกรูป/ดูคลิป/พัง ที่มีงาน · ไม่มีเลย = แท็บบอท */
export function defaultFlowTab(counts: Record<FlowTab, number>): FlowTab {
  for (const key of ["choose", "clip", "failed"] as const) if (counts[key] > 0) return key;
  return "bot";
}

export function parseFlowTab(raw: string | null | undefined): FlowTab | null {
  return FLOW_TABS.find((t) => t.key === raw)?.key ?? null;
}

/**
 * ป้ายชนิดงานในแท็บ: เลือกรูป → "รอบ N" · บอท → วาดรูป รอบ N / เรนเดอร์คลิป / โหลด 1080p / รอพรอมต์ · แท็บอื่น null
 * (round มาจาก FlowJob.round แต่ใช้เฉพาะเมื่อชื่อสถานะบอกรอบไม่ได้ — ตอนนี้ทุกสถานะที่เกี่ยวบอกรอบในชื่อเอง)
 */
export function jobKindLabel(status: string, round: number): string | null {
  const tab = flowTabOf(status);
  if (tab === "choose") return `รอบ ${roundOf(status) ?? toJobRound(round)}`;
  if (tab !== "bot") return null;
  if (status === FLOW_STATUS.AWAITING_PROMPT) return "รอพรอมต์";
  const r = roundOf(status) ?? toJobRound(round);
  if (r === 4) return "โหลด 1080p";
  if (r === 3) return "เรนเดอร์คลิป";
  return `วาดรูป รอบ ${r}`;
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
