"use client";

import { useMemo } from "react";
import { checkClaims, type ClaimHit } from "@/lib/claim-check";

const WHERE_LABEL: Record<ClaimHit["where"], string> = {
  voiceover: "เสียงพากย์",
  caption: "แคปชัน",
  hashtags: "แฮชแท็ก",
};

/** เตือนคำเสี่ยงก่อนโพสต์ — ไม่มี hit = ไม่แสดงอะไร */
export function ClaimWarnings({ tenPart, caption, hashtags }: { tenPart: string; caption: string; hashtags: string }) {
  const hits = useMemo(() => checkClaims({ tenPart, caption, hashtags }), [tenPart, caption, hashtags]);
  if (hits.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 border-l-4 border-status-warning bg-surface-2 p-3 text-sm leading-relaxed" role="note">
      <p className="font-semibold text-foreground">ตรวจคำก่อนโพสต์</p>
      <ul className="flex flex-col gap-1">
        {hits.map((h, i) => (
          <li key={`${h.where}-${h.word}-${i}`} className="text-foreground">
            {h.level === "ban"
              ? `พบ "${h.word}" ใน${WHERE_LABEL[h.where]} — ลบก่อนโพสต์`
              : `พบ "${h.word}" ใน${WHERE_LABEL[h.where]} — เช็กว่าหน้าสินค้าเขียนไว้จริงไหม`}
            {h.level === "ban" && <span className="block text-muted-foreground">{h.snippet}</span>}
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-muted-foreground">เป็นคำเตือน ไม่ได้แก้ข้อความให้</p>
    </div>
  );
}
