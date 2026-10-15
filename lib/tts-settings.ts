/**
 * ค่าตั้งของระบบและโฟลเดอร์ TTS ที่ผู้ใช้ปรับได้โดยไม่ต้อง build ใหม่
 * เก็บเป็น JSON เล็กๆ ที่ root ของ repo (tts-settings.json, gitignore) ไม่ใช้ DB เพราะไม่ต้อง migrate และ
 * start.bat ไม่ build ใหม่เมื่อไฟล์นี้เปลี่ยน · ฝั่งเซิร์ฟเวอร์เท่านั้น (ใช้ node:fs)
 * ทดสอบใน scripts/check-clip-export-fs.mjs (ส่ง path ของไฟล์ชั่วคราวแทนไฟล์จริง)
 */
import { readFile, writeFile } from "node:fs/promises";
import { getRuntimePaths } from "@/lib/runtime-paths";
import { MAX_POSTS_PER_DAY, MIN_POSTS_PER_DAY, parsePostsPerDay } from "@/lib/clip-export";

// path คงที่ตัวเดียว (ไม่ต่อจากตัวแปร) + turbopackIgnore แบบเดียวกับ lib/upload-paths.ts — กัน Turbopack ลากไฟล์ใน cwd เข้า trace
export const TTS_SETTINGS_FILE = getRuntimePaths().settingsFile;

import { type SystemSettings, DEFAULT_SETTINGS } from "@/lib/tts-config";
export { type SystemSettings, DEFAULT_SETTINGS };

/** อ่านค่าการตั้งค่าระบบทั้งหมด — คืนค่าเริ่มต้นหากยังไม่มีไฟล์หรือไฟล์เสียหาย */
export async function readSystemSettings(file: string = TTS_SETTINGS_FILE): Promise<SystemSettings> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    return {
      postsPerDay: parsePostsPerDay(raw.postsPerDay) ?? DEFAULT_SETTINGS.postsPerDay,
      autoGenerateTts: typeof raw.autoGenerateTts === "boolean" ? raw.autoGenerateTts : DEFAULT_SETTINGS.autoGenerateTts,
      autoMergeVideo: typeof raw.autoMergeVideo === "boolean" ? raw.autoMergeVideo : DEFAULT_SETTINGS.autoMergeVideo,
      targetDurationSec: typeof raw.targetDurationSec === "number" && raw.targetDurationSec >= 3 && raw.targetDurationSec <= 30
        ? raw.targetDurationSec
        : DEFAULT_SETTINGS.targetDurationSec,
      defaultVoice: typeof raw.defaultVoice === "string" && raw.defaultVoice.trim() !== ""
        ? raw.defaultVoice.trim()
        : DEFAULT_SETTINGS.defaultVoice,
      defaultStyle: typeof raw.defaultStyle === "string" && raw.defaultStyle.trim() !== ""
        ? raw.defaultStyle.trim()
        : DEFAULT_SETTINGS.defaultStyle,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** บันทึก/อัปเดตค่าการตั้งค่าระบบบางส่วน */
export async function updateSystemSettings(
  partial: Partial<SystemSettings>,
  file: string = TTS_SETTINGS_FILE
): Promise<SystemSettings> {
  const current = await readSystemSettings(file);
  const next: SystemSettings = { ...current };

  if (typeof partial.autoGenerateTts === "boolean") {
    next.autoGenerateTts = partial.autoGenerateTts;
  }
  if (typeof partial.autoMergeVideo === "boolean") {
    next.autoMergeVideo = partial.autoMergeVideo;
  }
  if (partial.postsPerDay !== undefined) {
    const p = parsePostsPerDay(partial.postsPerDay);
    if (p !== null) next.postsPerDay = p;
  }
  if (partial.targetDurationSec !== undefined) {
    const d = Number(partial.targetDurationSec);
    if (!isNaN(d) && d >= 3 && d <= 30) next.targetDurationSec = d;
  }
  if (typeof partial.defaultVoice === "string" && partial.defaultVoice.trim() !== "") {
    next.defaultVoice = partial.defaultVoice.trim();
  }
  if (typeof partial.defaultStyle === "string" && partial.defaultStyle.trim() !== "") {
    next.defaultStyle = partial.defaultStyle.trim();
  }
  try {
    await writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  } catch {
    throw new Error("บันทึกค่าการตั้งค่าไม่สำเร็จ ลองอีกครั้ง");
  }
  return next;
}

/** โพสต์วันละกี่คลิป — ไม่มีไฟล์/ไฟล์เสีย/ค่าไม่อยู่ใน 1–20 = ค่าเริ่มต้น (4) */
export async function readPostsPerDay(file: string = TTS_SETTINGS_FILE): Promise<number> {
  const s = await readSystemSettings(file);
  return s.postsPerDay;
}

/** บันทึกโควต้าต่อวัน — ค่าที่ไม่ใช่จำนวนเต็ม 1–20 โยน error ไทย (ไม่แตะไฟล์) */
export async function writePostsPerDay(value: unknown, file: string = TTS_SETTINGS_FILE): Promise<number> {
  const n = parsePostsPerDay(value);
  if (n === null) throw new Error(`ตั้งได้ ${MIN_POSTS_PER_DAY}–${MAX_POSTS_PER_DAY} คลิปต่อวัน`);
  const updated = await updateSystemSettings({ postsPerDay: n }, file);
  return updated.postsPerDay;
}
