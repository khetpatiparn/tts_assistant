"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export type CandidateImageOption = { id: string; filename: string };

export function CandidateImagePicker({
  candidateId,
  images,
  onConfirm,
  onCancel,
}: {
  candidateId: string;
  images: CandidateImageOption[];
  onConfirm: (candidateId: string, chosenImageIds: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold leading-relaxed text-foreground">
          เลือกรูปที่จะใช้เป็นรูปอ้างอิงให้ Flow
        </h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img) => {
            const isSelected = selected.has(img.id);
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => toggle(img.id)}
                className={`overflow-hidden rounded-md border-2 outline-none ${
                  isSelected ? "border-primary" : "border-border-interactive"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/uploads/_candidates/${candidateId}/${img.filename}`}
                  alt=""
                  className="aspect-square w-full object-cover"
                />
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0}
            onClick={() => onConfirm(candidateId, [...selected])}
          >
            สร้างงาน ({selected.size} รูป)
          </Button>
        </div>
      </div>
    </div>
  );
}
