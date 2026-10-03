"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { FlowJobRow, FlowWorkerView } from "@/lib/flow-queries";
import { ERROR_KIND_LABELS, queueCategory, summarizeQueue, type QueueCategory } from "@/lib/flow-jobs";
import { GEMINI_MODELS } from "@/lib/gemini";
import { generateWithAI } from "@/app/actions";
import { playCompletionSound } from "@/lib/completion-sound";
import { cn } from "@/lib/utils";
import { FlowJobList, type FlowListGroup } from "@/components/flow-job-list";
import { FlowJobDetail } from "@/components/flow-job-detail";

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

type Group = Omit<FlowListGroup, "open">;

/** 3 กลุ่มตามที่ตกลงกับผู้ใช้ (+ "ข้ามแล้ว" ที่ไม่เข้าหมวดไหน เห็นเฉพาะตอนไม่กรอง) · กลุ่มว่างไม่แสดง
 * "เสร็จแล้ว" กับ "ข้ามแล้ว" พับไว้ก่อน (collapsible) */
function buildGroups(jobs: FlowJobRow[]): Group[] {
  const cat = (j: FlowJobRow) => queueCategory(j.status);
  const all: Group[] = [
    { key: "user", title: "ต้องให้คุณดู", jobs: jobs.filter((j) => cat(j) === "waitingUser" || cat(j) === "failed"), collapsible: false },
    { key: "bot", title: "บอทกำลังทำ / รอคิว", jobs: jobs.filter((j) => cat(j) === "waitingBot"), collapsible: false },
    { key: "done", title: "เสร็จแล้ว", jobs: jobs.filter((j) => cat(j) === "done"), collapsible: true },
    { key: "skipped", title: "ข้ามแล้ว", jobs: jobs.filter((j) => cat(j) === null), collapsible: true },
  ];
  return all.filter((g) => g.jobs.length > 0);
}

function groupKeyOf(job: FlowJobRow): string {
  const c = queueCategory(job.status);
  return c === "waitingUser" || c === "failed" ? "user" : c === "waitingBot" ? "bot" : c === "done" ? "done" : "skipped";
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
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<FilterCategory | null>(null);
  const detailPaneRef = useRef<HTMLDivElement>(null);

  // งานที่เลือกเก็บใน URL (?job=<id>) · ใช้ history.replaceState ตรงๆ (Next ซิงก์กับ useSearchParams ให้) เพื่อไม่ต้องรอ
  // server ดึงข้อมูลใหม่ทุกครั้งที่กดเลือก และไม่เพิ่มประวัติย้อนกลับ · router.refresh() ทุก 30 วิไม่แตะ query นี้
  const jobParam = searchParams.get("job");
  const explicitJob = jobParam !== null ? (jobs.find((j) => j.id === jobParam) ?? null) : null;

  // กลุ่มพับได้ที่เปิดอยู่ · เริ่มต้นเปิดเฉพาะกลุ่มที่มีงานซึ่ง URL ชี้อยู่
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => {
    const pick = jobs.find((j) => j.id === jobParam);
    return new Set(pick ? [groupKeyOf(pick)] : []);
  });
  const toggleGroup = useCallback((key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const setJobParam = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete("job");
    else url.searchParams.set("job", id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // เลือกรูปรอบ 2 เสร็จ → ยิง generateWithAI ต่อให้ · อยู่ที่ route (ไม่ใช่ในแผงรายละเอียด) เพราะแผงนั้น mount เฉพาะงานที่เลือก
  // ผู้ใช้กดไปงานอื่นระหว่างที่ chooseFlowCandidate ยังทำงานได้ ขั้นนี้ต้องไม่หาย · ยิงครั้งเดียวต่อหนึ่งคำขอ
  const [autoGenerateEntryIds, setAutoGenerateEntryIds] = useState<string[]>([]);
  const requestAutoGenerate = useCallback((entryId: string) => setAutoGenerateEntryIds((q) => [...q, entryId]), []);
  useEffect(() => {
    if (autoGenerateEntryIds.length === 0) return;
    const entryIds = autoGenerateEntryIds;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoGenerateEntryIds([]);
    for (const entryId of entryIds) {
      // ลองซ้ำเอง 1 ครั้งหลัง 10 วิ — เจอจริง 2026-09-30: Gemini ล้มกลางทาง ("Unexpected HTTP client error") ครั้งเดียว
      // แล้วงานค้าง "รอ 10-part prompt" เป็นชั่วโมงเพราะไม่มีใครกดใหม่ · Render เริ่มเองทันทีที่พรอมต์บันทึกสำเร็จ
      generateWithAI(entryId, GEMINI_MODELS[0].id)
        .catch(() => new Promise((r) => setTimeout(r, 10_000)).then(() => generateWithAI(entryId, GEMINI_MODELS[0].id)))
        .then(() => playCompletionSound("success"))
        .catch(() => playCompletionSound("error"));
    }
  }, [autoGenerateEntryIds]);

  // หน้านี้อ่านสถานะที่ worker (คนละโปรเซส) เขียน — ไม่มี revalidatePath จากฝั่งนั้น จึง refresh เอง
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const paused = worker.pausedReason !== "";
  const wake = minutesUntil(worker.nextWakeAt, now);
  const visibleJobs = filter === null ? jobs : jobs.filter((j) => queueCategory(j.status) === filter);
  const baseGroups = buildGroups(visibleJobs);
  // ไม่มี ?job (หรือ id ใช้ไม่ได้แล้ว) → เดสก์ท็อปเลือกงานแรกของรายการให้เอง · มือถือยังเปิดที่รายการ (ดู className ด้านล่าง)
  const detailJob = explicitJob ?? baseGroups[0]?.jobs[0] ?? jobs[0] ?? null;
  const groups: FlowListGroup[] = baseGroups.map((g) => ({
    ...g,
    open:
      !g.collapsible ||
      openKeys.has(g.key) ||
      (g.key === "done" && filter === "done") ||
      // กลุ่มที่มีงานที่เลือกอยู่ต้องเปิดเสมอ — เดิมเปิดเฉพาะตอนเลือกอัตโนมัติ พอผู้ใช้กดเลือกงานในกลุ่ม "เสร็จแล้ว"
      // กลุ่มนั้นหุบทันทีเพราะ ?job ถูกตั้ง (ผู้ใช้เจอจริง 2026-10-01)
      g.jobs.some((j) => j.id === detailJob?.id),
  }));

  // "งานถัดไปที่รอคุณ" = งานถัดไปในกลุ่ม "ต้องให้คุณดู" ตามลำดับรายการ วนกลับต้น (ไม่ผูกกับตัวกรองที่เปิดอยู่)
  const needsYou = buildGroups(jobs).find((g) => g.key === "user")?.jobs ?? [];
  const nextWaiting = (() => {
    if (!detailJob || !needsYou.some((j) => j.id !== detailJob.id)) return null;
    const at = needsYou.findIndex((j) => j.id === detailJob.id);
    return needsYou[(at + 1) % needsYou.length];
  })();

  function selectJob(id: string) {
    setJobParam(id);
    detailPaneRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  return (
    <section className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 leading-relaxed",
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
          <div className="flex shrink-0 flex-col gap-2">
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

          {/* master–detail: ซ้าย = รายการ · ขวา = รายละเอียดงานที่เลือก (เลื่อนแยกกันที่ lg:) ·
              ต่ำกว่า lg: แสดงทีละฝั่ง — ไม่มี ?job = รายการ · มี ?job = รายละเอียดพร้อมปุ่มกลับ */}
          <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
            <div className={cn("min-w-0 lg:w-96 lg:shrink-0 lg:overflow-y-auto lg:pr-1", explicitJob !== null && "hidden lg:block")}>
              {groups.length === 0 ? (
                <p className="text-sm leading-relaxed text-muted-foreground">ไม่มีงานในหมวดที่กรองไว้</p>
              ) : (
                <FlowJobList
                  groups={groups}
                  selectedId={detailJob?.id ?? null}
                  renderEnabled={worker.renderEnabled}
                  onSelect={selectJob}
                  onToggleGroup={toggleGroup}
                />
              )}
            </div>
            <div
              ref={detailPaneRef}
              className={cn(
                "min-w-0 lg:flex-1 lg:overflow-y-auto lg:border-l lg:border-border lg:pl-6",
                explicitJob === null && "hidden lg:block"
              )}
            >
              {detailJob && (
                <FlowJobDetail
                  key={detailJob.id}
                  job={detailJob}
                  renderEnabled={worker.renderEnabled}
                  workerAlive={worker.alive}
                  queuePaused={paused}
                  onRound2Chosen={requestAutoGenerate}
                  onBack={() => setJobParam(null)}
                  onNext={nextWaiting ? () => selectJob(nextWaiting.id) : null}
                />
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
