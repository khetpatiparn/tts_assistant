"use client";

import { useActionState, useState } from "react";
import { ExternalLink } from "lucide-react";

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

function formatStamp(value: Date | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toDateInputValue(value: Date | null) {
  if (!value) return "";
  // Stored as UTC midnight, so read the UTC parts back out — using local
  // getters here would shift the date by a day in negative-offset timezones.
  return new Date(value).toISOString().slice(0, 10);
}

export function ProductionPanel({ entry }: { entry: PromptEntry }) {
  // Keyed on entry.id by the parent, so this initial state is correct on switch.
  const [chatgptOutput, setChatgptOutput] = useState(entry.chatgptOutput);
  const [videoUrl, setVideoUrl] = useState(entry.videoUrl);
  const [views, setViews] = useState(entry.views === null ? "" : String(entry.views));
  const [postedAt, setPostedAt] = useState(toDateInputValue(entry.postedAt));

  const [state, action, isSaving] = useActionState(
    async (_prev: { ok: boolean } | null, formData: FormData) => {
      await updateProduction(formData);
      return { ok: true };
    },
    null
  );

  const stamp = formatStamp(entry.viewsUpdatedAt);

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
          <label className="text-sm font-medium text-foreground/90">
            10-part prompt ที่ ChatGPT ตอบกลับ
          </label>
          <Textarea
            name="chatgptOutput"
            value={chatgptOutput}
            onChange={(e) => setChatgptOutput(e.target.value)}
            placeholder="วาง 10-part prompt ที่ได้จาก ChatGPT ที่นี่"
            className="min-h-80 flex-1 font-sans text-sm leading-[1.6em]"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground/90">ลิงก์คลิป TikTok</label>
            <div className="flex items-center gap-2">
              <Input
                name="videoUrl"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
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
            <label className="text-sm font-medium text-foreground/90">ยอดวิว</label>
            <Input
              name="views"
              type="number"
              min={0}
              step={1}
              value={views}
              onChange={(e) => setViews(e.target.value)}
              placeholder="เช่น 12000"
            />
            <p className="font-mono text-[0.7rem] text-muted-foreground">
              {stamp ? `อัปเดตล่าสุด ${stamp}` : "ยังไม่เคยบันทึกยอดวิว"}
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
