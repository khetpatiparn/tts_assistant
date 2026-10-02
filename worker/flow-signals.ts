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

/**
 * ป้ายบนปุ่มตั้งค่า (settings trigger) หลังตั้งค่า Render ครบ — เห็นจริง 2026-09-30: `Video · 720p · 10s` + ไอคอน
 * `crop_9_16` + `x1` (innerText ของ mat-icon คือชื่อ ligature) ยืนยันทั้งชุดได้ในบรรทัดเดียวหลังปิดแผง
 * ไม่ผูกลำดับ/ช่องว่างระหว่างชิ้น เพราะ innerText ขึ้นบรรทัดตาม layout
 */
export function renderSettingsLabelOk(text: string): boolean {
  return (
    /Video\s*·\s*720p\s*·\s*10s/.test(text) &&
    /crop_9_16/.test(text) &&
    /(^|\s)x1(\s|$)/.test(text)
  );
}

/** ไฟล์ที่โหลดมาเป็น MP4 จริงไหม — ไบต์ 4-7 ของไฟล์ ISO BMFF คือกล่อง `ftyp` (ไฟล์ของ Flow = `ftypisom`) */
export function isMp4Header(buf: Uint8Array): boolean {
  return buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
}

/**
 * id ของคลิปใน Flow จาก src ของ thumbnail ในช่องวิดีโอ — เก็บไว้ (FlowJobImage.flowMediaId) เพื่อกลับมาหาช่องเดิม
 * ตอนโหลด 1080p · `flow-content.google/image/<uuid>` → uuid · src แบบอื่นใช้ host+path (ไม่เอา query ซึ่งอาจเป็น
 * ลายเซ็นที่เปลี่ยนทุกครั้งที่โหลดหน้า) · src ว่าง/อ่านไม่ออก → "" (ห้ามจับคู่กับอะไรเลย)
 */
export function flowMediaIdFromSrc(src: string | null): string {
  if (src === null || src.trim() === "") return "";
  try {
    const u = new URL(src, "https://flow.google.com");
    const m = /\/image\/([^/]+)/.exec(u.pathname);
    return m ? m[1] : `${u.host}${u.pathname}`;
  } catch {
    return "";
  }
}

/**
 * ช่องวิดีโอที่เพิ่งเสร็จ = id ที่ไม่มีก่อนกดสร้าง · ว่าง = thumbnail ยังไม่โหลด ไม่นับ
 * (โปรเจกต์เดียวกันมีคลิปของครั้งก่อนอยู่ด้วยตอนเรนเดอร์ใหม่ — ต้องชี้ช่องใหม่ให้ถูกก่อนโหลด)
 */
export function pickNewThumbnail(before: string[], now: string[]): string | null {
  return now.find((id) => id !== "" && !before.includes(id)) ?? null;
}

/**
 * Flow รับคำสั่งเจนแล้วหรือยัง — ถ้ากด Generate แล้วคลิกไม่ติด เดิมบอทนั่งรอเต็ม generationTimeoutMs
 * (5 นาที) แล้วรายงานว่า "ช้า" · หลักฐานจาก DOM จริง (uploads/_flow-failures/cmumqwrz5…-1790690647902):
 * ทันทีที่รับคำสั่ง Flow เพิ่ม <flow-grid-tile-container> ตามจำนวนที่ขอ เป็น <flow-pending-tile> ระหว่างวาด
 * แล้วกลายเป็นรูป/การ์ด error และช่องพิมพ์พรอมต์ถูกล้างว่าง
 */
export function generateAccepted(s: {
  tilesBefore: number;
  tilesNow: number;
  pendingNow: number;
  freshErrorTiles: number;
  goodCount: number;
}): boolean {
  return s.tilesNow > s.tilesBefore || s.pendingNow > 0 || s.freshErrorTiles > 0 || s.goodCount > 0;
}

/**
 * ลิงก์ไฟล์วิดีโอตรงจาก <video src> ที่ Flow ใส่ให้ตอน hover ช่องคลิป — รูปแบบจริง (page.html ของหลักฐาน 2026-09-30):
 * `https://flow-content.google/video/<uuid>?Expires=…&KeyName=labs-flow-prod-cdn-key&Signature=…` ดึงได้โดยไม่ต้อง cookie
 * (curl ไม่ล็อกอิน → 200 video/mp4) หมดอายุ ~6 ชม. · รับเฉพาะ host นี้ + path /video/ เท่านั้น: blob:, /image/, host อื่น = null
 * ให้ผู้เรียกถอยไปใช้เมนู
 */
export function pickDirectVideoUrl(srcs: (string | null)[]): string | null {
  for (const src of srcs) {
    if (!src) continue;
    try {
      const u = new URL(src);
      if (u.protocol === "https:" && u.host === "flow-content.google" && u.pathname.startsWith("/video/")) return src;
    } catch {
      // ไม่ใช่ URL
    }
  }
  return null;
}

/**
 * id ถาวรของคลิปจากลิงก์ตรง `https://flow-content.google/video/<uuid>?…` ("" = ไม่ใช่ลิงก์นั้น)
 * ใช้แทน id จาก thumbnail ซึ่งเปลี่ยนเป็น `/asb/<ลายเซ็น>` ทุกครั้งที่เปิดโปรเจกต์ใหม่ (เจอจริง 2026-10-01 รอบ 4)
 */
export function videoUuidFromUrl(src: string | null): string {
  const url = pickDirectVideoUrl([src]);
  if (url === null) return "";
  const m = /^\/video\/([^/]+)/.exec(new URL(url).pathname);
  // ไฟล์ 1080p ใช้ id เดิมต่อท้าย _upsampled (สอดแนม 2026-10-01) — ตัดทิ้งให้เทียบกับ id ที่เก็บไว้ได้
  return m ? m[1].replace(/_upsampled$/, "") : "";
}

/**
 * เหตุผลที่ขั้นหลัง Render พังก่อนเริ่มโหลด → ข้อความใน downloadFailed (ไม่ทำให้งาน failed — สิ่งที่เขียนลง DB หลัง Render
 * ตัดสินที่ previewReady ใน lib/flow-lifecycle.ts)
 */
export function postRenderFailReason(step: string, reason: string): string {
  return `${step} พังก่อนเริ่มโหลด: ${reason}`;
}

/**
 * รอบ 4: ช่องของคลิปจากข้อมูลที่ไม่ต้องเปิดเมนู — id จาก thumbnail ตรง → ช่องนั้น · ช่องที่หาเจอแล้วในรอบนี้ (foundTiles)
 * · ไม่งั้น null = ต้องเปิดเมนูส่อง id ทุกช่อง **รวมโปรเจกต์ที่มีช่องเดียว** (ห้ามเดาว่าเป็นช่อง 0 — อาจเป็นคลิปอื่น)
 */
export function knownTileIndex(thumbIds: string[], mediaId: string, cached: number | undefined): number | null {
  if (mediaId === "") return null;
  const byThumb = thumbIds.indexOf(mediaId);
  if (byThumb >= 0) return byThumb;
  if (cached !== undefined && cached >= 0 && cached < thumbIds.length) return cached;
  return null;
}

/** URL ไฟล์ที่หน้าเว็บขอ (720p ที่ส่อง หรือ 1080p `_upsampled`) เป็นของคลิป mediaId จริงไหม — ไม่ใช่/อ่านไม่ออก = false */
export function fileUrlIsMedia(url: string | null, mediaId: string): boolean {
  if (mediaId === "") return false;
  return videoUuidFromUrl(url) === mediaId;
}
