"use client";

import { Check, Copy, Sparkles } from "lucide-react";

import { GEMINI_MODELS } from "@/lib/gemini";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ScriptOutput({
  output,
  copied,
  onCopy,
  onGenerate,
  isGenerating,
  canGenerate,
  model,
  onModelChange,
}: {
  output: string;
  copied: boolean;
  onCopy: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
  canGenerate: boolean;
  model: string;
  onModelChange: (model: string) => void;
}) {
  const wordCount = output.trim().length === 0 ? 0 : output.trim().split(/\s+/).length;

  return (
    <section className="flex flex-1 flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-marigold" />
          <h2 className="font-mono text-xs tracking-widest text-marigold uppercase">
            Script · 10-Part Prompt
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isGenerating}
            aria-label="เลือกโมเดล AI"
            className="h-8 rounded-lg border border-border bg-background px-2 font-mono text-xs text-foreground outline-none focus-visible:border-ring disabled:opacity-50"
          >
            {GEMINI_MODELS.map((geminiModel) => (
              <option key={geminiModel.id} value={geminiModel.id}>
                {geminiModel.label}
              </option>
            ))}
          </select>

          <Button
            type="button"
            size="sm"
            disabled={!canGenerate || isGenerating}
            onClick={onGenerate}
            title={canGenerate ? undefined : "แนบรูปสินค้าจริงก่อน"}
            className="bg-rust text-primary-foreground hover:bg-rust/90"
          >
            <Sparkles className="size-3.5" />
            {isGenerating ? "กำลังสร้าง..." : "สร้างด้วย AI"}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={onCopy}
            className="bg-marigold text-ink hover:bg-marigold/90"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "คัดลอกแล้ว" : "คัดลอก"}
          </Button>
        </div>
      </div>

      <div className="relative min-h-96 flex-1 overflow-hidden rounded-lg border border-border">
        <Textarea
          readOnly
          value={output}
          className="h-full min-h-0 resize-none border-none bg-transparent p-4 font-sans text-sm leading-[1.6em] text-foreground shadow-none focus-visible:ring-0"
        />
      </div>

      <p className="text-right font-mono text-[0.7rem] text-muted-foreground">
        {wordCount} คำ
      </p>
    </section>
  );
}
