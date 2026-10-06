/**
 * สมุดบันทึกการกระทำของบอท Flow (pure — ไม่มี Prisma, client component import ได้)
 * เป้าหมาย: ถ้าบัญชีโดนจับ ตอบได้ว่า "ก่อนโดน ยิงกี่ครั้งใน 10 นาที / วันนั้น มีสัญญาณเตือนก่อนไหม" (spec 2026-09-30 §3)
 */
export const ACTIVITY_KINDS = [
  "generate_image",
  "generate_video",
  "upload",
  "new_project",
  "download",
  /** Google ตอบ 429/403/5xx โดยที่งานยังไม่พัง — สัญญาณเตือนล่วงหน้า */
  "http_warn",
  /** captcha / unusual activity / login หลุด — จุดที่โดนจริง */
  "bot_signal",
  /** พักจริง (ms อยู่ใน detail) */
  "break",
  /** บอทข้ามงานที่ Flow วาดไม่สำเร็จไปทำงานถัดไปโดยไม่หยุดคิว (detail: jobId/round/step/message) — ไม่ใช่คำขอถึง Flow */
  "auto_continue",
  /**
   * บอทข้ามงานที่เน็ตสะดุดตอนเปิด Flow (ลองซ้ำครบแล้ว) ไปทำงานถัดไปโดยไม่หยุดคิว (detail: jobId/round/step/message) — ยังไม่ได้ขออะไร
   * จาก Google · แยกจาก auto_continue: ไม่นับเพดาน autoContinueDailyCap · กฎของมันเอง = ไม่เกิน 2 แถวติดกันหลัง round_ok ล่าสุด
   */
  "network_skip",
  /** บอททำรอบสำเร็จ (รูปพร้อม/คลิปพร้อม/โหลด 1080p) — จุดอ้างอิงของกฎ "ห้ามข้ามติดกัน" ไม่ใช่คำขอถึง Flow */
  "round_ok",
  /** เปิดบอท — detail เก็บค่าจังหวะที่ใช้ตอนนั้น */
  "session_start",
  // การกระทำของ "ผู้ใช้" บนงาน Flow (ไม่ใช่คำขอของบอท — ไม่นับใน summarizeActivity) ใช้วิเคราะห์ว่าต้องวาด/เรนเดอร์กี่ครั้งกว่าจะผ่าน
  "user_enqueue",
  "user_choose",
  "user_redraw",
  "user_approve_render",
  "user_redo_render",
  "user_skip",
  "user_resume",
  /** ปุ่มเก่า "ทำคลิปเองแล้ว — ปิดงานนี้" (ก่อนมี user_take_over) — ยังอ่านเป็นทำต่อเองได้ */
  "user_finish_manual",
  /** "ทำต่อเอง": ผู้ใช้รับงานไปทำเองใน Flow (detail: { fromStatus, round, waitedMs }) — เป็นการเลือกของผู้ใช้ ไม่ใช่ตัวชี้ว่าบอทพลาด */
  "user_take_over",
  "user_prompt_now",
  "user_retry_upscale",
  /** ส่งคลิป+รูป+ข้อความเข้าโฟลเดอร์ TTS บนเครื่อง (detail.path) — ใช้กันส่งซ้ำ */
  "user_export_clip",
  /** แก้ 10-part prompt ที่หน้า /flow (detail: { stage, lengthBefore, lengthAfter, rerender }) — การกระทำของผู้ใช้ ไม่ใช่คำขอถึง Flow */
  "user_edit_prompt",
  /** เปลี่ยนรูปต้นทาง (หน้า /flow หรือ Showcase "เลือกรูปใหม่") — งานกลับไปวาดรอบ 1 (detail: { fromStatus, round, attempt, nextAttempt, … }) */
  "user_change_source",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** แถวนี้คือ "ทำต่อเอง" (รวมแถวเก่าของปุ่มปิดงานเอง) — ป้าย "ทำเอง" และรายงานพฤติกรรมอ่านจากแถวพวกนี้ */
export function isTakeoverKind(kind: string): boolean {
  return kind === "user_take_over" || kind === "user_finish_manual";
}

/** สิ่งที่ Google เห็นเป็น "คำขอ" จากเรา — ใช้นับความถี่ */
const REQUEST_KINDS: ReadonlySet<string> = new Set(["generate_image", "generate_video", "upload", "new_project", "download"]);
const WARN_KINDS: ReadonlySet<string> = new Set(["http_warn", "bot_signal"]);

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function summarizeActivity(
  rows: { at: Date; kind: string }[],
  now: Date
): { today: number; peakPer10Min: number; lastWarnAt: Date | null } {
  const requests = rows.filter((r) => REQUEST_KINDS.has(r.kind)).map((r) => r.at.getTime()).sort((x, y) => x - y);
  const today = rows.filter((r) => REQUEST_KINDS.has(r.kind) && sameLocalDay(r.at, now)).length;
  // หน้าต่างเลื่อน 10 นาที: สำหรับแต่ละคำขอ นับคำขอที่อยู่ภายใน 10 นาทีถัดจากมัน
  let peak = 0;
  for (let i = 0; i < requests.length; i++) {
    let j = i;
    while (j < requests.length && requests[j] - requests[i] < 10 * 60000) j++;
    peak = Math.max(peak, j - i);
  }
  const warns = rows.filter((r) => WARN_KINDS.has(r.kind)).map((r) => r.at.getTime());
  const lastWarnAt = warns.length === 0 ? null : new Date(Math.max(...warns));
  return { today, peakPer10Min: peak, lastWarnAt };
}
