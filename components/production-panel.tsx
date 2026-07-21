"use client";

import { useActionState, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { updateProduction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PromptEntry } from "@/components/prompt-workspace";

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

export function ProductionPanel({ entry }: { entry: PromptEntry }) {
  // Keyed on entry.id by the parent, so this initial state is correct on switch.
  const [chatgptOutput, setChatgptOutput] = useState(entry.chatgptOutput);
  const [videoUrl, setVideoUrl] = useState(entry.videoUrl);
  const [postedAt, setPostedAt] = useState(toDateInputValue(entry.postedAt));
  const [postedTimeOfDay, setPostedTimeOfDay] = useState(entry.postedTimeOfDay ?? "");
  const [caption, setCaption] = useState(entry.caption);
  const [hashtags, setHashtags] = useState(entry.hashtags);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

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
    await navigator.clipboard.writeText(`${caption}\n${hashtags}`.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(chatgptOutput);
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
    <section className="flex flex-1 flex-col gap-5 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <span className="h-4 w-1 rounded-full bg-marigold" />
        <h2 className="font-mono text-xs tracking-widest text-marigold uppercase">
          Production · ผลลัพธ์ &amp; คลิป
        </h2>
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
            className="min-h-80 flex-1 font-sans text-sm leading-[1.6em]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-foreground/90">
              Caption &amp; Hashtags
            </label>
            <Button
              type="button"
              size="sm"
              onClick={copyForPost}
              disabled={!caption && !hashtags}
              className="bg-marigold text-ink hover:bg-marigold/90"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกทั้งหมด"}
            </Button>
          </div>
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
            className="font-mono text-xs"
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
            <Input
              name="postedAt"
              type="date"
              value={postedAt}
              onChange={(e) => setPostedAt(e.target.value)}
            />
            <p className="font-mono text-[0.7rem] text-muted-foreground">
              {postedAt ? " " : "ยังไม่ได้ลงคลิป"}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/90">เวลาที่ลงคลิป</label>
            <Input
              name="postedTimeOfDay"
              type="time"
              value={postedTimeOfDay}
              onChange={(e) => setPostedTimeOfDay(e.target.value)}
            />
            <p className="font-mono text-[0.7rem] text-muted-foreground">
              เก็บไว้วิเคราะห์ช่วงเวลาที่ได้ผลในอนาคต
            </p>
          </div>

        </div>

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={isSaving}
            size="lg"
            className="self-start bg-rust text-primary-foreground hover:bg-rust/90"
          >
            {isSaving ? "กำลังบันทึก..." : "บันทึกผลลัพธ์"}
          </Button>
          {state?.ok && !isSaving && (
            <span className="font-mono text-xs text-muted-foreground">บันทึกแล้ว</span>
          )}
        </div>
      </form>
    </section>
  );
}
