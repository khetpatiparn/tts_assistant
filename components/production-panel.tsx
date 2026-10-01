"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Download, ExternalLink } from "lucide-react";

import { updateProduction } from "@/app/actions";
import { copyInBrowser } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClaimWarnings } from "@/components/claim-warnings";
import { DatePickerField } from "@/components/date-picker-field";
import type { PromptEntry } from "@/components/entry-workspace";
import type { EntryRenderVideo } from "@/lib/flow-queries";
import { videoDownloadName } from "@/lib/flow-jobs";

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
}: {
  entry: PromptEntry;
  renderVideo?: EntryRenderVideo | null;
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

      {/* คลิปจากบอท Flow — เล็กๆ บนสุด ดาวน์โหลดไปโพสต์เอง (บอทยังไม่โพสต์ TikTok ให้) */}
      {renderVideo && (
        <div className="flex flex-wrap items-end gap-3">
          <video
            src={`/api/uploads/${renderVideo.path}`}
            controls
            preload="metadata"
            className="aspect-[9/16] w-32 rounded-md border border-border bg-surface-2 lg:w-40"
          />
          <div className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed text-foreground">{RENDER_STAGE_LABEL[renderVideo.stage]}</p>
            <a
              href={`/api/uploads/${renderVideo.path}`}
              download={videoDownloadName(entry.productName)}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
            >
              <Download data-icon="inline-start" /> ดาวน์โหลดคลิป
            </a>
          </div>
        </div>
      )}

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
