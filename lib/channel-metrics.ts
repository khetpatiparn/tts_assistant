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

export function parseOverviewCsv(text: string, importedAt: Date): OverviewParseResult {
  // ไฟล์จาก TikTok Studio มี BOM นำหน้า ถ้าไม่ตัด ชื่อคอลัมน์แรกจะเพี้ยนและ parse ผิด
  const allRows = parseCsvRows(text.replace(/^﻿/, ""));
  if (allRows.length < 2) return { rows: [], skipped: 0 };

  if (!hasOverviewHeader(allRows[0])) {
    throw new Error("อ่านไฟล์ไม่สำเร็จ — ต้องเป็นไฟล์ Overview (.csv) จาก TikTok Studio");
  }

  const rows: ChannelMetricInput[] = [];
  let skipped = 0;

  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    const statsOn = parseMonthDayLabel(String(r[COL.date] ?? ""), importedAt);
    if (!statsOn) {
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

    rows.push({
      statsOn,
      videoViews,
      profileViews: num(r[COL.profileViews]) ?? 0,
      likes: num(r[COL.likes]) ?? 0,
      comments: num(r[COL.comments]) ?? 0,
      shares: num(r[COL.shares]) ?? 0,
    });
  }

  return { rows, skipped };
}
