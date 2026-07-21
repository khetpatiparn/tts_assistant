import { videoIdFromUrl } from "@/lib/affiliate";

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

const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

/**
 * ไฟล์ครอบทุก field ด้วย double quote และ caption มี comma อยู่ข้างใน — split(",") เฉยๆ จะพัง
 * เขียน parser เองแทนการลง dependency ใหม่ (โปรเจกต์มี xlsx อยู่แล้วแต่ไฟล์นี้เป็น CSV)
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/**
 * คอลัมน์ Time เป็น "July 21" ไม่มีปี — เดาปีจากวันที่ import
 * ถ้าวันที่ที่ได้ล้ำอนาคตเกิน 1 วันจากวันที่ import แปลว่าเป็นปีก่อน (เช่น import ต้นมกราแต่ไฟล์ลงเดือนธันวา)
 */
function parseAsOfDate(label: string, importedAt: Date): Date | null {
  const m = label.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (month === undefined) return null;
  const day = Number(m[2]);

  let year = importedAt.getFullYear();
  let d = new Date(Date.UTC(year, month, day));
  if (d.getTime() - importedAt.getTime() > 24 * 60 * 60 * 1000) {
    year -= 1;
    d = new Date(Date.UTC(year, month, day));
  }
  return d;
}

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
    const capturedOn = parseAsOfDate(String(r[COL.time] ?? ""), importedAt);
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
