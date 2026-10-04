/**
 * ค่าตั้งของโฟลเดอร์ TTS ที่ผู้ใช้ปรับจากหน้า /flow โดยไม่ต้อง build ใหม่ — ตอนนี้มีอย่างเดียว: โพสต์วันละกี่คลิป
 * เก็บเป็น JSON เล็กๆ ที่ root ของ repo (tts-settings.json, gitignore) ไม่ใช้ DB เพราะไม่ต้อง migrate และ
 * start.bat ไม่ build ใหม่เมื่อไฟล์นี้เปลี่ยน · ฝั่งเซิร์ฟเวอร์เท่านั้น (ใช้ node:fs)
 * ทดสอบใน scripts/check-clip-export-fs.mjs (ส่ง path ของไฟล์ชั่วคราวแทนไฟล์จริง)
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_POSTS_PER_DAY, MAX_POSTS_PER_DAY, MIN_POSTS_PER_DAY, parsePostsPerDay } from "@/lib/clip-export";

// path คงที่ตัวเดียว (ไม่ต่อจากตัวแปร) + turbopackIgnore แบบเดียวกับ lib/upload-paths.ts — กัน Turbopack ลากไฟล์ใน cwd เข้า trace
export const TTS_SETTINGS_FILE = path.join(/* turbopackIgnore: true */ process.cwd(), "tts-settings.json");

/** โพสต์วันละกี่คลิป — ไม่มีไฟล์/ไฟล์เสีย/ค่าไม่อยู่ใน 1–20 = ค่าเริ่มต้น (4) */
export async function readPostsPerDay(file: string = TTS_SETTINGS_FILE): Promise<number> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { postsPerDay?: unknown };
    return parsePostsPerDay(raw.postsPerDay) ?? DEFAULT_POSTS_PER_DAY;
  } catch {
    return DEFAULT_POSTS_PER_DAY;
  }
}

/** บันทึกโควต้าต่อวัน — ค่าที่ไม่ใช่จำนวนเต็ม 1–20 โยน error ไทย (ไม่แตะไฟล์) */
export async function writePostsPerDay(value: unknown, file: string = TTS_SETTINGS_FILE): Promise<number> {
  const n = parsePostsPerDay(value);
  if (n === null) throw new Error(`ตั้งได้ ${MIN_POSTS_PER_DAY}–${MAX_POSTS_PER_DAY} คลิปต่อวัน`);
  try {
    await writeFile(file, JSON.stringify({ postsPerDay: n }) + "\n", "utf8");
  } catch {
    throw new Error("บันทึกค่าไม่สำเร็จ ลองอีกครั้ง");
  }
  return n;
}
