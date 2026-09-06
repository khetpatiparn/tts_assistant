"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import type { FlowJobRow, FlowWorkerView } from "@/lib/flow-queries";
import { ERROR_KIND_LABELS, summarizeQueue } from "@/lib/flow-jobs";
import { cn } from "@/lib/utils";
import { FlowReviewRow } from "@/components/flow-review-row";

const REFRESH_MS = 30_000;

function minutesAgo(d: Date | null, now: Date): string {
  if (d === null) return "ไม่เคยเห็น";
  const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  return m === 0 ? "เมื่อครู่" : `${m} นาทีก่อน`;
}

function minutesUntil(d: Date | null, now: Date): string | null {
  if (d === null) return null;
  const m = Math.round((d.getTime() - now.getTime()) / 60000);
  return m <= 0 ? "กำลังจะหยิบงานถัดไป" : `อีก ~${m} นาทีจะหยิบงานถัดไป`;
}

export function FlowRoute({
  jobs,
  worker,
  summary,
  now,
}: {
  jobs: FlowJobRow[];
  worker: FlowWorkerView;
  summary: ReturnType<typeof summarizeQueue>;
  now: Date;
}) {
  const router = useRouter();

  // หน้านี้อ่านสถานะที่ worker (คนละโปรเซส) เขียน — ไม่มี revalidatePath จากฝั่งนั้น จึง refresh เอง
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const paused = worker.pausedReason !== "";
  const wake = minutesUntil(worker.nextWakeAt, now);

  return (
    <section className="flex flex-col gap-4">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 leading-relaxed",
          paused ? "bg-surface-2" : "bg-surface"
        )}
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn("size-2.5 shrink-0 rounded-full", paused ? "bg-status-danger" : worker.alive ? "bg-status-success" : "bg-status-neutral")}
          />
          {paused ? (
            <span className="font-medium text-foreground">
              บอทหยุดแล้ว — {ERROR_KIND_LABELS[worker.pausedReason] ?? worker.pausedReason}
              {worker.pausedAt ? ` (หยุดเมื่อ ${minutesAgo(worker.pausedAt, now)})` : ""}
            </span>
          ) : worker.alive ? (
            <span className="text-foreground">
              บอททำงานอยู่ · เห็นล่าสุด {minutesAgo(worker.lastSeenAt, now)} · วันนี้วาดไป {worker.todayBatches}/{worker.dailyBatchCap} ชุด
              {wake ? ` · ${wake}` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">
              บอทไม่ได้เปิดอยู่ (เห็นล่าสุด {minutesAgo(worker.lastSeenAt, now)}) — เปิดด้วย flow-worker.bat
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          รอบอท {summary.waitingBot} · รอคุณเลือก {summary.waitingUser} · เสร็จ {summary.done} · พัง {summary.failed}
        </p>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          ยังไม่มีงานในคิว — ไปที่หน้า entry ของสินค้า อัปรูปแคป แล้วกด &quot;เข้าคิว Flow&quot;
        </p>
      ) : (
        <ul className="flex flex-col">
          {jobs.map((job) => (
            <FlowReviewRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </section>
  );
}
