"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, ChevronDown, Download, Eraser, ImageIcon, RotateCcw, SkipForward, Play } from "lucide-react";

import {
  approveFlowRender,
  finishRenderManually,
  retryFlowUpscale,
  chooseFlowCandidate,
  generateWithAI,
  logFlowPromptNow,
  redoFlowRound,
  resumeFlowWorker,
  skipFlowJob,
} from "@/app/actions";
import { GEMINI_MODELS } from "@/lib/gemini";
import type { FlowJobRow, FlowImageRow } from "@/lib/flow-queries";
import {
  ERROR_KIND_LABELS,
  EXTRA_PROMPT_MAX,
  FLOW_STATUS,
  STATUS_LABELS,
  STEP_LABELS,
  buildFlowPrompt,
  canApproveRender,
  canRetryUpscale,
  friendlyJobMessage,
  queueCategory,
  type QueueCategory,
  normalizeExtraPrompt,
  videoDownloadName,
  type FlowStatus,
} from "@/lib/flow-jobs";
import { playCompletionSound } from "@/lib/completion-sound";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { FlowLightbox } from "@/components/flow-lightbox";
import { FlowStepperCompact } from "@/components/flow-stepper";
import { ManualRenderPanel } from "@/components/manual-render-panel";

function badgeVariant(status: string): BadgeVariant {
  if (status.startsWith("review_")) return "warning";
  if (status === FLOW_STATUS.DONE) return "success";
  if (status === FLOW_STATUS.FAILED) return "danger";
  return "neutral";
}

function imgUrl(entryId: string, filename: string): string {
  return `/api/uploads/${entryId}/flow/${filename}`;
}

/** ชื่อรอบที่โชว์ใต้ชื่อสินค้า — รอบ 3/4 ไม่ใช่ "รอบวาด" จึงเรียกตามงานจริง */
const ROUND_LABELS: Record<number, string> = { 1: "รอบ 1", 2: "รอบ 2", 3: "ทำคลิป", 4: "โหลด 1080p" };

function timeLabel(d: Date | null): string {
  if (d === null) return "";
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

/** งานที่ต้องให้คนดู (รอเลือก/ดูคลิป + พัง) เปิดไว้เลย · บอทกำลังทำ/เสร็จ พับไว้ */
function expandedByDefault(cat: QueueCategory | null): boolean {
  return cat === "waitingUser" || cat === "failed";
}

export function FlowReviewRow({ job, renderEnabled, hidden = false }: { job: FlowJobRow; renderEnabled: boolean; hidden?: boolean }) {
  const category = queueCategory(job.status);
  const [expanded, setExpanded] = useState(expandedByDefault(category));
  // หมวดเปลี่ยน (เช่น บอทวาดเสร็จ → รอคุณเลือก) = กลับไปใช้ค่าเริ่มต้นของหมวดใหม่ · row ไม่ถูก remount
  // (ทุกหมวดอยู่ใน <ul> เดียวกัน key = job.id) เพราะ autoGenerateEntryId ด้านล่างต้องรอดผ่านการเปลี่ยนหมวดตอนเลือกรูปรอบ 2
  const [prevCategory, setPrevCategory] = useState(category);
  if (prevCategory !== category) {
    setPrevCategory(category);
    setExpanded(expandedByDefault(category));
  }
  const [selected, setSelected] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // ข้อความต่อท้ายพรอมต์ของ Flow — เริ่มจากค่าที่ใช้อยู่ของงาน (ติดจากรอบ 1 มารอบ 2 เอง) ใช้กับทั้ง "วาดใหม่"
  // และ "ใช้รูปนี้ → รอบ 2" · ล้างว่าง = กลับเป็นพรอมต์ตั้งต้นของบอท
  const [extra, setExtra] = useState(job.extraPrompt);
  // entryId ที่เพิ่งปิดงาน Flow รอบ 2 เสร็จ ให้ useEffect ด้านล่างยิง generateWithAI ต่อ —
  // ต้องแยกออกจาก startTransition ข้างบนจริงๆ (ไม่ใช่แค่ไม่ await) เพราะเรียก Server Action
  // ตัวที่สองซ้อนอยู่ใน startTransition เดียวกันแบบไม่ await ก็ยังโดนนับเป็น pending เดียวกัน
  // อยู่ดี (พิสูจน์แล้วจริงตอนทดสอบ: ปุ่มค้าง disabled ตลอด ~28 วิที่ generateWithAI ทำงาน)
  // ย้ายมาเป็น state → useEffect แยกจังหวะออกจาก transition เดิมชัดเจน ปุ่มถึงปลดล็อกไว
  const [autoGenerateEntryId, setAutoGenerateEntryId] = useState<string | null>(null);

  // รอบรูป = เลือก 1 ใน 4 · รอบคลิป = ดูตัวอย่างแล้วผ่าน/เรนเดอร์ใหม่ — หน้าตาคนละแบบ
  const isImageReview = job.status === FLOW_STATUS.REVIEW_R1 || job.status === FLOW_STATUS.REVIEW_R2;
  const isRenderReview = job.status === FLOW_STATUS.REVIEW_R3;
  const isUpscale = job.status === FLOW_STATUS.QUEUED_UPSCALE || job.status === FLOW_STATUS.RUNNING_UPSCALE;
  const source = job.sources[0] ?? null;
  // ค้างขั้นทำคลิปแบบที่บอทไม่ได้ทำอยู่ — ตอนปิด Render อัตโนมัติ งานพวกนี้ไม่มีใครมาหยิบต่อ ผู้ใช้ต้องทำเองแล้วปิดงาน
  const isStuckInRender =
    job.status === FLOW_STATUS.AWAITING_PROMPT ||
    job.status === FLOW_STATUS.QUEUED_R3 ||
    job.status === FLOW_STATUS.REVIEW_R3 ||
    (job.status === FLOW_STATUS.FAILED && job.round >= 3);
  // รูป 2 รูปที่เลือกไว้ สำหรับแผงทำคลิปเอง (รอบ 1 = พื้นหลังขาว · รอบ 2 = ตอนใช้งาน)
  const manualImages = [job.chosenRound1, job.chosenRound2].flatMap((c, i) =>
    c
      ? [{
          id: c.id,
          src: imgUrl(job.entryId, c.filename),
          label: i === 0 ? "รูปพื้นหลังขาว" : "รูปตอนใช้งาน",
          downloadName: `${job.productName.slice(0, 40)}-${i === 0 ? "white" : "inuse"}${c.filename.slice(c.filename.lastIndexOf("."))}`,
        }]
      : []
  );

  const thumb = job.chosenRound2 ?? job.chosenRound1 ?? job.candidates[job.candidates.length - 1] ?? null;

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      }
    });
  }

  /**
   * เลือกรูปรอบ 2 เสร็จ (ปิดงาน Flow) → ต่อด้วยสกัดสเปก/สร้าง 10-part prompt/caption ให้เอง
   * ทันที ไม่ต้องกดปุ่ม "สร้างด้วย AI" เอง — แค่ตั้ง autoGenerateEntryId ไว้ ตัว useEffect
   * ด้านล่างเป็นคนยิง generateWithAI จริง (นอก transition นี้) ปุ่มจึงปลดล็อกทันทีที่
   * chooseFlowCandidate เสร็จ ไม่ต้องรอ generateWithAI ด้วย — ไปเลือกรูปสินค้าตัวถัดไปต่อได้เลย
   *
   * ถ้าพัง (เช่น ยังไม่ได้ตั้ง Core Prompt) ตั้งใจไม่โชว์ error ค้างจอที่นี่ — เสียงพอ ("ป๊อก")
   * entry จะไปอยู่ในตัวกรอง "ยังไม่มี prompt" ที่หน้ารายการเองอยู่แล้วให้เช็กย้อนหลังได้
   * (ตัดสินใจแล้วตอนบรีฟฟีเจอร์นี้ — ไม่เพิ่มสถานะ/ฟิลด์ใหม่สำหรับเคสนี้)
   */
  function chooseAndMaybeAutoGenerate(imageId: string) {
    const isRound2Completion = job.status === FLOW_STATUS.REVIEW_R2;
    setError(null);
    startTransition(async () => {
      try {
        await chooseFlowCandidate(job.id, imageId, isRound2Completion ? undefined : extra);
        if (isRound2Completion) setAutoGenerateEntryId(job.entryId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      }
    });
  }

  // ยิง generateWithAI จริงตรงนี้ — อยู่นอก startTransition ข้างบนโดยสมบูรณ์ ปุ่มเลือกรูปจึง
  // ไม่ถูกนับรวมเป็น pending เดียวกัน (ดูคอมเมนต์ที่ autoGenerateEntryId ด้านบน)
  useEffect(() => {
    if (autoGenerateEntryId === null) return;
    const entryId = autoGenerateEntryId;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoGenerateEntryId(null);
    // ลองซ้ำเอง 1 ครั้งหลัง 10 วิ — เจอจริง 2026-09-30: Gemini ล้มกลางทาง ("Unexpected HTTP client error") ครั้งเดียว
    // แล้วงานค้าง "รอ 10-part prompt" เป็นชั่วโมงเพราะไม่มีใครกดใหม่ · Render เริ่มเองทันทีที่พรอมต์บันทึกสำเร็จ
    generateWithAI(entryId, GEMINI_MODELS[0].id)
      .catch(() => new Promise((r) => setTimeout(r, 10_000)).then(() => generateWithAI(entryId, GEMINI_MODELS[0].id)))
      .then(() => playCompletionSound("success"))
      .catch(() => playCompletionSound("error"));
  }, [autoGenerateEntryId]);

  // ข้อความที่ใช้วาดชุดที่โชว์อยู่ (ทุกรูปในชุดเดียวกันใช้ข้อความเดียวกัน) · รอบคลิปดูจากคลิปตัวอย่าง
  const usedExtra = (isRenderReview ? job.video?.promptExtra : job.candidates[0]?.promptExtra) ?? "";
  const lightboxItems = job.candidates.map((c, i) => ({ src: imgUrl(job.entryId, c.filename), label: `รูป ${i + 1}` }));

  return (
    <li className={cn("flex flex-col gap-3 border-b border-border py-2", hidden && "hidden")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "พับ" : "ขยาย"}งาน ${job.productName}`}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-1 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {thumb ? (
            <Image src={imgUrl(job.entryId, thumb.filename)} alt="" width={96} height={128} className="size-12 shrink-0 rounded-md border border-border object-cover" />
          ) : (
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted-foreground">
              <ImageIcon className="size-5" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-1 lg:flex-row lg:items-center lg:gap-4">
            <span className="truncate font-semibold leading-relaxed text-foreground lg:flex-1">{job.productName}</span>
            <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
              <FlowStepperCompact
                status={job.status}
                round={job.round}
                imagesOnly={job.status === FLOW_STATUS.DONE && !renderEnabled && job.video === null}
              />
              <Badge variant={badgeVariant(job.status)}>{STATUS_LABELS[job.status as FlowStatus] ?? job.status}</Badge>
            </span>
          </span>
          <ChevronDown aria-hidden="true" className={cn("size-5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        </button>
        {!expanded && job.status === FLOW_STATUS.DONE && job.video && (
          <a
            href={imgUrl(job.entryId, job.video.filename)}
            download={videoDownloadName(job.productName)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Download data-icon="inline-start" /> ดาวน์โหลดคลิป
          </a>
        )}
      </div>

      {expanded && (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <Link href={`/entry/${job.entryId}`} className="text-primary underline-offset-4 hover:underline">
              เปิดหน้า entry →
            </Link>
            {" · "}เข้าคิว {timeLabel(job.createdAt)}
            {job.startedAt ? ` · เริ่ม${ROUND_LABELS[job.round] ?? `รอบ ${job.round}`} ${timeLabel(job.startedAt)}` : ""}
            {job.attempt > 1 ? ` · ครั้งที่ ${job.attempt}` : ""}
          </p>

      <div className="flex flex-col gap-3">
        {isImageReview && (
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-wrap items-start gap-3">
              {source && (
                <figure className="flex w-24 flex-col gap-1 lg:w-32">
                  <Image
                    src={imgUrl(job.entryId, source.filename)}
                    alt="รูปแคปต้นทาง"
                    width={400}
                    height={533}
                    className="aspect-[3/4] w-24 rounded-md border border-border object-cover lg:w-32"
                  />
                  <figcaption className="text-xs leading-relaxed text-muted-foreground">รูปแคป</figcaption>
                </figure>
              )}
              <div className="flex flex-wrap gap-2">
                {job.candidates.map((c: FlowImageRow, i: number) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={selected === c.id}
                    aria-label={`เลือกรูป ${i + 1}`}
                    onClick={() => setSelected(c.id)}
                    onDoubleClick={() => setLightbox(i)}
                    className={cn(
                      "relative w-28 overflow-hidden rounded-md border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:w-36",
                      selected === c.id ? "border-primary" : "border-border-interactive"
                    )}
                  >
                    <Image
                      src={imgUrl(job.entryId, c.filename)}
                      alt={`รูปที่วาด ${i + 1}`}
                      width={400}
                      height={533}
                      className="aspect-[3/4] w-full object-cover"
                    />
                    {selected === c.id && (
                      <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                        <Check className="size-4" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-w-0 flex-1 basis-72 flex-col gap-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {usedExtra === "" ? "ชุดนี้วาดด้วยพรอมต์ตั้งต้น" : `ชุดนี้วาดด้วยข้อความเพิ่มเติม: “${usedExtra}”`}
            </p>
            <ExtraPromptField
              id={`extra-${job.id}`}
              label="ข้อความเพิ่มเติมถึง Flow (ใช้กับครั้งถัดไป — วาดใหม่ หรือรอบ 2)"
              placeholder="เช่น เอาแค่แผ่นเดียว"
              value={extra}
              onChange={setExtra}
              disabled={isPending}
              preview={`พรอมต์ที่จะส่งถ้ากดวาดใหม่: ${buildFlowPrompt(job.round === 2 ? 2 : 1, job.productName, normalizeExtraPrompt(extra))}`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={selected === null || isPending}
                onClick={() => selected && chooseAndMaybeAutoGenerate(selected)}
              >
                {job.status === FLOW_STATUS.REVIEW_R1
                  ? "ใช้รูปนี้ → ให้บอทวาดรอบ 2"
                  : renderEnabled
                    ? "ใช้รูปนี้ → สร้างพรอมต์แล้วทำคลิป"
                    : "ใช้รูปนี้ → บันทึกรูปและสร้างพรอมต์"}
              </Button>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => redoFlowRound(job.id, extra))}>
                <RotateCcw data-icon="inline-start" /> ไม่ผ่านสักรูป วาดใหม่
              </Button>
              <Button type="button" variant="ghost" disabled={job.candidates.length === 0} onClick={() => setLightbox(0)}>
                ขยายเทียบกับรูปแคป
              </Button>
            </div>
            </div>
          </div>
        )}

        {isRenderReview && (
          <div className="flex flex-wrap items-start gap-4">
            {job.video ? (
              <ClipPlayer entryId={job.entryId} filename={job.video.filename} productName={job.productName} size="lg" />
            ) : (
              <div className="flex flex-col gap-2 rounded-md border-l-4 border-status-warning bg-surface-2 p-3 leading-relaxed">
                <p className="text-sm font-medium text-foreground">คลิปเสร็จแล้วใน Flow แต่โหลดมาไม่ได้</p>
                <JobMessage status={job.status} message={job.errorMessage} />
                <p className="text-xs text-muted-foreground">
                  เปิดโปรเจกต์ในบัญชีสำรองแล้วโหลดเอง (⋯ → Download → 1080p) แล้วกดปิดงาน · หรือกด &quot;เรนเดอร์ใหม่&quot; ซึ่งจะสร้างคลิปใหม่อีกตัวและเสีย 15 เครดิต
                </p>
                {job.flowProjectId && (
                  <a
                    className="text-sm text-primary underline-offset-4 hover:underline"
                    href={`https://flow.google.com/project/${job.flowProjectId}?hl=en`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    เปิดโปรเจกต์ใน Flow →
                  </a>
                )}
              </div>
            )}
            <div className="flex min-w-0 flex-1 basis-72 flex-col gap-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                ตัวอย่าง 720p — กดผ่านแล้วบอทจะโหลดไฟล์ 1080p ให้ ·{" "}
                {usedExtra === "" ? "ทำจาก 10-part prompt อย่างเดียว" : `ทำจาก 10-part prompt + “${usedExtra}”`}
              </p>
              <ExtraPromptField
                id={`extra-${job.id}`}
                label="ข้อความเพิ่มเติมต่อท้าย 10-part prompt (ใช้ถ้ากดเรนเดอร์ใหม่)"
                placeholder="เช่น ห้ามมีคนในฉาก"
                value={extra}
                onChange={setExtra}
                disabled={isPending}
                preview={`พรอมต์ที่จะส่งถ้ากดเรนเดอร์ใหม่: 10-part prompt ของงานนี้${
                  normalizeExtraPrompt(extra) === "" ? "" : ` + “${normalizeExtraPrompt(extra)}”`
                }`}
              />
              {/* มีไฟล์แต่มีข้อความ (เช่น ได้แค่ 720p เพราะโหลด 1080p ไม่ได้) ต้องโชว์ด้วย */}
              {job.video && <JobMessage status={job.status} message={job.errorMessage} />}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={isPending || !canApproveRender(job.status, job.video !== null)} onClick={() => run(() => approveFlowRender(job.id))}>
                  <Check data-icon="inline-start" /> ผ่าน
                </Button>
                <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => redoFlowRound(job.id, extra))}>
                  <RotateCcw data-icon="inline-start" /> เรนเดอร์ใหม่
                </Button>
                {job.video === null && (
                  <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => finishRenderManually(job.id))}>
                    <Check data-icon="inline-start" /> โหลดเองแล้ว — ปิดงานนี้
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Render อัตโนมัติปิดอยู่: งานที่ค้างขั้นทำคลิป (ส่วนใหญ่ค้างมาจากก่อนปิด) ให้ทำคลิปเองแล้วกดปิดงาน */}
        {!renderEnabled && isStuckInRender && (
          <ManualRenderPanel
            entryId={job.entryId}
            prompt={job.prompt}
            images={manualImages}
            onFinish={() => run(() => finishRenderManually(job.id))}
            finishDisabled={isPending}
          />
        )}

        {renderEnabled && job.status === FLOW_STATUS.AWAITING_PROMPT && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm leading-relaxed text-muted-foreground">
              รอ Angle สร้าง 10-part prompt แล้วบอทจะทำคลิปต่อเอง — ถ้าค้างนาน กดสร้างใหม่ได้เลย
            </p>
            {/* ไม่ต้องไปหน้างาน — สร้างพรอมต์จากตรงนี้ได้ทันที (generateWithAI ส่งงานเข้าคิว Render เองเมื่อสำเร็จ) */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                run(async () => {
                  await generateWithAI(job.entryId, GEMINI_MODELS[0].id);
                  await logFlowPromptNow(job.entryId);
                })
              }
            >
              <RotateCcw data-icon="inline-start" /> {isPending ? "กำลังสร้างพรอมต์..." : "สร้างพรอมต์ตอนนี้"}
            </Button>
          </div>
        )}

        {isUpscale && (
          <div className="flex flex-wrap items-start gap-3">
            {job.video && (
              <ClipPlayer entryId={job.entryId} filename={job.video.filename} productName={job.productName} size="md" />
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">ผ่านแล้ว — บอทกำลังโหลดไฟล์ 1080p</p>
          </div>
        )}

        {job.status === FLOW_STATUS.FAILED && (
          <div className="flex flex-col gap-2 rounded-md border-l-4 border-status-danger bg-surface-2 p-3 leading-relaxed">
            <p className="text-sm font-medium text-foreground">
              พังที่ขั้น &quot;{STEP_LABELS[job.failedStep] ?? job.failedStep}&quot; — {ERROR_KIND_LABELS[job.errorKind] ?? job.errorKind}
            </p>
            <JobMessage status={job.status} message={job.errorMessage} />
            {job.video && (
              <ClipPlayer entryId={job.entryId} filename={job.video.filename} productName={job.productName} size="md" />
            )}
            {job.failureDir && (
              <p className="text-xs text-muted-foreground">
                หลักฐาน:{" "}
                <a className="underline" href={`/api/${job.failureDir}/screenshot.png`} target="_blank" rel="noreferrer">screenshot</a>
                {" · "}
                <a className="underline" href={`/api/${job.failureDir}/steps.log`} target="_blank" rel="noreferrer">steps.log</a>
                {" · "}
                <a className="underline" href={`/api/${job.failureDir}/page.html`} target="_blank" rel="noreferrer">page.html</a>
                {" · โฟลเดอร์ "}<code className="text-xs">{job.failureDir}</code>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={isPending} onClick={() => run(() => resumeFlowWorker(job.id))}>
                <Play data-icon="inline-start" /> รันต่อ (หลังซ่อม)
              </Button>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => skipFlowJob(job.id))}>
                <SkipForward data-icon="inline-start" /> ข้ามงานนี้
              </Button>
            </div>
          </div>
        )}

        {/* งานรูปจบแล้ว ยังไม่มีคลิป และบอทไม่ทำคลิปให้ → ยื่นของสำหรับทำคลิปเองใน Flow บัญชีหลัก */}
        {job.status === FLOW_STATUS.DONE && !renderEnabled && job.video === null && (
          <ManualRenderPanel entryId={job.entryId} prompt={job.prompt} images={manualImages} collapsed />
        )}

        {job.status === FLOW_STATUS.DONE && (renderEnabled || job.video !== null) && (
          <div className="flex flex-wrap items-center gap-3">
            {[job.chosenRound1, job.chosenRound2].map((c, i) =>
              c ? (
                <Image
                  key={c.id}
                  src={imgUrl(job.entryId, c.filename)}
                  alt={i === 0 ? "รูปที่เลือก พื้นหลังขาว" : "รูปที่เลือก ตอนใช้งาน"}
                  width={400}
                  height={533}
                  className="aspect-[3/4] w-20 rounded-md border-2 border-status-success object-cover lg:w-28"
                />
              ) : null
            )}
            {job.video && (
              <ClipPlayer entryId={job.entryId} filename={job.video.filename} productName={job.productName} size="md" done />
            )}
            {job.video && (
              <div className="basis-full">
                <JobMessage status={job.status} message={job.errorMessage} />
              </div>
            )}
            {canRetryUpscale(job.status, job.video, job.flowProjectId) && (
              <div className="flex basis-full flex-wrap items-center gap-3">
                <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => retryFlowUpscale(job.id))}>
                  <RotateCcw data-icon="inline-start" /> ลองโหลด 1080p อีกครั้ง
                </Button>
                <span className="text-sm leading-relaxed text-muted-foreground">ไม่เสียเครดิต ไม่เรนเดอร์ใหม่ — บอทไปโหลดคลิปเดิมจาก Flow</span>
              </div>
            )}
            <Link href={`/entry/${job.entryId}`} className="text-sm leading-relaxed text-primary underline-offset-4 hover:underline">
              ไปหน้า entry ดู prompt ที่สร้างให้แล้ว →
            </Link>
          </div>
        )}

        {!isUpscale && (job.status.startsWith("queued_") || job.status.startsWith("running_")) && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {job.status.startsWith("running_") ? "บอทกำลังทำอยู่ตอนนี้" : "รอบอทหยิบงาน"}
          </p>
        )}

        {/* ภาพจุดเช็ก 4 จุดของครั้งล่าสุด — ย้อนดูว่าบอทตั้งค่า/แนบรูป/พิมพ์พรอมต์ถูกไหม (ลบเองหลัง 14 วัน) */}
        {job.checkpoints.length > 0 && (
          <details className="text-sm leading-relaxed">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              ดูขั้นตอนที่บอททำ ({job.checkpoints.length} ภาพ)
            </summary>
            <div className="mt-2 flex flex-wrap gap-3">
              {job.checkpoints.map((c) => (
                <a key={c.path} href={`/api/uploads/${c.path}`} target="_blank" rel="noreferrer" className="flex w-56 flex-col gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/uploads/${c.path}`}
                    alt={c.label}
                    loading="lazy"
                    className="aspect-video w-full rounded-md border border-border object-cover object-bottom"
                  />
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                </a>
              ))}
            </div>
          </details>
        )}

        {error && <p className="text-xs leading-relaxed text-destructive">{error}</p>}
      </div>
        </>
      )}

      {lightbox !== null && source && isImageReview && (
        <FlowLightbox
          source={{ src: imgUrl(job.entryId, source.filename), label: "รูปแคปต้นทาง" }}
          items={lightboxItems}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </li>
  );
}

/**
 * ช่องข้อความเพิ่มเติมที่ต่อท้ายพรอมต์ของครั้งถัดไป + ปุ่มล้าง + ตัวอย่างพรอมต์ — ใช้ร่วมทั้งรอบรูปและรอบคลิป
 * (รอบคลิปไม่พิมพ์ 10-part prompt ทั้งก้อน ~3,000 ตัวลงหน้า โชว์แค่ส่วนที่ต่อท้าย)
 */
function ExtraPromptField({
  id,
  label,
  placeholder,
  value,
  onChange,
  disabled,
  preview,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  preview: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm leading-relaxed text-foreground">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="text"
          value={value}
          maxLength={EXTRA_PROMPT_MAX}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-md border border-border-interactive bg-background px-3 text-sm lg:h-9"
        />
        <Button type="button" variant="outline" disabled={value === "" || disabled} onClick={() => onChange("")}>
          <Eraser data-icon="inline-start" /> ล้าง กลับเป็นข้อความเดิม
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{preview}</p>
    </div>
  );
}

/** เครื่องเล่นคลิป + ปุ่มดาวน์โหลด — ใช้กับทุกแถวที่มีไฟล์วิดีโอ (ดูตัวอย่าง/รอโหลด 1080p/พัง/เสร็จ) */
function ClipPlayer({
  entryId,
  filename,
  productName,
  size,
  done = false,
}: {
  entryId: string;
  filename: string;
  productName: string;
  size: "md" | "lg";
  done?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <video
        src={imgUrl(entryId, filename)}
        controls
        preload="metadata"
        className={cn(
          "aspect-[9/16] rounded-md bg-surface-2",
          done ? "border-2 border-status-success" : "border border-border",
          size === "lg" ? "w-48 lg:w-56" : "w-28 lg:w-36"
        )}
      />
      <a
        href={imgUrl(entryId, filename)}
        download={videoDownloadName(productName)}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <Download data-icon="inline-start" /> ดาวน์โหลดคลิป
      </a>
    </div>
  );
}

/** ข้อความของงานแบบอ่านง่าย 1 บรรทัด + ข้อความดิบเต็มพับไว้ใน "รายละเอียด" */
function JobMessage({ status, message }: { status: string; message: string }) {
  const { summary, detail } = friendlyJobMessage(status, message);
  if (summary === "") return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs leading-relaxed text-muted-foreground">{summary}</p>
      {detail !== null && (
        <details className="text-xs leading-relaxed text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">รายละเอียด</summary>
          <pre className="mt-1 max-w-full whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 text-xs leading-relaxed">{detail}</pre>
        </details>
      )}
    </div>
  );
}
