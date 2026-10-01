"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

import type { FlowJobRow, FlowWorkerView } from "@/lib/flow-queries";
import { ERROR_KIND_LABELS, queueCategory, summarizeQueue, type QueueCategory } from "@/lib/flow-jobs";
import { cn } from "@/lib/utils";
import { FlowReviewRow } from "@/components/flow-review-row";

const REFRESH_MS = 30_000;

/** หมวดเดียวกับ summarizeQueue (queueCategory ใน lib/flow-jobs.ts) — งาน "skipped" ไม่เข้าหมวดไหนเลย
 * ตั้งใจ (เห็นเฉพาะตอนไม่กรอง) เหมือนที่ summarizeQueue เองก็ไม่นับ skipped ในสรุปด้วย */
type FilterCategory = QueueCategory;

const FILTER_META: Record<FilterCategory, { label: string; barClass: string; dotClass: string }> = {
  waitingBot: { label: "รอบอท", barClass: "bg-status-neutral/60 hover:bg-status-neutral/75", dotClass: "bg-status-neutral" },
  waitingUser: { label: "รอคุณเลือก/ดูคลิป", barClass: "bg-status-warning hover:bg-status-warning/85", dotClass: "bg-status-warning" },
  done: { label: "เสร็จ", barClass: "bg-status-success hover:bg-status-success/85", dotClass: "bg-status-success" },
  failed: { label: "พัง", barClass: "bg-status-danger hover:bg-status-danger/85", dotClass: "bg-status-danger" },
};

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

type Group = { key: string; title: string; jobs: FlowJobRow[]; collapsible: boolean };

/** 3 กลุ่มตามที่ตกลงกับผู้ใช้ (+ "ข้ามแล้ว" ที่ไม่เข้าหมวดไหน เห็นเฉพาะตอนไม่กรอง) · กลุ่มว่างไม่แสดง */
function buildGroups(jobs: FlowJobRow[]): Group[] {
  const cat = (j: FlowJobRow) => queueCategory(j.status);
  const all: Group[] = [
    { key: "user", title: "ต้องให้คุณดู", jobs: jobs.filter((j) => cat(j) === "waitingUser" || cat(j) === "failed"), collapsible: false },
    { key: "bot", title: "บอทกำลังทำ / รอคิว", jobs: jobs.filter((j) => cat(j) === "waitingBot"), collapsible: false },
    { key: "done", title: "เสร็จแล้ว", jobs: jobs.filter((j) => cat(j) === "done"), collapsible: true },
    { key: "skipped", title: "ข้ามแล้ว", jobs: jobs.filter((j) => cat(j) === null), collapsible: false },
  ];
  return all.filter((g) => g.jobs.length > 0);
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
  const [filter, setFilter] = useState<FilterCategory | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);

  // หน้านี้อ่านสถานะที่ worker (คนละโปรเซส) เขียน — ไม่มี revalidatePath จากฝั่งนั้น จึง refresh เอง
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const paused = worker.pausedReason !== "";
  const wake = minutesUntil(worker.nextWakeAt, now);
  const visibleJobs = filter === null ? jobs : jobs.filter((j) => queueCategory(j.status) === filter);
  const groups = buildGroups(visibleJobs);

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
              {/* ไม่มีงานพัง = ไม่มีปุ่ม "รันต่อ" ให้กด บอกทางออกตรงๆ (บอทปลดการหยุดนี้เองตอนเปิดใหม่) */}
              {summary.failed === 0 && worker.pausedReason !== "login_required"
                ? " — เปิด start.bat ใหม่แล้วบอทจะทำงานต่อเอง"
                : ""}
            </span>
          ) : worker.alive ? (
            <span className="text-foreground">
              บอททำงานอยู่ · เห็นล่าสุด {minutesAgo(worker.lastSeenAt, now)} · วันนี้วาดไป {worker.todayBatches}/{worker.dailyBatchCap} ชุด
              · ทำคลิป {worker.todayRenders}/{worker.videoDailyCap}
              {" · ยิง Flow วันนี้ "}{worker.activity.today}{" ครั้ง · ถี่สุด "}{worker.activity.peakPer10Min}{"/10 นาที · สัญญาณเตือน: "}
              {worker.activity.lastWarnAt === null ? "ไม่มี" : `ล่าสุด ${minutesAgo(worker.activity.lastWarnAt, now)}`}
              {wake ? ` · ${wake}` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">
              บอทไม่ได้เปิดอยู่ (เห็นล่าสุด {minutesAgo(worker.lastSeenAt, now)}) — เปิดด้วย start.bat
              (ถ้าหน้าต่าง Flow Login ยังเปิดค้างอยู่ ให้ปิดก่อน)
            </span>
          )}
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          ยังไม่มีงานในคิว — ไปที่หน้า entry ของสินค้า อัปรูปแคป แล้วกด &quot;เข้าคิว Flow&quot;
        </p>
      ) : (
        <>
          {/* แถบสัดส่วนกดกรองได้ — ออกแบบร่วมกับผู้ใช้ผ่าน visual companion (2026-09-08)
              กดซ้ำหมวดเดิมเพื่อยกเลิกกรอง งาน "skipped" ไม่เข้าหมวดไหนเลย (เหมือน
              summarizeQueue) จึงเห็นเฉพาะตอนไม่กรอง (filter === null) */}
          <div className="flex flex-col gap-2">
            {/* แถบเป็นแค่บล็อกสี ไม่มีตัวหนังสือทับ — เลี่ยงคู่สีใหม่ที่ยังไม่เคยผ่าน
                check-contrast.mjs (ตัวเลข/label อยู่แยกแถวล่าง ใช้ text-foreground/
                text-muted-foreground ตามที่มีอยู่แล้วในแอป ปลอดภัยแน่นอน) */}
            <div className="flex h-2.5 overflow-hidden rounded-full" role="group" aria-label="สัดส่วนงานตามสถานะ">
              {(Object.keys(FILTER_META) as FilterCategory[])
                .filter((cat) => summary[cat] > 0)
                .map((cat) => {
                  const meta = FILTER_META[cat];
                  const active = filter === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      aria-pressed={active}
                      aria-label={`${meta.label} ${summary[cat]} รายการ`}
                      onClick={() => setFilter(active ? null : cat)}
                      style={{ flexGrow: summary[cat] }}
                      className={cn("min-w-3 transition-opacity", meta.barClass, filter !== null && !active && "opacity-30")}
                    />
                  );
                })}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {(Object.keys(FILTER_META) as FilterCategory[]).map((cat) => {
                const meta = FILTER_META[cat];
                const active = filter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={active}
                    disabled={summary[cat] === 0}
                    onClick={() => setFilter(active ? null : cat)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-1 py-0.5 disabled:opacity-40",
                      active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", meta.dotClass)} />
                    {meta.label} {summary[cat]}
                  </button>
                );
              })}
              {filter !== null && (
                <button type="button" className="text-muted-foreground underline underline-offset-2" onClick={() => setFilter(null)}>
                  ดูทั้งหมด
                </button>
              )}
            </div>
          </div>

          {/* ทุกกลุ่มอยู่ใน <ul> เดียว (หัวกลุ่มเป็น <li> คั่น) และ key = job.id เสมอ — งานย้ายกลุ่มได้โดย
              FlowReviewRow ไม่ถูก remount (state ที่ต้องรอดอยู่ในแถว) · กลุ่ม "เสร็จแล้ว" ที่พับใช้ hidden ไม่ใช่ unmount */}
          <ul className="flex flex-col">
            {groups.map((g) => {
              const open = !g.collapsible || doneOpen || filter === "done";
              return [
                <li key={`h-${g.key}`} className="border-b border-border pt-3 pb-1">
                  {g.collapsible ? (
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setDoneOpen((v) => !v)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-sm font-semibold text-foreground hover:bg-surface-2 lg:min-h-9"
                    >
                      <ChevronRight aria-hidden="true" className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} />
                      {g.title} ({g.jobs.length})
                    </button>
                  ) : (
                    <h2 className="px-1 text-sm font-semibold text-foreground">
                      {g.title} ({g.jobs.length})
                    </h2>
                  )}
                </li>,
                ...g.jobs.map((job) => <FlowReviewRow key={job.id} job={job} renderEnabled={worker.renderEnabled} hidden={!open} />),
              ];
            })}
          </ul>
        </>
      )}
    </section>
  );
}
