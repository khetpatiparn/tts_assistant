import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type TtsVoiceConfig = {
  voice?: string;
  style?: string;
  maxDurationSec?: number;
};

export type TtsSynthesisResult = {
  audioBuffer: Buffer;
  rawDurationSec: number;
  finalDurationSec: number;
  trimmedDurationSec: number;
  tempoApplied: number;
};

/**
 * สร้างไฟล์เสียง TTS ผ่าน Gemini 3.8 Flash TTS และตัดต่ออัตโนมัติด้วย FFmpeg
 * - ตัด Dead Air / ช่วงเงียบระหว่างประโยค (Silence Removal)
 * - หากความยาวหลังตัดเงียบยังเกิน maxDurationSec จะคำนวณและเร่งความเร็วด้วย atempo
 *   โดยที่ระดับคีย์เสียง (Pitch) ไม่เปลี่ยน
 */
export async function synthesizeSpeech(
  text: string,
  config: TtsVoiceConfig = {}
): Promise<TtsSynthesisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("ไม่พบ GEMINI_API_KEY ในระบบ");
  }

  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error("ข้อความสำหรับสร้างเสียงพากย์ว่างเปล่า");
  }

  const voice = config.voice ?? "Tavi";
  const style =
    config.style ?? "high energy , medium rapid fire, elongated vowels";
  const maxDurationSec = config.maxDurationSec ?? 10.0;

  // 1. เรียก Gemini 3.8 Flash TTS
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash-tts",
        input: [
          {
            type: "user_input",
            content: [
              {
                type: "text",
                text: cleanText,
                annotations: [
                  {
                    type: "speech_metadata",
                    style,
                  },
                ],
              },
            ],
          },
        ],
        response_format: {
          type: "audio",
          mime_type: "audio/wav",
          sample_rate: 24000,
        },
        generation_config: {
          speech_config: [{ voice }],
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini TTS API ล้มเหลว (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawBase64 =
    data.steps?.[0]?.output?.[0]?.data ?? data.steps?.[0]?.content?.[0]?.data;

  if (!rawBase64) {
    throw new Error("ไม่พบข้อมูลเสียงในผลลัพธ์ของ Gemini TTS");
  }

  const rawWavBuffer = Buffer.from(rawBase64, "base64");

  // สร้างไฟล์ชั่วคราวสำหรับ FFmpeg
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "angle-tts-"));
  const rawPath = path.join(tmpDir, "raw.wav");
  const trimmedPath = path.join(tmpDir, "trimmed.wav");
  const finalPath = path.join(tmpDir, "final.wav");

  try {
    await fs.writeFile(rawPath, rawWavBuffer);

    // 2. วัดความยาวดิบ
    const { stdout: rawDurStr } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      rawPath,
    ]);
    const rawDurationSec = parseFloat(rawDurStr) || 0;

    // 3. ตัดช่วงคลื่นเสียงเงียบ (Silence Removal)
    // start_periods=1: ตัดความเงียบหัวคลิป (>0.08s, <-35dB)
    // stop_periods=-1: ตัดช่วงเงียบตลอดทั้งคลิปและท้ายคลิป (>0.15s, <-35dB)
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      rawPath,
      "-af",
      "silenceremove=start_periods=1:start_duration=0.08:start_threshold=-35dB:stop_periods=-1:stop_duration=0.15:stop_threshold=-35dB",
      trimmedPath,
    ]);

    // 4. วัดความยาวหลังตัดเงียบ
    const { stdout: trimDurStr } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      trimmedPath,
    ]);
    const trimmedDurationSec = parseFloat(trimDurStr) || 0;

    let tempoApplied = 1.0;

    // 5. หากเกิน maxDurationSec ให้บีบจังหวะด้วย atempo ให้ทันเวลา
    if (trimmedDurationSec > maxDurationSec) {
      // ตั้งเป้าให้ความยาวอยู่ที่ 9.6 วินาที เพื่อให้มีช่องว่างปลอดภัยในคลิป 10 วินาที
      const targetSec = Math.min(maxDurationSec - 0.4, 9.6);
      tempoApplied = parseFloat((trimmedDurationSec / targetSec).toFixed(3));
      // atempo รองรับ 0.5 ถึง 2.0
      const safeTempo = Math.max(0.5, Math.min(2.0, tempoApplied));

      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        trimmedPath,
        "-af",
        `atempo=${safeTempo}`,
        finalPath,
      ]);
    } else {
      await fs.copyFile(trimmedPath, finalPath);
    }

    // 6. วัดความยาวสุดท้าย
    const { stdout: finalDurStr } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      finalPath,
    ]);
    const finalDurationSec = parseFloat(finalDurStr) || 0;
    const finalBuffer = await fs.readFile(finalPath);

    return {
      audioBuffer: finalBuffer,
      rawDurationSec,
      trimmedDurationSec,
      finalDurationSec,
      tempoApplied,
    };
  } finally {
    // ล้างไฟล์ชั่วคราว
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
