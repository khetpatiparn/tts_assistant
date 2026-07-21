"use client";

import { useMemo } from "react";
import { Lightbulb } from "lucide-react";

import type { AffiliateOrderRecord } from "@/lib/dashboard";
import {
  buildClipStats,
  checkGuardHealth,
  detectSignals,
  type ClipMetricRecord,
  type ClipSignalKind,
} from "@/lib/recommender";

const KIND_STYLE: Record<ClipSignalKind, { label: string; className: string }> = {
  emerging: { label: "กำลังมา", className: "border-marigold/50 bg-marigold/10 text-marigold" },
  "hidden-gem": { label: "ของดีคนไม่เห็น", className: "border-rust/50 bg-rust/10 text-rust" },
  "reach-no-convert": { label: "ดูเยอะไม่ซื้อ", className: "border-smoke/50 bg-smoke/10 text-smoke" },
  fading: { label: "หยุดแล้ว", className: "border-border bg-muted text-muted-foreground" },
};

export function Recommendations({
  entries,
  metrics,
  orders,
  now,
}: {
  entries: { id: string; productName: string }[];
  metrics: ClipMetricRecord[];
  orders: AffiliateOrderRecord[];
  now: Date;
}) {
  const stats = useMemo(
    () => buildClipStats({ entries, metrics, orders, now }),
    [entries, metrics, orders, now]
  );
  const signals = useMemo(() => detectSignals(stats), [stats]);
  const guardHealth = useMemo(() => checkGuardHealth(stats), [stats]);

  const withMetrics = new Set(
    metrics.filter((m) => m.matchedEntryId !== null).map((m) => m.matchedEntryId)
  );
  const missing = entries.filter((e) => !withMetrics.has(e.id)).length;
  const hasDelta = metrics.length > 0 && new Set(metrics.map((m) => m.capturedOn.getTime())).size >= 2;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <span className="flex items-center gap-1.5 font-medium text-foreground/90">
        <Lightbulb className="size-4 text-marigold" />
        ควรทำอะไรต่อ
      </span>

      {signals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีสัญญาณที่ชัดพอจะแนะนำ — นำเข้าข้อมูลวิวและรายได้ให้ครบก่อน
        </p>
      ) : (
        signals.map((s) => {
          const style = KIND_STYLE[s.kind];
          return (
            <div key={s.entryId + s.kind} className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[0.65rem] ${style.className}`}>
                  {style.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
                  {s.productName}
                </span>
              </div>
              <p className="text-sm text-foreground/80">{s.headline}</p>
              <p className="font-mono text-[0.7rem] text-muted-foreground">{s.detail}</p>
            </div>
          );
        })
      )}

      <div className="flex flex-col gap-0.5 border-t border-border pt-2 font-mono text-[0.7rem] text-muted-foreground">
        {missing > 0 && <span>ยังไม่มีข้อมูลวิว {missing} คลิป — นำเข้าไฟล์ Content รอบใหม่เพื่อให้ครบ</span>}
        {!hasDelta && <span>สัญญาณด้านความเคลื่อนไหวจะใช้ได้หลังนำเข้าข้อมูลวิวรอบที่ 2</span>}
        {guardHealth.stale && (
          <span>
            ช่องโตขึ้นมาก (วิวกลาง {guardHealth.medianViews.toLocaleString()} เทียบกับเกณฑ์ขั้นต่ำ{" "}
            {guardHealth.minViewsForConv.toLocaleString()}) — เกณฑ์ความเชื่อมั่นใน lib/recommender.ts
            อาจหลวมเกินไปแล้ว ควรทบทวน
          </span>
        )}
      </div>
    </div>
  );
}
