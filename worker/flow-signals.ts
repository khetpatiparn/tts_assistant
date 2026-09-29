/**
 * แยกประเภทสัญญาณจาก Flow ระหว่างรอผล (pure — ไม่ import playwright จึงตรวจได้ด้วย
 * scripts/check-flow-worker-pure.mjs) · เพิ่ม 2026-09-29 หลังแกะ extension AI4Next เทียบกับบอทเรา
 *
 * หลักคิด: สัญญาณ "โดนจับว่าเป็นบอท" ต้องไม่ถูกรายงานเป็น flow_error ธรรมดา — flow_error มีคำแนะนำว่า
 * "กดรันต่อ 1 ครั้ง" ซึ่งเท่ากับยิงซ้ำใส่หน้าที่บล็อกเราอยู่ (สัญญาณบอทที่ชัดที่สุด) ส่วน captcha = พักอย่างน้อย
 * 1 ชั่วโมง ดังนั้นเมื่อไม่แน่ใจให้เอียงไปทาง captcha
 */
import type { ErrorKind } from "./errors";

/**
 * การ์ด <flow-error-tile> ใช้ element เดียวกันทั้งตอน Flow วาดไม่สำเร็จเอง ("Sorry, this image failed to
 * generate") และตอนโดนบล็อก — ข้อความของกรณีหลังคือ "unusual activity" (AI4Next เช็กคำนี้ใน
 * content-scripts/flow-content.js) ไม่ใช่ "unusual traffic" ที่ captchaSignals ของเราเคยดักอยู่คำเดียว
 */
const BOT_BLOCK_TEXT = /unusual (activity|traffic)|verify (you are|you're) (a )?human|automated (queries|requests)/i;

export function errorKindForTileTexts(texts: string[]): ErrorKind {
  return texts.some((t) => BOT_BLOCK_TEXT.test(t)) ? "captcha" : "flow_error";
}

/**
 * HTTP status ของ RPC batchexecute หลังกด Generate — ใช้กับโฮสต์ที่อ่านผลจาก DOM (flow.google.com)
 * ซึ่งเดิมไม่เช็ก status เลย · batchexecute รวม RPC หลายตัวในหน้า (ไม่ใช่แค่ตัวเจนรูป) จึงนับเฉพาะรหัส
 * ที่แปลว่า "ถูกบล็อก/หลุด" เท่านั้น 404/500 ของ RPC อื่นที่ไม่เกี่ยวต้องไม่หยุดงาน
 * 429 = ส่งถี่เกิน → ถือเป็น captcha (พักยาว) ไม่ใช่ flow_error ที่แนะนำให้กดต่อทันที
 */
export function blockKindForStatus(status: number): ErrorKind | null {
  if (status === 401) return "login_required";
  if (status === 403 || status === 429) return "captcha";
  return null;
}

/**
 * Flow รับคำสั่งเจนแล้วหรือยัง — ถ้ากด Generate แล้วคลิกไม่ติด เดิมบอทนั่งรอเต็ม generationTimeoutMs
 * (5 นาที) แล้วรายงานว่า "ช้า" · หลักฐานจาก DOM จริง (uploads/_flow-failures/cmumqwrz5…-1790690647902):
 * ทันทีที่รับคำสั่ง Flow เพิ่ม <flow-grid-tile-container> ตามจำนวนที่ขอ เป็น <flow-pending-tile> ระหว่างวาด
 * แล้วกลายเป็นรูป/การ์ด error และช่องพิมพ์พรอมต์ถูกล้างว่าง
 */
/**
 * เกณฑ์รับคำตอบของ Jev ตอนใช้หาปุ่มแทน selector ที่พัง (dom-heuristics.ts findByJev) — ทดสอบย้อนหลังกับ
 * page.html ของหลักฐานจริง 9 หน้า (2026-09-29): ส่งชื่อ class ไปด้วย + ความมั่นใจ ≥ 0.9 ถูก 31/31 ครั้ง
 * ตัด class ทิ้ง (จำลอง Flow เปลี่ยนหน้า) ≥ 0.9 ผิด 3/32 ที่ 0.90-0.91 ทั้งหมด (หยิบปุ่มตั้งค่าของโหมด Agent)
 * จึงตั้ง 0.93 และส่ง class เสมอ · "none" = Jev บอกว่าไม่มีปุ่มที่ตรง ห้ามกดอะไร
 */
export const JEV_MIN_PROBABILITY = 0.93;

export function acceptJevChoice(answer: { choice: string; p: number } | null, min = JEV_MIN_PROBABILITY): string | null {
  if (answer === null || answer.choice === "none") return null;
  return answer.p >= min ? answer.choice : null;
}

export function generateAccepted(s: {
  tilesBefore: number;
  tilesNow: number;
  pendingNow: number;
  freshErrorTiles: number;
  goodCount: number;
}): boolean {
  return s.tilesNow > s.tilesBefore || s.pendingNow > 0 || s.freshErrorTiles > 0 || s.goodCount > 0;
}
