"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyInBrowser } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";

/**
 * แฮชแท็กที่ต้องลง (CONTEXT.md) ของสินค้าจาก Showcase พร้อมปุ่มคัดลอกทั้งหมดเว้นวรรค — ไว้ดูตอนปักตะกร้า
 * ไม่มีแฮชแท็ก = ผู้เรียกไม่ render คอมโพเนนต์นี้เลย (ว่าง = ไม่ต้องลงอะไร)
 */
export function RequiredHashtagCopy({ hashtags }: { hashtags: string[] }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  async function copy() {
    setState((await copyInBrowser(hashtags.join(" "))) === "manual" ? "failed" : "copied");
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted-foreground">
      <span>แฮชแท็กที่ต้องลง</span>
      {hashtags.map((tag) => (
        <code key={tag} className="rounded-md bg-surface-2 px-2 py-0.5 text-sm text-foreground select-all">
          {tag}
        </code>
      ))}
      <Button type="button" size="xs" variant="outline" aria-label="คัดลอกแฮชแท็กที่ต้องลง" onClick={copy}>
        {state === "copied" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />} คัดลอก
      </Button>
      <span role="status">
        {state === "copied" ? "คัดลอกแล้ว" : state === "failed" ? "คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C" : ""}
      </span>
    </div>
  );
}
