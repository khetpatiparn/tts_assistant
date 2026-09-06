"use client";

import { useEffect } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export type LightboxItem = { src: string; label: string };

/**
 * ขยายรูปเทียบกัน: ซ้าย = รูปแคปต้นทาง (คงที่) · ขวา = candidate ที่เลื่อนดูได้
 * ผู้ใช้ตัดสิน "แป๊ะไหม" ด้วยการเลื่อนดูไปมาระหว่างสองรูปนี้ (สัมภาษณ์ 2026-09-06)
 */
export function FlowLightbox({
  source,
  items,
  index,
  onIndexChange,
  onClose,
}: {
  source: LightboxItem;
  items: LightboxItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndexChange((index + 1) % items.length);
      if (e.key === "ArrowLeft") onIndexChange((index - 1 + items.length) % items.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndexChange]);

  const current = items[index];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="เทียบรูปแคปกับรูปที่วาด"
      className="fixed inset-0 z-50 flex flex-col bg-background/95 p-3 sm:p-6"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm leading-relaxed text-muted-foreground">
          ซ้าย: รูปแคปต้นทาง · ขวา: {current.label} ({index + 1}/{items.length}) — ลูกศร ←/→ เลื่อน · Esc ปิด
        </p>
        <Button type="button" variant="outline" size="icon" aria-label="ปิด" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="mt-3 grid flex-1 grid-cols-1 gap-3 md:grid-cols-2" onClick={(e) => e.stopPropagation()}>
        <div className="relative min-h-0 overflow-hidden rounded-lg border border-border bg-surface">
          <Image src={source.src} alt={source.label} fill sizes="50vw" className="object-contain" />
        </div>
        <div className="relative min-h-0 overflow-hidden rounded-lg border border-border bg-surface">
          <Image src={current.src} alt={current.label} fill sizes="50vw" className="object-contain" />
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-2">
            <Button type="button" variant="secondary" size="icon" aria-label="รูปก่อนหน้า" onClick={() => onIndexChange((index - 1 + items.length) % items.length)}>
              <ChevronLeft />
            </Button>
            <Button type="button" variant="secondary" size="icon" aria-label="รูปถัดไป" onClick={() => onIndexChange((index + 1) % items.length)}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
