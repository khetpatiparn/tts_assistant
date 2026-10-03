import { readFileSync } from "node:fs";
import path from "node:path";

/** ช่วงสุ่ม [ต่ำสุด, สูงสุด] เป็นมิลลิวินาที (หรือจำนวนนับ สำหรับ longBreakEvery) */
export type Range = [number, number];

export type WorkerConfig = {
  flowUrl: string;
  profileDir: string;
  viewport: { width: number; height: number };
  actionDelayMs: Range;
  typeCharDelayMs: Range;
  dwellAfterResultsMs: Range;
  betweenBatchesMs: Range;
  betweenProductsMs: Range;
  longBreakEvery: Range;
  longBreakMs: Range;
  dailyBatchCap: number;
  /**
   * เพดานคลิปที่ Render ต่อวัน (15 เครดิต/คลิป) — กันเครดิตหมดในวันเดียวถ้ามีอะไรผิด ครบแล้วบอทยังวาดรูปต่อได้
   * แยกจาก dailyBatchCap (ชุดรูป) ครบฝั่งไหนก็หยุดเฉพาะงานฝั่งนั้น
   */
  /**
   * ให้บอท Render คลิปเองไหม — ผู้ใช้ลองปิดแล้วทำเอง (2026-09-30) แล้วตัดสินใจกลับมาใช้แบบอัตโนมัติ ("สุดท้ายเราต้องการ
   * ความ automation") ไฟล์จริงจึงตั้ง true · ปิด = เลือกรูปรอบ 2 แล้วงานจบ (done) หน้าคิว Flow มีแผงช่วยทำเองใน Flow
   * บัญชีหลัก · ไม่มี key นี้ในไฟล์ = ปิด
   */
  renderEnabled: boolean;
  videoDailyCap: number;
  /**
   * จำนวนครั้ง/วัน (เวลาท้องถิ่น) ที่บอทข้ามงานที่ Flow วาดไม่สำเร็จไปทำงานถัดไปโดยไม่หยุดคิว · 0 = ปิด (พังแล้วหยุดทั้งคิวเหมือนเดิม)
   * ไม่มี key นี้ในไฟล์ = 2 · ดูเงื่อนไขที่ failurePolicy ใน lib/flow-lifecycle.ts
   */
  autoContinueDailyCap: number;
  /** ["22:00","07:00"] = ทำงานเฉพาะช่วงนี้ (ข้ามเที่ยงคืนได้) · null = ตลอดเวลา */
  activeHours: [string, string] | null;
  generationTimeoutMs: number;
  /** รอคลิปเสร็จหลังกดสร้าง (วัดจริง ~1.5 นาที) */
  renderTimeoutMs: number;
  /** รอไฟล์ 1080p Upscaled หลังกดโหลด — Flow ขยายจาก 720p ตอนโหลด (ไม่เสียเครดิต) จึงนานกว่าโหลดตรง */
  renderDownloadTimeoutMs: number;
  uploadTimeoutMs: number;
  selectorTimeoutMs: number;
  pollIdleMs: number;
  heartbeatMs: number;
  mouse: { curve: boolean; idleScrollChance: number };
};

const RANGE_KEYS = [
  "actionDelayMs", "typeCharDelayMs", "dwellAfterResultsMs", "betweenBatchesMs",
  "betweenProductsMs", "longBreakEvery", "longBreakMs",
] as const;

const POSITIVE_KEYS = [
  "dailyBatchCap", "videoDailyCap", "generationTimeoutMs", "renderTimeoutMs", "renderDownloadTimeoutMs",
  "uploadTimeoutMs", "selectorTimeoutMs", "pollIdleMs", "heartbeatMs",
] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertRange(key: string, value: unknown): asserts value is Range {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isFinite(n) && n >= 0)) {
    throw new Error(`config ${key} ต้องเป็น [min, max] ที่เป็นตัวเลข ≥ 0`);
  }
  if (value[0] > value[1]) throw new Error(`config ${key}: min (${value[0]}) มากกว่า max (${value[1]})`);
}

/**
 * อ่าน flow-worker.config.json แล้ว validate ทุก field — ค่าผิดต้องล้มตั้งแต่ตอนเปิด worker
 * ไม่ใช่ตอนกำลังคลิกอยู่ใน Flow
 */
export function loadWorkerConfig(file = "flow-worker.config.json"): WorkerConfig {
  const raw = JSON.parse(readFileSync(path.resolve(file), "utf8")) as Record<string, unknown>;

  if (typeof raw.flowUrl !== "string" || !raw.flowUrl.startsWith("https://")) {
    throw new Error("config flowUrl ต้องเป็น URL https");
  }
  if (typeof raw.profileDir !== "string" || raw.profileDir.length === 0) {
    throw new Error("config profileDir ต้องไม่ว่าง");
  }
  const vp = raw.viewport as { width?: unknown; height?: unknown } | undefined;
  if (!vp || typeof vp.width !== "number" || typeof vp.height !== "number") {
    throw new Error("config viewport ต้องมี width/height เป็นตัวเลข");
  }
  for (const key of RANGE_KEYS) assertRange(key, raw[key]);
  for (const key of POSITIVE_KEYS) {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      throw new Error(`config ${key} ต้องเป็นจำนวนเต็ม ≥ 1`);
    }
  }
  const ah = raw.activeHours;
  if (ah !== null) {
    if (!Array.isArray(ah) || ah.length !== 2 || !ah.every((s) => typeof s === "string" && HHMM.test(s))) {
      throw new Error('config activeHours ต้องเป็น null หรือ ["HH:MM","HH:MM"]');
    }
  }
  const mouse = raw.mouse as { curve?: unknown; idleScrollChance?: unknown } | undefined;
  if (!mouse || typeof mouse.curve !== "boolean" || typeof mouse.idleScrollChance !== "number"
      || mouse.idleScrollChance < 0 || mouse.idleScrollChance > 1) {
    throw new Error("config mouse ต้องมี curve (boolean) และ idleScrollChance (0..1)");
  }

  if (raw.renderEnabled !== undefined && typeof raw.renderEnabled !== "boolean") {
    throw new Error("config renderEnabled ต้องเป็น true/false");
  }

  const ac = raw.autoContinueDailyCap;
  if (ac !== undefined && (typeof ac !== "number" || !Number.isInteger(ac) || ac < 0)) {
    throw new Error("config autoContinueDailyCap ต้องเป็นจำนวนเต็ม ≥ 0 (0 = ปิด)");
  }

  return { ...raw, renderEnabled: raw.renderEnabled === true, autoContinueDailyCap: ac ?? 2 } as unknown as WorkerConfig;
}
