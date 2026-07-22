"use client";

import { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { videoIdFromUrl } from "@/lib/affiliate";
import type { ClipMetricRecord } from "@/lib/recommender";
import {
  analyzePostTimes,
  SCHEDULED_RATIO_WARN,
  type FollowerActivityRecord,
  type PostTimeClip,
} from "@/lib/post-time";

export type PostTimeEntry = {
  id: string;
  productName: string;
  videoUrl: string;
  postedTimeOfDay: string | null;
  postedTimeSource: string | null;
  isScheduledPost: boolean;
};

/**
 * แสดงชั่วโมงแบบ 12 ชม. AM/PM (ไม่ใช่ 24 ชม.) — TikTok Studio เองก็แสดงเวลาแบบนี้
 * ข้อมูลภายในยังเป็นเลข 0-23 เหมือนเดิม แปลงแค่ตอนแสดงผล
 */
function hourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour} ${period}`;
}

export function PostTimePanel({
  entries,
  metrics,
  followerActivity,
}: {
  entries: PostTimeEntry[];
  metrics: ClipMetricRecord[];
  followerActivity: FollowerActivityRecord[];
}) {
  const [includeManual, setIncludeManual] = useState(false);

  const clips = useMemo<PostTimeClip[]>(() => {
    // วิวล่าสุดต่อ entry จาก snapshot ที่ capture ทีหลังสุด
    const latestViews = new Map<string, { at: number; views: number }>();
    for (const m of metrics) {
      if (!m.matchedEntryId) continue;
      const cur = latestViews.get(m.matchedEntryId);
      const at = m.capturedOn.getTime();
      if (!cur || at > cur.at) latestViews.set(m.matchedEntryId, { at, views: m.views });
    }
    return entries.map((e) => ({
      entryId: e.id,
      productName: e.productName,
      videoId: videoIdFromUrl(e.videoUrl),
      postedTimeOfDay: e.postedTimeOfDay,
      postedTimeSource: e.postedTimeSource,
      isScheduledPost: e.isScheduledPost,
      views: latestViews.get(e.id)?.views ?? null,
    }));
  }, [entries, metrics]);

  const analysis = useMemo(
    () => analyzePostTimes({ clips, followerActivity, includeManual }),
    [clips, followerActivity, includeManual]
  );

  const chartData = analysis.buckets.map((b) => ({
    hour: hourLabel(b.hour),
    medianViews: b.medianViews,
    followersActive: b.followersActive ?? 0,
    clipCount: b.clipCount,
  }));

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground/90">
          <Clock className="size-4 text-marigold" />
          เวลาโพสต์ vs ยอดวิว
        </span>
        <label className="ml-auto flex items-center gap-1.5 font-mono text-[0.7rem] text-muted-foreground">
          <input
            type="checkbox"
            checked={includeManual}
            onChange={(e) => setIncludeManual(e.target.checked)}
          />
          รวมเวลาที่กรอกเอง
        </label>
      </div>

      {analysis.usableClips === 0 ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีคลิปที่อ่านเวลาได้ — นำเข้าข้อมูลวิวก่อน
        </p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(value, name) => {
                  const num = typeof value === "number" ? value : Number(value ?? 0);
                  return name === "medianViews"
                    ? [num.toLocaleString(), "วิว (median)"]
                    : [num.toLocaleString(), "ผู้ติดตามออนไลน์"];
                }}
              />
              <Bar yAxisId="left" dataKey="medianViews" fill="var(--color-marigold)" />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="followersActive"
                stroke="var(--color-rust)"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-col gap-0.5 border-t border-border pt-2 font-mono text-[0.7rem] text-muted-foreground">
        <span>
          วิเคราะห์จาก {analysis.usableClips} คลิป · ข้าม {analysis.skippedScheduled} (ตั้งเวลา) ·
          ข้าม {analysis.skippedNoViews} (ไม่มีข้อมูลวิว)
        </span>
        {!analysis.enoughData && (
          <span>
            ยังน้อยเกินจะสรุป — เก็บอีก ~{analysis.clipsNeededForConfidence} คลิปจะเริ่มเชื่อได้
          </span>
        )}
        {analysis.peakPostHours.length > 0 && analysis.peakFollowerHours.length > 0 && (
          <span>
            คุณโพสต์บ่อยสุด {analysis.peakPostHours.map(hourLabel).join(", ")} ·
            ผู้ติดตามออนไลน์เยอะสุด {analysis.peakFollowerHours.map(hourLabel).join(", ")}
          </span>
        )}
        {analysis.scheduledRatio > SCHEDULED_RATIO_WARN && (
          <span>
            คลิปตั้งเวลาเยอะขึ้นจนข้อมูลเริ่มไม่พอ — ถ้าอยากให้วิเคราะห์ต่อได้ ต้องกรอกเวลาเผยแพร่ตอนวางลิงก์
          </span>
        )}
      </div>
    </div>
  );
}
