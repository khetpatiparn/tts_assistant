"use client";

import { useState } from "react";

import { revenueByClip, type AffiliateOrderRecord } from "@/lib/dashboard";
import { ClipThumbnail } from "@/components/clip-thumbnail";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

export function RevenueByClipList({ orders }: { orders: AffiliateOrderRecord[] }) {
  const [showAll, setShowAll] = useState(false);
  const clips = revenueByClip(orders);
  if (clips.length === 0) return null;

  const shown = showAll ? clips : clips.slice(0, 5);
  const max = Math.max(...clips.map((c) => c.gmv), 1);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[0.7rem] tracking-widest text-smoke uppercase">
          คลิปทำเงิน
        </h3>
        {clips.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-mono text-xs text-marigold hover:underline"
          >
            {showAll ? "ย่อ" : `ดูทั้งหมด (${clips.length})`}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {shown.map((c) => (
          <div key={c.contentId} className="flex items-center gap-3">
            <ClipThumbnail contentId={c.contentId} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-foreground/90">
                  {c.productName || c.contentId}
                  {c.matchedEntryId === null && (
                    <span className="ml-1 text-marigold">(ยังไม่มีในแอป)</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-muted-foreground">
                  {baht(c.gmv)} · {c.orders} ออเดอร์
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-marigold"
                  style={{ width: `${(c.paidGmv / max) * 100}%` }}
                  title="จ่ายแล้ว"
                />
                <div
                  className="bg-smoke/50"
                  style={{ width: `${(c.pendingGmv / max) * 100}%` }}
                  title="รอ/ยังไม่จ่าย"
                />
                <div
                  className="bg-record/30"
                  style={{ width: `${(c.ineligibleGmv / max) * 100}%` }}
                  title="ไม่มีสิทธิ์"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-4 font-mono text-[0.65rem] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-marigold" /> จ่ายแล้ว
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-smoke/50" /> รอ/ยังไม่จ่าย
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-record/30" /> ไม่มีสิทธิ์
        </span>
      </div>
    </div>
  );
}
