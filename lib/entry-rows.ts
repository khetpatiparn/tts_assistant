/**
 * แถวเบาสำหรับหน้ารายการและแถบข้าง + ตรรกะกรอง/ค้นหา/แบ่งหน้า
 *
 * แยกจาก lib/entry-queries.ts โดยตั้งใจ: ไฟล์นี้ไม่แตะ Prisma เลยจึงคอมไพล์เดี่ยว
 * แล้วทดสอบด้วย node ได้ (โปรเจกต์ไม่มี test runner) ส่วนไฟล์นั้นเป็นตัวคิวรีล้วน
 */

import { matchTier, splitTerms, type SearchableEntry } from "@/lib/entry-search";

/** สถานะงานของ entry — ตรงกับที่ isIncomplete เดิมแยกไว้ แต่แตกเป็น 3 ค่าแทน boolean */
export type EntryStatus = "no-prompt" | "awaiting-clip" | "posted";

/**
 * ฟิลด์ที่หน้ารายการและแถบข้างใช้จริง
 *
 * ห้ามเพิ่ม chatgptOutput / productInfo / productSpec / riskModule / caption / hashtags
 * เข้ามาเด็ดขาด — สี่ตัวแรกกินรวมกัน ~11.4 KB จาก 12.4 KB ต่อแถว และเป็นสาเหตุที่
 * หน้าเดิมส่ง 23.5 MB ที่ 1,800 แถว (ดูสเปกหัวข้อ 1.2)
 */
export type EntryRow = {
  id: string;
  productName: string;
  angle: string;
  videoUrl: string;
  postedAt: Date | null;
  createdAt: Date;
  duplicatedFromId: string | null;
  status: EntryStatus;
  /** ชื่อไฟล์รูปแรก — URL เต็มประกอบเป็น /api/uploads/<id>/<thumbnailFilename> */
  thumbnailFilename: string | null;
  // สามตัวล่างนี้หน้ารายการกับแถบข้างไม่ได้ใช้ แต่ /dashboard ต้องใช้: DashboardPanel
  // รับ entries เป็น PostTimeEntry & ScoreboardEntry ซึ่งบังคับให้มีครบ เป็น scalar
  // เล็กๆ ทั้งสามตัวจึงรวมมาในแถวเบาได้โดยไม่กระทบเป้าหมายเรื่องขนาด
  postedTimeOfDay: string | null;
  postedTimeSource: string | null;
  isScheduledPost: boolean;
};

export const PER_PAGE = 30;

const STATUSES: EntryStatus[] = ["no-prompt", "awaiting-clip", "posted"];

/** ชั้นที่น่าเชื่อถือกว่าได้เลขน้อยกว่า เพื่อให้ sort ดันขึ้นบน */
const TIER_RANK = { name: 0, notes: 1, info: 2 } as const;

/**
 * มีคลิปแล้วถือว่าจบ ไม่ว่าจะมี prompt หรือไม่ — entry เก่าบางตัวลงคลิปไปโดยเขียน
 * prompt เองนอกแอป จึงมี videoUrl แต่ไม่มี chatgptOutput
 */
export function entryStatus(entry: { hasOutput: boolean; videoUrl: string }): EntryStatus {
  if (entry.videoUrl.trim() !== "") return "posted";
  return entry.hasOutput ? "awaiting-clip" : "no-prompt";
}

/**
 * กรองตามสถานะก่อน แล้วค่อยค้นหา — ลำดับนี้สำคัญเพราะการค้นหาเปลี่ยนลำดับแถว
 * ส่วนการกรองสถานะไม่เปลี่ยน
 *
 * ไม่มีคำค้น = คงลำดับที่ส่งเข้ามาทั้งหมด (ซึ่งคือลำดับจาก sortEntriesForRail)
 * มีคำค้น = ดันชั้นที่น่าเชื่อถือกว่าขึ้นบน แต่ภายในชั้นเดียวกันคงลำดับเดิม
 * (Array.prototype.sort เสถียรตามสเปก ES2019+ จึงพึ่งพฤติกรรมนี้ได้)
 */
export function searchAndFilter<T extends SearchableEntry & { status: EntryStatus }>(
  rows: T[],
  opts: { query: string; status: EntryStatus | "all" }
): T[] {
  const byStatus =
    opts.status === "all" ? rows : rows.filter((r) => r.status === opts.status);

  const terms = splitTerms(opts.query);
  if (terms.length === 0) return byStatus;

  const ranked: { row: T; rank: number }[] = [];
  for (const row of byStatus) {
    const tier = matchTier(row, terms);
    if (tier !== null) ranked.push({ row, rank: TIER_RANK[tier] });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.row);
}

/** หน้าที่เกินขอบถูกดึงกลับเข้าขอบเสมอ ไม่ throw — ผู้ใช้แก้ URL เองได้ */
export function paginate<T>(
  rows: T[],
  page: number
): { items: T[]; totalPages: number; page: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * PER_PAGE;
  return { items: rows.slice(start, start + PER_PAGE), totalPages, page: safePage };
}

function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseStatusParam(
  raw: string | string[] | undefined
): EntryStatus | "all" {
  const value = firstParam(raw);
  return STATUSES.find((s) => s === value) ?? "all";
}

export function parsePageParam(raw: string | string[] | undefined): number {
  const n = Number.parseInt(firstParam(raw) ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
