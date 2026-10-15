import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type VideoMergeResult = {
  success: boolean;
  outputPath: string;
};

/**
 * รวมไฟล์วิดีโอกับไฟล์เสียงพากย์ด้วย FFmpeg
 * - ลบเสียงดั้งเดิมของวิดีโอออกทั้งหมด (-map 0:v:0)
 * - ฝังเสียงพากย์ใหม่เข้าไปแทน (-map 1:a:0 -c:a aac -b:a 192k)
 * - คัดลอกสตรีมวิดีโอตรงๆ โดยไม่ encode ซ้ำ (-c:v copy) ใช้เวลาไม่ถึง 1 วินาที และไม่สูญเสียความคมชัด
 * - ตัดจบเมื่อสตรีมที่สั้นกว่าจบ (-shortest)
 */
export async function mergeVideoWithAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<VideoMergeResult> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-shortest",
    outputPath,
  ]);

  return {
    success: true,
    outputPath,
  };
}
