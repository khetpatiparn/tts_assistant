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
  /** เปิดบอท — detail เก็บค่าจังหวะที่ใช้ตอนนั้น */
  "session_start",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

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
