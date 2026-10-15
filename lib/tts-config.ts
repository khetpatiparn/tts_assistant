/**
 * คอนฟิกและค่าเริ่มต้นของระบบเสียง TTS (ฝั่ง Client & Server ใช้งานร่วมกันได้ ปลอดภัย ไม่มี node:fs)
 */
import { DEFAULT_POSTS_PER_DAY } from "@/lib/clip-export";

export type SystemSettings = {
  postsPerDay: number;
  autoGenerateTts: boolean;
  autoMergeVideo: boolean;
  targetDurationSec: number;
  defaultVoice: string;
  defaultStyle: string;
};

export const DEFAULT_SETTINGS: SystemSettings = {
  postsPerDay: DEFAULT_POSTS_PER_DAY,
  autoGenerateTts: true,
  autoMergeVideo: true,
  targetDurationSec: 9.6,
  defaultVoice: "Tavi",
  defaultStyle: "high energy , medium rapid fire, elongated vowels",
};
