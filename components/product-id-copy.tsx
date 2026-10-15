"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyInBrowser } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";

/**
 * Product ID ของสินค้าจาก Showcase พร้อมปุ่มคัดลอก — ไว้ค้นหาสินค้าตอนปักตะกร้า (เร็วกว่าไล่หาในรายการที่ถูกดันลงไป)
 * สินค้าที่ไม่ได้มาจาก Showcase ไม่มี ID → ผู้เรียกไม่ render คอมโพเนนต์นี้เลย (หน้าจอไม่รก)
 */
export function ProductIdCopy({ productId }: { productId: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  async function copy() {
    setState((await copyInBrowser(productId)) === "manual" ? "failed" : "copied");
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted-foreground">
      <span>Product ID</span>
      <code className="rounded-md bg-surface-2 px-2 py-0.5 text-sm text-foreground select-all">{productId}</code>
      <Button type="button" size="xs" variant="outline" aria-label="คัดลอก Product ID" onClick={copy}>
        {state === "copied" ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />} คัดลอก
      </Button>
      <span role="status">
        {state === "copied" ? "คัดลอกแล้ว" : state === "failed" ? "คัดลอกไม่ได้ — เลือกตัวเลขแล้วกด Ctrl+C" : ""}
      </span>
    </div>
  );
}
