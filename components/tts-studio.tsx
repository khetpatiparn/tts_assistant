"use client";

import { useState } from "react";
import { Clock, Download, Loader2, Mic, Scissors, Volume2, Zap } from "lucide-react";

import { generateStandaloneTts } from "@/app/actions";
import { playCompletionSound } from "@/lib/completion-sound";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const VOICES = [
  { id: "Tavi", label: "Tavi (แนะนำ)", desc: "หญิง · โทนกลาง-สูง · กระชับ ฉับไว ขายของ TikTok" },
  { id: "Aoede", label: "Aoede", desc: "หญิง · นุ่มนวล ชวนฟัง" },
  { id: "Zephyr", label: "Zephyr", desc: "หญิง · คล่องแคล่ว ทันสมัย" },
  { id: "Kore", label: "Kore", desc: "หญิง · สบายๆ ผ่อนคลาย" },
  { id: "Puck", label: "Puck", desc: "ชาย · สดใส มีชีวิตชีวา" },
  { id: "Charon", label: "Charon", desc: "ชาย · สุภาพ ทุ้มนุ่มลึก" },
  { id: "Fenrir", label: "Fenrir", desc: "ชาย · หนักแน่น จริงจัง" },
];

export function TtsStudio() {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("Tavi");
  const [style, setStyle] = useState("high energy , medium rapid fire, elongated vowels");
  const [maxDurationSec, setMaxDurationSec] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resultAudio, setResultAudio] = useState<{
    url: string;
    durationSec: number;
    rawDurationSec?: number;
    trimmedDurationSec?: number;
    tempoApplied?: number;
    timestamp: number;
  } | null>(null);

  // คำนวณเวลาโดยประมาณสำหรับภาษาไทย (~10-12 ตัวอักษร/วินาที)
  const charCount = text.trim().length;
  const estimatedSec = (charCount / 11).toFixed(1);

  async function handleGenerate() {
    if (!text.trim()) {
      setError("กรุณากรอกข้อความบทพากย์ที่ต้องการ");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const res = await generateStandaloneTts(text, voice, style, maxDurationSec);
      if (!res.ok || !res.audioBase64) {
        setError(res.message ?? "สร้างเสียงไม่สำเร็จ");
        return;
      }

      const audioUrl = `data:audio/wav;base64,${res.audioBase64}`;
      setResultAudio({
        url: audioUrl,
        durationSec: res.durationSec ?? 10,
        rawDurationSec: res.rawDurationSec,
        trimmedDurationSec: res.trimmedDurationSec,
        tempoApplied: res.tempoApplied,
        timestamp: Date.now(),
      });

      playCompletionSound("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      playCompletionSound("error");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6">
      {/* ส่วนหัว */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-primary" />
          <h2 className="text-base font-bold text-foreground sm:text-lg">
            TTS Studio · สังเคราะห์เสียงพากย์ AI
          </h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
          สร้างเสียงพากย์ภาษาไทยแบบอิสระด้วยโมเดล Gemini 3.8 Flash TTS พร้อมระบบตัดช่วงเงียบอัตโนมัติ (Silence Removal)
          และบีบความยาวให้อยู่ใน 10 วินาทีพอดีสำหรับคลิป TikTok
        </p>
      </div>

      {/* ฟอร์มสร้างเสียง */}
      <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 sm:p-6">
        {/* ข้อความบทพากย์ */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-foreground">
              ข้อความบทพากย์ (ภาษาไทย)
            </label>
            <span className="text-xs text-muted-foreground">
              {charCount} ตัวอักษร · ประมาณ ~{estimatedSec} วินาที
            </span>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="พิมพ์หรือวางบทพากย์ที่ต้องการ เช่น: ใครที่มีปัญหาผมร่วงผมบาง ต้องลองขวดนี้เลย ตัวนี้ช่วยบำรุงลึกถึงรากผม ลดผมร่วงได้ชัดเจน กดสั่งได้เลยที่ตะกร้า!"
            rows={4}
            className="font-sans text-sm leading-[1.6em]"
          />
        </div>

        {/* ตัวเลือกเสียง & สไตล์ */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">เลือกเสียงผู้พากย์</label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="h-10 rounded-md border border-input bg-surface px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.desc})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">
              จำกัดความยาวสูงสุด (วินาที)
            </label>
            <Input
              type="number"
              min={3}
              max={60}
              step={0.5}
              value={maxDurationSec}
              onChange={(e) => setMaxDurationSec(parseFloat(e.target.value) || 10)}
              className="text-xs"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground">
            คำสั่งกำหนดสไตล์เสียง (Speech Style Metadata)
          </label>
          <Input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="e.g. high energy , medium rapid fire, elongated vowels"
            className="text-xs"
          />
        </div>

        {/* ปุ่มสร้างเสียง */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            type="button"
            size="lg"
            onClick={handleGenerate}
            disabled={isGenerating || !text.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isGenerating ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
            {isGenerating ? "กำลังสังเคราะห์เสียงด้วย Gemini TTS..." : "สังเคราะห์เสียงพากย์ (TTS)"}
          </Button>

          {charCount > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setText("")}
              disabled={isGenerating}
            >
              ล้างข้อความ
            </Button>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-500">
            {error}
          </p>
        )}
      </div>

      {/* ผลลัพธ์เสียงที่สร้าง */}
      {resultAudio && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Volume2 className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">ผลลัพธ์ไฟล์เสียง (.wav)</h3>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <Clock className="size-3.5" /> {resultAudio.durationSec.toFixed(1)} วินาที
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <audio controls src={resultAudio.url} className="h-10 w-full rounded-md" autoPlay />

            {/* ข้อมูลการตัดต่อ */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {resultAudio.rawDurationSec && resultAudio.rawDurationSec > resultAudio.durationSec && (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1">
                  <Scissors className="size-3.5 text-primary" /> ตัด Dead Air จาก {resultAudio.rawDurationSec.toFixed(1)}s เหลือ{" "}
                  {resultAudio.trimmedDurationSec?.toFixed(1) ?? resultAudio.durationSec.toFixed(1)}s
                </span>
              )}
              {resultAudio.tempoApplied && resultAudio.tempoApplied > 1.0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1">
                  <Zap className="size-3.5 text-primary" /> เร่งความเร็ว {resultAudio.tempoApplied.toFixed(2)}x (คงระดับคีย์เสียงเดิม) เพื่อให้อยู่ใน {maxDurationSec}s
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <a
                href={resultAudio.url}
                download={`tts-${voice}-${resultAudio.timestamp}.wav`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <Download data-icon="inline-start" /> ดาวน์โหลดไฟล์เสียง (.wav)
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
