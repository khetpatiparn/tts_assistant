import { parseCsvRows, parseMonthDayLabel } from "@/lib/csv";

export type FollowerActivityInput = {
  activityOn: Date;
  hour: number;
  active: number;
};

// ตำแหน่งคอลัมน์ (0-based) ใน FollowerActivity.csv ของ TikTok Studio
const COL = { date: 0, hour: 1, active: 2 } as const;

function num(v: unknown): number {
  const n = parseInt(String(v ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ชั่วโมงในไฟล์นี้เป็นเวลาไทยอยู่แล้ว (TikTok Studio export ตามโซนเวลาบัญชี)
 * → เก็บเลขดิบ ห้ามแปลง timezone ซ้ำ ไม่งั้นกราฟจะเหลื่อมจากเวลาโพสต์ 7 ชั่วโมง
 */
export function parseFollowerActivityCsv(
  text: string,
  importedAt: Date
): FollowerActivityInput[] {
  const rows = parseCsvRows(text.replace(/^﻿/, ""));
  if (rows.length < 2) return [];

  const out: FollowerActivityInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const activityOn = parseMonthDayLabel(String(r[COL.date] ?? ""), importedAt);
    if (!activityOn) continue;
    const hour = num(r[COL.hour]);
    if (hour < 0 || hour > 23) continue;
    out.push({ activityOn, hour, active: num(r[COL.active]) });
  }
  return out;
}
