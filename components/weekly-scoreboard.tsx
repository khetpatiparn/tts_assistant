"use client";

import { useMemo } from "react";
import { CalendarRange } from "lucide-react";

import type { AffiliateOrderRecord } from "@/lib/dashboard";
import {
  buildWeeklyScoreboard,
  type ScoreboardEntry,
} from "@/lib/weekly-scoreboard";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

/** weekStart/weekEnd เป็นวันตามปฏิทินที่เก็บไว้ที่ UTC midnight — ต้องฟอร์แมตด้วย timeZone: "UTC" */
function dayMonth(d: Date): string {
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function WeeklyScoreboard({
  entries,
  orders,
  now,
}: {
  entries: ScoreboardEntry[];
  orders: AffiliateOrderRecord[];
  now: Date;
}) {
  const board = useMemo(
    () => buildWeeklyScoreboard({ entries, orders, now, weeks: 4 }),
    [entries, orders, now]
  );

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <span className="flex items-center gap-1.5 font-medium text-foreground/90">
        <CalendarRange className="size-4 text-marigold" />
        4 สัปดาห์ล่าสุด
      </span>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] border-collapse text-sm">
          <thead>
            <tr className="text-left font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
              <th className="pb-2 font-normal">สัปดาห์</th>
              <th className="pb-2 text-right font-normal">คลิป</th>
              <th className="pb-2 text-right font-normal">เงินที่ได้จริง</th>
              <th className="pb-2 text-right font-normal">winner ใหม่</th>
            </tr>
          </thead>
          <tbody>
            {board.weeks.map((w) => (
              <tr
                key={w.weekStart.toISOString()}
                className="border-t border-border first:border-t-0"
              >
                <td className="py-2 text-foreground/80">
                  {dayMonth(w.weekStart)}–{dayMonth(w.weekEnd)}
                  {w.isCurrent && (
                    <span className="ml-1.5 font-mono text-[0.65rem] text-marigold">
                      (นี้)
                    </span>
                  )}
                </td>
                <td className="py-2 text-right font-mono text-foreground/90">{w.clips}</td>
                <td className="py-2 text-right font-mono text-foreground/90">
                  {baht(w.settledRevenue)}
                </td>
                <td className="py-2 text-right font-mono text-foreground/90">
                  {w.newWinners}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {board.tooEarlyClips > 0 && (
        <p className="font-mono text-[0.7rem] text-muted-foreground">
          มี {board.tooEarlyClips} คลิปที่เพิ่งลงไม่ถึง 7 วัน — ยังเร็วเกินสรุป
        </p>
      )}
    </div>
  );
}
