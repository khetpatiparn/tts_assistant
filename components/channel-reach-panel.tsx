"use client";

import { useMemo } from "react";

import type { AffiliateOrderRecord } from "@/lib/dashboard";
import { buildChannelReach, type ChannelMetricRecord } from "@/lib/channel-reach";

function int(n: number): string {
  return n.toLocaleString("th-TH");
}

function pct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)}%`;
}

/**
 * "27 ก.ค." — weekStart เป็น UTC midnight (มาจาก mondayUtc ใน lib/weekly-scoreboard.ts)
 * ต้องฟอร์แมตด้วย timeZone: "UTC" ไม่งั้นจะเลื่อนไป 1 วันในโซนเวลาไทย
 */
function weekLabel(d: Date): string {
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function ChannelReachPanel({
  metrics,
  orders,
}: {
  metrics: ChannelMetricRecord[];
  orders: AffiliateOrderRecord[];
}) {
  const reach = useMemo(() => buildChannelReach({ metrics, orders }), [metrics, orders]);

  if (reach.weeks.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-teal" />
          <h3 className="font-mono text-xs tracking-widest text-teal uppercase">
            วิวทั้งช่อง &amp; conversion
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          ยังไม่มีข้อมูล — อัป Overview.csv จาก TikTok Studio เพื่อดูวิวรวมทั้งช่องแบบครบทุกคลิป
        </p>
      </div>
    );
  }

  const trend =
    reach.conv30d !== null && reach.convPrev30d !== null
      ? reach.conv30d >= reach.convPrev30d
        ? "up"
        : "down"
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-teal" />
        <h3 className="font-mono text-xs tracking-widest text-teal uppercase">
          วิวทั้งช่อง &amp; conversion
        </h3>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.6rem] tracking-wide text-muted-foreground uppercase">
            วิวทั้งช่อง 30 วัน
          </span>
          <span className="font-mono text-lg font-bold">{int(reach.views30d)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.6rem] tracking-wide text-muted-foreground uppercase">
            conversion 30 วัน
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-lg font-bold text-teal">{pct(reach.conv30d)}</span>
            {trend !== null && (
              <span
                className={
                  trend === "up"
                    ? "font-mono text-[0.7rem] text-success-foreground"
                    : "font-mono text-[0.7rem] text-danger"
                }
              >
                {trend === "up" ? "▲" : "▼"} จาก {pct(reach.convPrev30d)}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-96 text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-1.5 pr-3 font-mono text-[0.6rem] tracking-wide font-normal text-muted-foreground uppercase">
                สัปดาห์
              </th>
              <th className="py-1.5 pr-3 text-right font-mono text-[0.6rem] tracking-wide font-normal text-muted-foreground uppercase">
                วิวทั้งช่อง
              </th>
              <th className="py-1.5 pr-3 text-right font-mono text-[0.6rem] tracking-wide font-normal text-muted-foreground uppercase">
                ออเดอร์
              </th>
              <th className="py-1.5 text-right font-mono text-[0.6rem] tracking-wide font-normal text-muted-foreground uppercase">
                conv%
              </th>
            </tr>
          </thead>
          <tbody>
            {reach.weeks.map((w) => (
              <tr key={w.weekStart.getTime()} className="border-b border-border/50">
                <td className="py-1.5 pr-3 font-mono text-xs">{weekLabel(w.weekStart)}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-xs">{int(w.views)}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-xs">{int(w.orders)}</td>
                <td className="py-1.5 text-right font-mono text-xs font-semibold">
                  {pct(w.convPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        ออเดอร์นับตามวันที่สั่งซื้อ ส่วนวิวนับตามวันที่เกิดวิว — คนดูคลิปวันนี้อาจไปสั่งพรุ่งนี้
        ดังนั้น conv% รายสัปดาห์เป็นค่าประมาณ ใช้ดูแนวโน้มข้ามหลายสัปดาห์ได้
        แต่อย่าอ่านสัปดาห์เดียวแล้วสรุป · นับเฉพาะวันที่มีข้อมูลวิวเท่านั้น
      </p>
    </div>
  );
}
