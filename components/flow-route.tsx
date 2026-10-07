"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { FlowJobRow, FlowWorkerView } from "@/lib/flow-queries";
import { FLOW_TABS, countByTab, defaultFlowTab, flowTabOf, orderJobsForTab, parseFlowTab, summarizeQueue, type FlowTab } from "@/lib/flow-jobs";
import { GEMINI_MODELS } from "@/lib/gemini";
import { generateWithAI } from "@/app/actions";
import { pauseCauseJob, pausedAdvice, pausedReasonLabel, probeNote } from "@/lib/flow-lifecycle";
import { playCompletionSound } from "@/lib/completion-sound";
import { cn } from "@/lib/utils";
import { FlowJobList } from "@/components/flow-job-list";
import { FlowJobDetail } from "@/components/flow-job-detail";
import { PostsPerDayControl } from "@/components/posts-per-day-control";
import { UnpauseQueueButton } from "@/components/flow-unpause-queue-button";

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
  postsPerDay,
}: {
  jobs: FlowJobRow[];
  worker: FlowWorkerView;
  summary: ReturnType<typeof summarizeQueue>;
  now: Date;
  /** โพสต์วันละกี่คลิป (โฟลเดอร์ TTS ตามวันโพสต์) — ตั้งได้จากแถบบนสุด */
  postsPerDay: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const detailPaneRef = useRef<HTMLDivElement>(null);

  // งานที่เลือกเก็บใน URL (?job=<id>) · ใช้ history.replaceState ตรงๆ (Next ซิงก์กับ useSearchParams ให้) เพื่อไม่ต้องรอ
  // server ดึงข้อมูลใหม่ทุกครั้งที่กดเลือก และไม่เพิ่มประวัติย้อนกลับ · router.refresh() ทุก 30 วิไม่แตะ query นี้
  const jobParam = searchParams.get("job");
  const explicitJob = jobParam !== null ? (jobs.find((j) => j.id === jobParam) ?? null) : null;

  const setJobParam = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete("job");
    else url.searchParams.set("job", id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // แท็บเก็บใน URL (?tab=) แบบเดียวกับ ?job · ไม่มี ?tab → แท็บของงานที่ ?job ชี้ ไม่งั้นแท็บแรกที่มีงานรอผู้ใช้
  // แล้วเขียนค่านั้นลง URL ทันทีที่เปิด (effect ด้านล่าง) เพื่อให้รีเฟรชทุก 30 วิไม่เปลี่ยนแท็บตามจำนวนที่ขยับ
  const counts = countByTab(jobs);
  const tabParam = parseFlowTab(searchParams.get("tab"));
  const tab: FlowTab = tabParam ?? (explicitJob ? flowTabOf(explicitJob.status) : defaultFlowTab(counts));
  const setTab = useCallback((next: FlowTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    url.searchParams.delete("job"); // เปลี่ยนแท็บ = เริ่มเลือกงานใหม่ (เดสก์ท็อปเลือกงานแรกของแท็บให้)
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const hasJobs = jobs.length > 0;
  useEffect(() => {
    if (tabParam !== null || !hasJobs) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasJobs]);

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
  // เหตุที่หยุดมาจากงานที่ทำให้หยุดจริง (pauseCauseJob: งานพังที่ตรงเวลา pausedAt ไม่ใช่งานพังล่าสุด) — "เน็ตสะดุด" เฉพาะเมื่องานนั้นพังที่ open-flow
  const pausedLabel = pausedReasonLabel(worker.pausedReason, pauseCauseJob(worker, jobs));
  const advice = pausedAdvice(worker.pausedReason, summary.failed);
  // จอดงานติดกันครบแล้วหยุด → บอทนัดลองงานถัดไปเอง (nextWakeAt ขณะหยุด) · ปุ่มเดิมยังกดได้ (กดแล้วการหยุดหาย = ไม่ลองเอง)
  const probe = paused ? probeNote(worker) : null;
  const wake = minutesUntil(worker.nextWakeAt, now);
  // ลำดับต่อแท็บ: เสร็จ/ข้าม = เวลาปิดใหม่→เก่า · เลือกรูป/ดูคลิป/พัง = รอนานสุดก่อน · บอท = ตามเดิม (orderJobsForTab)
  const tabJobs = orderJobsForTab(tab, jobs.filter((j) => flowTabOf(j.status) === tab));
  // ไม่มี ?job (หรือ id ใช้ไม่ได้แล้ว) → เดสก์ท็อปเลือกงานแรกของแท็บให้เอง · มือถือยังเปิดที่รายการ (ดู className ด้านล่าง)
  // งานที่ ?job ชี้ยังอยู่ในแผงรายละเอียดแม้ย้ายแท็บไปแล้ว (เช่นกดผ่านแล้วงานเปลี่ยนสถานะ) — ไม่ทำให้ผู้ใช้เสียที่
  const detailJob = explicitJob ?? tabJobs[0] ?? null;

  // "งานถัดไปที่รอคุณ" = งานถัดไปในแท็บเลือกรูป/ดูคลิป/พัง ตามลำดับรายการ วนกลับต้น
  const needsYou = (["choose", "clip", "failed"] as const).flatMap((t) =>
    orderJobsForTab(t, jobs.filter((j) => flowTabOf(j.status) === t))
  );
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
              บอทหยุดแล้ว — {pausedLabel}
              {worker.pausedAt ? ` (หยุดเมื่อ ${minutesAgo(worker.pausedAt, now)})` : ""}
              {/* ไม่มีงานพัง = ไม่มีปุ่ม "รันต่อ" ให้กด บอกทางออกตรงๆ (บอทปลดการหยุดนี้เองตอนเปิดใหม่) */}
              {summary.failed === 0 && worker.pausedReason !== "login_required"
                ? " — เปิด start.bat ใหม่แล้วบอทจะทำงานต่อเอง"
                : ""}
              {probe !== null && <span className="block font-normal text-foreground">{probe}</span>}
              {advice !== null && <span className="block font-normal text-muted-foreground">{advice}</span>}
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
        <div className="flex flex-wrap items-center gap-3">
          {paused && <UnpauseQueueButton pausedReason={worker.pausedReason} failedJobs={summary.failed} />}
          <PostsPerDayControl initial={postsPerDay} />
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          ยังไม่มีงานในคิว — ไปที่หน้า entry ของสินค้า อัปรูปแคป แล้วกด &quot;เข้าคิว Flow&quot;
        </p>
      ) : (
        <>
          {/* แท็บตามสิ่งที่ผู้ใช้ต้องทำ (spec 2026-10-04) · จัดกลุ่มล้วนๆ — แท็บ 3 อันแรกคืองานที่รอคุณ */}
          <div role="tablist" aria-label="แท็บคิว Flow" className="flex shrink-0 flex-wrap gap-2">
            {FLOW_TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex h-11 items-center gap-2 rounded-lg border px-3 text-sm leading-relaxed lg:h-9",
                    active
                      ? "border-primary bg-surface font-semibold text-foreground"
                      : "border-border-interactive text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "rounded-full px-2 text-xs font-medium",
                      counts[t.key] > 0 && (t.key === "choose" || t.key === "clip" || t.key === "failed")
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-2 text-foreground"
                    )}
                  >
                    {counts[t.key]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* master–detail: ซ้าย = รายการ · ขวา = รายละเอียดงานที่เลือก (เลื่อนแยกกันที่ lg:) ·
              ต่ำกว่า lg: แสดงทีละฝั่ง — ไม่มี ?job = รายการ · มี ?job = รายละเอียดพร้อมปุ่มกลับ */}
          <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
            <div className={cn("min-w-0 lg:w-96 lg:shrink-0 lg:overflow-y-auto lg:pr-1", explicitJob !== null && "hidden lg:block")}>
              {tabJobs.length === 0 ? (
                <p className="text-sm leading-relaxed text-muted-foreground">ไม่มีงานในแท็บนี้</p>
              ) : (
                <FlowJobList
                  jobs={tabJobs}
                  selectedId={detailJob?.id ?? null}
                  renderEnabled={worker.renderEnabled}
                  onSelect={selectJob}
                  groupByDayFrom={tab === "closed" ? now : null}
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
                  pausedReason={worker.pausedReason}
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
