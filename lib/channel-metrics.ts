import { parseCsvRows, parseMonthDayLabel } from "@/lib/csv";

export type ChannelMetricInput = {
  statsOn: Date;
  videoViews: number;
  profileViews: number;
  likes: number;
  comments: number;
  shares: number;
};

export type OverviewParseResult = {
  rows: ChannelMetricInput[];
  /** แถวข้อมูลที่อ่านไม่ได้ (วันที่เพี้ยน หรือวิวไม่ใช่ตัวเลข) — รายงานต่อให้ผู้ใช้เห็น */
  skipped: number;
};

// ตำแหน่งคอลัมน์ (0-based) ใน Overview.csv ของ TikTok Studio
const COL = {
  date: 0,
  videoViews: 1,
  profileViews: 2,
  likes: 3,
  comments: 4,
  shares: 5,
} as const;

/**
 * แปลงตัวเลขจากไฟล์ — คืน null เมื่ออ่านไม่ออก
 *
 * ต่างจาก num() ใน lib/clip-metrics.ts ที่คืน 0 เพราะไฟล์นี้ต้องแยกให้ออกระหว่าง
 * "ศูนย์จริง" กับ "ไม่มีข้อมูล" (ไฟล์ export ของ TikTok ใส่คำว่า "undefined" มาในวัน
 * ที่ยังไม่มีข้อมูล) และใช้ Number() แทน parseInt() เพราะ parseInt("12abc") = 12
 * ซึ่งกลืนข้อมูลเสียเข้ามาเงียบๆ
 *
 * ต้องรองรับค่าติดลบ: คอลัมน์ Comments เป็นลบได้เมื่อคอมเมนต์ถูกลบ (พบจริง "June 20" = -6)
 */
function num(v: unknown): number | null {
  const s = String(v ?? "")
    .replace(/,/g, "")
    .trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Viewers.csv / FollowerHistory.csv / FollowerActivity.csv บังเอิญผ่านเงื่อนไข
 * "คอลัมน์ 0 เป็นวันที่ + คอลัมน์ 1 เป็นตัวเลข" เหมือนกันหมด (อยู่โฟลเดอร์เดียวกัน
 * เลือกผิดไฟล์ได้ง่าย) ถ้าไม่เช็กหัวตาราง parser จะรับไฟล์ผิดแบบเงียบๆ แล้ว upsert
 * ค่าขยะทับข้อมูลเดิมถาวร — Overview.csv ม้วน 28 วันเท่านั้น กู้คืนไม่ได้ถ้าพัง
 *
 * เช็กว่า "Video Views" ปรากฏที่ไหนก็ได้ในหัวตาราง (ไม่ผูกกับตำแหน่งคอลัมน์เป๊ะๆ)
 * เพื่อทนต่อกรณี TikTok สลับลำดับคอลัมน์ในอนาคต
 */
function hasOverviewHeader(headerRow: unknown[]): boolean {
  return headerRow.some((cell) => String(cell ?? "").trim() === "Video Views");
}

/** แถวที่อ่านค่าได้แล้วแต่ยังไม่ได้ตัดสินปี — `guess` ใช้ได้แค่เดือน/วัน ห้ามเชื่อปีของมัน */
type DraftRow = Omit<ChannelMetricInput, "statsOn"> & { guess: Date };

/**
 * ตัดสินปีของทุกแถวพร้อมกันจากลำดับของทั้งไฟล์ แทนการเดาทีละแถว
 *
 * `parseMonthDayLabel` เดาปีจากวันที่ import ทีละแถวแยกกัน ซึ่งถูกเฉพาะแถวที่ใกล้ปัจจุบัน
 * พอไฟล์ยาวครบปี (TikTok มีตัวเลือก "last 365 days") แถวเก่าสุดจะวนกลับมาชนเดือนเดียว
 * กับวันที่ import แล้วถูกเดาเป็นปีปัจจุบัน — **พบจริง**: ไฟล์ 365 วันที่ import วันที่
 * 3 ส.ค. 2026 ทำให้แถว "August 2/3/4" ซึ่งเป็นข้อมูลปี 2025 กลายเป็นปี 2026 ทั้งสามแถว
 * (ยัดวันอนาคตเข้าฐานข้อมูล แล้ว `buildChannelReach` ไปยึดมันเป็น "ข้อมูลล่าสุด"
 * ทำให้หน้าต่าง 30 วันเลื่อนผิด)
 *
 * วิธีแก้: ไฟล์เรียงจากเก่าไปใหม่เสมอ จึงนับจุดที่เดือน/วันย้อนกลับ (ธ.ค. -> ม.ค.) เป็น
 * การข้ามปี 1 ครั้ง แล้วยึด**แถวสุดท้าย** เป็นหลักในการไล่ปีย้อนกลับ เพราะแถวสุดท้ายคือ
 * แถวที่ใหม่ที่สุดและอยู่ใกล้วันที่ import ที่สุด ซึ่งเป็นกรณีเดียวที่การเดาทีละแถวเชื่อถือได้
 *
 * ข้อจำกัดที่ยอมรับ: ถ้าไฟล์ยาวเกิน 1 ปีจะมีเดือน/วันซ้ำกันจริงๆ และ `statsOn` เป็น unique
 * แถวที่ซ้ำจะทับกันเอง — ตอนนี้ TikTok ให้สูงสุด 365 วันจึงยังไม่เกิด
 */
function resolveYears(drafts: DraftRow[]): ChannelMetricInput[] {
  if (drafts.length === 0) return [];

  // ออฟเซ็ตปีเทียบกับแถวแรก: +1 ทุกครั้งที่วันที่ย้อนกลับ = ข้ามปีใหม่
  const yearOffsets: number[] = [0];
  for (let i = 1; i < drafts.length; i++) {
    const prev = drafts[i - 1].guess;
    const cur = drafts[i].guess;
    const wrapped =
      cur.getUTCMonth() < prev.getUTCMonth() ||
      (cur.getUTCMonth() === prev.getUTCMonth() && cur.getUTCDate() < prev.getUTCDate());
    yearOffsets.push(yearOffsets[i - 1] + (wrapped ? 1 : 0));
  }

  const last = drafts.length - 1;
  const baseYear = drafts[last].guess.getUTCFullYear() - yearOffsets[last];

  return drafts.map(({ guess, ...rest }, i) => ({
    ...rest,
    statsOn: new Date(Date.UTC(baseYear + yearOffsets[i], guess.getUTCMonth(), guess.getUTCDate())),
  }));
}

export function parseOverviewCsv(text: string, importedAt: Date): OverviewParseResult {
  // ไฟล์จาก TikTok Studio มี BOM นำหน้า ถ้าไม่ตัด ชื่อคอลัมน์แรกจะเพี้ยนและ parse ผิด
  const allRows = parseCsvRows(text.replace(/^﻿/, ""));
  if (allRows.length < 2) return { rows: [], skipped: 0 };

  if (!hasOverviewHeader(allRows[0])) {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Overview (.csv) จาก TikTok Studio");
  }

  // เก็บเป็นร่างก่อน เพราะการตัดสินปีต้องเห็นลำดับของทั้งไฟล์ (ดู resolveYears)
  const drafts: DraftRow[] = [];
  let skipped = 0;

  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    const guess = parseMonthDayLabel(String(r[COL.date] ?? ""), importedAt);
    if (!guess) {
      skipped++;
      continue;
    }

    // วิววิดีโอเป็นตัวหารของ conversion — ถ้าอ่านไม่ออกต้องข้ามทั้งแถว ห้ามบันทึกเป็น 0
    // เพราะจะกลายเป็นวัน "มีออเดอร์แต่วิวศูนย์" ปลอมๆ แล้วลาก conversion ให้เพี้ยน
    const videoViews = num(r[COL.videoViews]);
    if (videoViews === null) {
      skipped++;
      continue;
    }

    drafts.push({
      guess,
      videoViews,
      profileViews: num(r[COL.profileViews]) ?? 0,
      likes: num(r[COL.likes]) ?? 0,
      comments: num(r[COL.comments]) ?? 0,
      shares: num(r[COL.shares]) ?? 0,
    });
  }

  return { rows: resolveYears(drafts), skipped };
}
