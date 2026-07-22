import { videoIdFromUrl } from "@/lib/affiliate";
import { parseCsvRows, parseMonthDayLabel } from "@/lib/csv";

export type ClipMetricInput = {
  videoId: string;
  title: string;
  postedDate: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  capturedOn: Date;
};

// ตำแหน่งคอลัมน์ (0-based) ในไฟล์ Content.csv ของ TikTok Studio
const COL = {
  time: 0,
  title: 1,
  link: 2,
  postTime: 3,
  likes: 4,
  comments: 5,
  shares: 6,
  views: 7,
} as const;

function num(v: unknown): number {
  const n = parseInt(String(v ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseContentCsv(text: string, importedAt: Date): ClipMetricInput[] {
  // ไฟล์จาก TikTok Studio มี BOM นำหน้า ถ้าไม่ตัด ชื่อคอลัมน์แรกจะเพี้ยนและ parse ผิด
  const rows = parseCsvRows(text.replace(/^﻿/, ""));
  if (rows.length < 2) return [];

  const out: ClipMetricInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const videoId = videoIdFromUrl(String(r[COL.link] ?? ""));
    if (!videoId) continue;
    const capturedOn = parseMonthDayLabel(String(r[COL.time] ?? ""), importedAt);
    if (!capturedOn) continue;

    out.push({
      videoId,
      title: String(r[COL.title] ?? "").trim(),
      postedDate: String(r[COL.postTime] ?? "").trim(),
      views: num(r[COL.views]),
      likes: num(r[COL.likes]),
      comments: num(r[COL.comments]),
      shares: num(r[COL.shares]),
      capturedOn,
    });
  }
  return out;
}
