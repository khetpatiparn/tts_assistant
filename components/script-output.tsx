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
    <section className="flex flex-1 flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-primary" />
          <h2 className="text-xs text-primary">
            Script · 10-Part Prompt
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isGenerating}
            aria-label="เลือกโมเดล AI"
            className="h-11 rounded-lg border border-border-interactive bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring disabled:opacity-50 lg:h-9"
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
          >
            <Sparkles className="size-3.5" />
            {isGenerating ? "กำลังสร้าง..." : "สร้างด้วย AI"}
          </Button>

          <Button type="button" size="sm" variant="outline" onClick={onCopy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "คัดลอกแล้ว" : "คัดลอก"}
          </Button>
        </div>
      </div>

      {/* เหตุผลที่ปุ่มกดไม่ได้ต้องเป็นข้อความจริง ไม่ใช่แค่ title= — จอสัมผัสไม่มีทาง hover
          เห็น title ของปุ่มที่ disabled อยู่แล้ว (pointer-events ถูกปิดไปพร้อมกัน) */}
      {!canGenerate && (
        <p className="text-xs leading-relaxed text-muted-foreground lg:hidden">
          แนบรูปสินค้าจริงก่อนถึงจะกด &quot;สร้างด้วย AI&quot; ได้
        </p>
      )}

      <div className="relative min-h-96 flex-1 overflow-hidden rounded-lg border border-border">
        <Textarea
          readOnly
          value={output}
          className="h-full min-h-0 resize-none border-none bg-transparent p-4 font-sans text-sm leading-[1.6em] text-foreground shadow-none focus-visible:ring-0"
        />
      </div>

      <p className="text-right text-xs text-muted-foreground">
        <span className="font-mono">{wordCount}</span> คำ
      </p>
    </section>
  );
}
