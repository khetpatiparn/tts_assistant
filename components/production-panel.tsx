"use client";

import { useActionState, useState } from "react";
import { Check, Clock, Copy, Download, ExternalLink, Loader2, Mic, RotateCcw, Sparkles, Volume2 } from "lucide-react";

import {
  generateVoiceover,
  mergeVideoAudio,
  unmergeVideoAudio,
  updateProduction,
} from "@/app/actions";
import { copyInBrowser } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClaimWarnings } from "@/components/claim-warnings";
import { DatePickerField } from "@/components/date-picker-field";
import type { PromptEntry } from "@/components/entry-workspace";
import type { EntryRenderVideo, EntryTtsAudio } from "@/lib/flow-queries";
import { videoDownloadName } from "@/lib/flow-jobs";
import { extractVoiceoverScript } from "@/lib/claim-check";
import { playCompletionSound } from "@/lib/completion-sound";

/** ป้ายของคลิปที่บอท Render — ผู้ใช้ต้องรู้ว่าไฟล์ที่เห็นเป็นตัวจริง 1080p หรือแค่ตัวอย่าง */
const RENDER_STAGE_LABEL: Record<EntryRenderVideo["stage"], string> = {
  final: "คลิปที่บอททำ · 1080p",
  approved: "ตัวอย่าง 720p (ผ่านแล้ว กำลังโหลด 1080p)",
  preview: "ตัวอย่าง 720p (ยังไม่กดผ่าน)",
};

function isSafeHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toDateInputValue(value: Date | null) {
  if (!value) return "";
  // Stored as UTC midnight, so read the UTC parts back out — using local
  // getters here would shift the date by a day in negative-offset timezones.
  return new Date(value).toISOString().slice(0, 10);
}

function toLocalDateInputValue(value: Date): string {
  // createdAt เป็น timestamp จริง (ไม่ใช่ UTC midnight แบบ postedAt) —
  // ต้องอ่านเป็นเวลาท้องถิ่น ไม่งั้น entry ที่สร้างก่อนตี 7 เวลาไทยจะได้วันที่เมื่อวาน
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ProductionPanel({
  entry,
  renderVideo = null,
  ttsAudio: initialTtsAudio = null,
}: {
  entry: PromptEntry;
  renderVideo?: EntryRenderVideo | null;
  ttsAudio?: EntryTtsAudio | null;
}) {
  // Keyed on entry.id by the parent, so this initial state is correct on switch.
  const [chatgptOutput, setChatgptOutput] = useState(entry.chatgptOutput);
  const [videoUrl, setVideoUrl] = useState(entry.videoUrl);
  const [postedAt, setPostedAt] = useState(toDateInputValue(entry.postedAt));
  const [caption, setCaption] = useState(entry.caption);
  const [hashtags, setHashtags] = useState(entry.hashtags);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const [video, setVideo] = useState<EntryRenderVideo | null>(renderVideo);
  const [videoKey, setVideoKey] = useState(0);
  const [ttsAudio, setTtsAudio] = useState<EntryTtsAudio | null>(initialTtsAudio);
  const [audioKey, setAudioKey] = useState(0);

  const [isGeneratingTts, setIsGeneratingTts] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);

  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const [isUnmerging, setIsUnmerging] = useState(false);

  const [prevRenderVideo, setPrevRenderVideo] = useState(renderVideo);
  if (renderVideo !== prevRenderVideo) {
    setPrevRenderVideo(renderVideo);
    setVideo(renderVideo);
  }

  const [prevInitialTts, setPrevInitialTts] = useState(initialTtsAudio);
  if (initialTtsAudio !== prevInitialTts) {
    setPrevInitialTts(initialTtsAudio);
    setTtsAudio(initialTtsAudio);
  }

  const scriptText = extractVoiceoverScript(chatgptOutput).trim() || entry.productName;

  async function handleGenerateTts() {
    setIsGeneratingTts(true);
    setTtsError(null);
    try {
      const res = await generateVoiceover(entry.id);
      if (!res.ok) {
        setTtsError(res.message ?? "สร้างเสียงไม่สำเร็จ");
        return;
      }
      setTtsAudio({
        path: `${entry.id}/flow/tts-audio.wav`,
        durationSec: res.durationSec ?? 10,
      });
      setAudioKey(Date.now());
      playCompletionSound("success");
    } catch (err) {
      setTtsError(err instanceof Error ? err.message : String(err));
      playCompletionSound("error");
    } finally {
      setIsGeneratingTts(false);
    }
  }

  async function handleMerge() {
    setIsMerging(true);
    setMergeError(null);
    try {
      const res = await mergeVideoAudio(entry.id);
      if (!res.ok) {
        setMergeError(res.message ?? "รวมคลิปไม่สำเร็จ");
        playCompletionSound("error");
        return;
      }
      if (video) {
        setVideo({
          ...video,
          path: `${entry.id}/flow/r3-merged.mp4`,
          isMerged: true,
        });
        setVideoKey(Date.now());
        playCompletionSound("success");
      }
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
      playCompletionSound("error");
    } finally {
      setIsMerging(false);
    }
  }

  async function handleUnmerge() {
    setIsUnmerging(true);
    setMergeError(null);
    try {
      const res = await unmergeVideoAudio(entry.id);
      if (!res.ok) {
        setMergeError(res.message ?? "คืนคลิปเดิมไม่สำเร็จ");
        return;
      }
      if (video) {
        setVideo({
          ...video,
          path: video.originalPath ?? video.path,
          isMerged: false,
        });
        setVideoKey(Date.now());
      }
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUnmerging(false);
    }
  }

  // "สร้างด้วย AI" rewrites this entry's output on the server. The id does not
  // change, so nothing remounts — without this the textarea would keep showing
  // whatever it held at mount and the generated prompt would look lost.
  const [lastServer, setLastServer] = useState({
    chatgptOutput: entry.chatgptOutput,
    caption: entry.caption,
    hashtags: entry.hashtags,
  });
  if (
    entry.chatgptOutput !== lastServer.chatgptOutput ||
    entry.caption !== lastServer.caption ||
    entry.hashtags !== lastServer.hashtags
  ) {
    setLastServer({
      chatgptOutput: entry.chatgptOutput,
      caption: entry.caption,
      hashtags: entry.hashtags,
    });
    setChatgptOutput(entry.chatgptOutput);
    setCaption(entry.caption);
    setHashtags(entry.hashtags);
  }

  async function copyForPost() {
    // ผู้ใช้โพสต์แบบ caption แล้วขึ้นบรรทัดใหม่ตบด้วย hashtag — คัดลอกให้ตรงแบบนั้นเลย
    const outcome = await copyInBrowser(`${caption}\n${hashtags}`.trim());
    if (outcome === "manual") {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 6000);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copyPrompt() {
    const outcome = await copyInBrowser(chatgptOutput);
    if (outcome === "manual") {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 6000);
      return;
    }
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1500);
  }

  const [state, action, isSaving] = useActionState(
    async (_prev: { ok: boolean } | null, formData: FormData) => {
      await updateProduction(formData);
      return { ok: true };
    },
    null
  );

  return (
    <section className="flex flex-1 flex-col gap-5 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="h-4 w-1 rounded-full bg-primary" />
        <h2 className="text-xs text-primary">
          Production · ผลลัพธ์ &amp; คลิป
        </h2>
      </div>

      {copyFailed && (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
          เบราว์เซอร์นี้คัดลอกให้อัตโนมัติไม่ได้ (เปิดผ่าน HTTP) — กดค้างที่กล่องข้อความแล้วเลือก
          &quot;เลือกทั้งหมด&quot; เพื่อคัดลอกเอง
        </p>
      )}

      {/* คลิปจากบอท Flow — รวมเสียงพากย์ / คืนคลิปเดิม */}
      {video && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
          <div className="flex flex-wrap items-start gap-4">
            <video
              key={`${video.path}-${videoKey}`}
              src={`/api/uploads/${video.path}`}
              controls
              preload="metadata"
              className="aspect-[9/16] w-32 rounded-md border border-border bg-surface lg:w-40"
            />
            <div className="flex flex-1 flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium leading-relaxed text-foreground">{RENDER_STAGE_LABEL[video.stage]}</p>
                {video.isMerged ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <Volume2 className="size-3.5" /> รวมเสียงพากย์แล้ว
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">เสียงเดิมจาก Flow</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <a
                  href={`/api/uploads/${video.path}`}
                  download={videoDownloadName(entry.productName)}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  <Download data-icon="inline-start" /> ดาวน์โหลดคลิป
                </a>

                {/* ปุ่มรวมคลิป / คืนคลิปเดิม */}
                {video.isMerged ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleUnmerge}
                    disabled={isUnmerging || isMerging}
                  >
                    {isUnmerging ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                    {isUnmerging ? "กำลังคืนคลิปเดิม..." : "คืนคลิปเดิม (ลบเสียงพากย์)"}
                  </Button>
                ) : ttsAudio ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleMerge}
                    disabled={isMerging || isUnmerging}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {isMerging ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    {isMerging ? "กำลังรวมคลิปด้วย FFmpeg..." : "รวมคลิป (ใส่เสียงพากย์แทนเสียงเดิม)"}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground self-center">
                    (สร้างเสียงพากย์ด้านล่างก่อนเพื่อรวมคลิป)
                  </span>
                )}
              </div>

              {mergeError && (
                <p className="text-xs text-red-500">{mergeError}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* แผงเสียงพากย์ TTS (Gemini 3.8 Flash TTS + FFmpeg Silence Removal) */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Mic className="size-4 text-primary" />
            <span className="text-sm font-medium text-foreground">เสียงพากย์ AI (Gemini 3.8 Flash TTS)</span>
            <span className="text-xs text-muted-foreground">เสียง Tavi · ตัดต่อไม่เกิน 10 วินาที</span>
          </div>
          {ttsAudio && (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Clock className="size-3" /> {ttsAudio.durationSec.toFixed(1)} วิ
              {ttsAudio.rawDurationSec && ttsAudio.rawDurationSec > ttsAudio.durationSec && (
                <span className="text-muted-foreground font-normal">
                  (ตัดช่วงเงียบจาก {ttsAudio.rawDurationSec.toFixed(1)}s)
                </span>
              )}
            </span>
          )}
        </div>

        {ttsAudio ? (
          <div className="flex flex-col gap-2.5">
            <audio
              key={`${ttsAudio.path}-${audioKey}`}
              controls
              src={`/api/uploads/${ttsAudio.path}?t=${audioKey}`}
              className="h-10 w-full rounded-md"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateTts}
                  disabled={isGeneratingTts}
                >
                  {isGeneratingTts ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
                  {isGeneratingTts ? "กำลังสังเคราะห์เสียง..." : "สร้างเสียงใหม่"}
                </Button>
                <a
                  href={`/api/uploads/${ttsAudio.path}`}
                  download={`${entry.productName}-เสียงพากย์.wav`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  <Download data-icon="inline-start" /> ดาวน์โหลด .wav
                </a>
              </div>
              <span className="text-xs text-muted-foreground">
                พร้อมส่งเข้าโฟลเดอร์ TTS อัตโนมัติเมื่อกดส่งงาน
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 py-1">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {scriptText ? `ข้อความที่จะพากย์: "${scriptText.slice(0, 100)}${scriptText.length > 100 ? "..." : ""}"` : "ยังไม่มี 10-part prompt สำหรับสังเคราะห์เสียง"}
            </p>
            <div>
              <Button
                type="button"
                size="sm"
                onClick={handleGenerateTts}
                disabled={isGeneratingTts}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isGeneratingTts ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
                {isGeneratingTts ? "กำลังสังเคราะห์เสียงด้วย Gemini TTS..." : "สร้างเสียงพากย์ด้วย AI (10 วิ)"}
              </Button>
            </div>
          </div>
        )}

        {ttsError && (
          <p className="text-xs text-red-500">{ttsError}</p>
        )}
      </div>

      <form action={action} className="flex flex-1 flex-col gap-5">
        <input type="hidden" name="id" value={entry.id} />

        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-foreground/90">
              10-part prompt ที่ ChatGPT ตอบกลับ
            </label>
            <Button
              type="button"
              size="sm"
              onClick={copyPrompt}
              disabled={!chatgptOutput}
              variant="outline"
            >
              {promptCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {promptCopied ? "คัดลอกแล้ว" : "คัดลอก"}
            </Button>
          </div>
          <Textarea
            name="chatgptOutput"
            value={chatgptOutput}
            onChange={(e) => setChatgptOutput(e.target.value)}
            placeholder="วาง 10-part prompt ที่ได้จาก ChatGPT ที่นี่"
            className="min-h-80 max-h-[60dvh] flex-1 font-sans text-sm leading-[1.6em] sm:max-h-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-foreground/90">
              Caption &amp; Hashtags
            </label>
            <Button type="button" size="sm" variant="outline" onClick={copyForPost} disabled={!caption && !hashtags}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกทั้งหมด"}
            </Button>
          </div>
          <ClaimWarnings tenPart={chatgptOutput} caption={caption} hashtags={hashtags} />
          <Textarea
            name="caption"
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption จะถูกสร้างอัตโนมัติหลังกด สร้างด้วย AI"
            className="font-sans text-sm leading-[1.6em]"
          />
          <Input
            name="hashtags"
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#แฮชแท็ก จะถูกสร้างอัตโนมัติ"
            className="text-xs"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/90">ลิงก์คลิป TikTok</label>
            <div className="flex items-center gap-2">
              <Input
                name="videoUrl"
                value={videoUrl}
                onChange={(e) => {
                  const next = e.target.value;
                  // วางลิงก์ = โพสต์คลิปแล้วจริง — เติมวันที่ลงคลิปให้เป็นวันที่เปิด entry
                  // (ผู้ใช้ทำงานวันต่อวัน) เฉพาะตอนช่องวันที่ยังว่าง แก้ทับเองได้เสมอ
                  // และการลบลิงก์ทีหลังจะไม่ลบวันที่คืน
                  if (videoUrl.trim() === "" && next.trim() !== "" && postedAt === "") {
                    setPostedAt(toLocalDateInputValue(entry.createdAt));
                  }
                  setVideoUrl(next);
                }}
                placeholder="https://www.tiktok.com/@.../video/..."
              />
              {videoUrl && isSafeHttpUrl(videoUrl) && (
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="เปิดคลิป"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/90">วันที่ลงคลิป</label>
            <DatePickerField
              name="postedAt"
              value={postedAt}
              onChange={setPostedAt}
              placeholder="เลือกวันที่ลงคลิป"
              ariaLabel="วันที่ลงคลิป"
              className="w-full sm:w-auto"
            />
            <p className="text-xs text-muted-foreground">
              {postedAt ? " " : "ยังไม่ได้ลงคลิป"}
            </p>
          </div>

        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSaving} size="lg" className="self-start">
            {isSaving ? "กำลังบันทึก..." : "บันทึกผลลัพธ์"}
          </Button>
          {state?.ok && !isSaving && (
            <span className="text-xs text-muted-foreground">บันทึกแล้ว</span>
          )}
        </div>
      </form>
    </section>
  );
}
