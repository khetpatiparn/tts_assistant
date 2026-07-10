"use client";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ScriptOutput({
  output,
  copied,
  onCopy,
}: {
  output: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const wordCount = output.trim().length === 0 ? 0 : output.trim().split(/\s+/).length;

  return (
    <section className="flex flex-1 flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-marigold" />
          <h2 className="font-mono text-xs tracking-widest text-marigold uppercase">
            Script · 10-Part Prompt
          </h2>
        </div>
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

      <div className="script-paper relative flex-1 overflow-hidden rounded-lg">
        <Textarea
          readOnly
          value={output}
          className="min-h-96 resize-none border-none bg-transparent p-4 font-sans text-sm leading-[1.6em] text-foreground shadow-none focus-visible:ring-0"
        />
      </div>

      <p className="text-right font-mono text-[0.7rem] text-muted-foreground">
        {wordCount} คำ
      </p>
    </section>
  );
}
