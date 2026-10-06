"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Hand, ImageUp, RotateCcw, SkipForward, Play } from "lucide-react";

import {
  approveFlowRender,
  changeFlowSource,
  retryFlowUpscale,
  chooseFlowCandidate,
  generateWithAI,
  logFlowPromptNow,
  redoFlowRound,
  resumeFlowWorker,
  unpauseQueueOnly,
  skipFlowJob,
  takeOverFlowJob,
} from "@/app/actions";
import { GEMINI_MODELS } from "@/lib/gemini";
import type { FlowJobRow, FlowImageRow } from "@/lib/flow-queries";
import {
  FLOW_STATUS,
  STATUS_LABELS,
  STEP_LABELS,
  buildFlowPrompt,
  currentSourceImage,
  FINAL_VIDEO_FILENAME,
  flowProjectUrl,
  normalizeExtraPrompt,
  type FlowStatus,
} from "@/lib/flow-jobs";
import { botMovedOnNote, canUnpauseQueueOnly, pausedReasonLabel, canApproveRender, canChangeSource, canRerenderWithPrompt, canRetryUpscale, canTakeOver, isBotWorking, isInRenderStage, isWaitingForBot, promptSaveGate } from "@/lib/flow-lifecycle";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlowLightbox } from "@/components/flow-lightbox";
import { FlowStepperCompact } from "@/components/flow-stepper";
import { ManualRenderPanel } from "@/components/manual-render-panel";
import { BotSteps, ClipLayout, ExportToFolder, PromptCard, ReadyToPostCard, UsedImages } from "@/components/flow-clip-layout";
import { ProductIdCopy } from "@/components/product-id-copy";
import { ShowcasePhotoPicker, shopPhotoSrc } from "@/components/showcase-photo-picker";
import { ClipPlayer, ExtraPromptField, FlowProjectLink, JobMessage, ROUND_LABELS, badgeVariant, imgUrl, timeLabel } from "@/components/flow-job-parts";

/**
 * รายละเอียดของงานที่เลือก (ฝั่งขวาของหน้า /flow) · mount ทีละงาน (key = job.id จากคนเรียก)
 * การยิง generateWithAI หลังเลือกรูปรอบ 2 ไม่ได้อยู่ที่นี่แล้ว — ส่งต่อให้ FlowRoute ผ่าน onRound2Chosen
 * เพราะแผงนี้ถูก unmount ได้ทันทีที่ผู้ใช้กดไปงานอื่น ขณะที่ chooseFlowCandidate ยังไม่เสร็จ
 */
export function FlowJobDetail({
  job,
  renderEnabled,
  workerAlive,
  queuePaused,
  pausedReason,
  onRound2Chosen,
  onBack,
  onNext,
}: {
  job: FlowJobRow;
  renderEnabled: boolean;
  /** บอทส่ง heartbeat อยู่ไหม — งาน running_* ตอนบอทไม่อยู่ = ค้าง ต้องบอกผู้ใช้ ไม่ใช่ "กำลังทำ" */
  workerAlive: boolean;
  /** คิวหยุดอยู่ไหม — งานที่พังตอนคิวไม่หยุด (บอทข้ามไปงานอื่น) ขึ้นหมายเหตุสั้นๆ แทนคำเตือนหยุดคิว */
  queuePaused: boolean;
  /** เหตุที่คิวหยุด ("" = ไม่หยุด) — ตัดสินว่าโชว์ปุ่ม ให้บอททำงานอื่นต่อ ไหม */
  pausedReason: string;
  onRound2Chosen: (entryId: string) => void;
  onBack: () => void;
  /** null = ไม่มีงานอื่นที่รอคุณ */
  onNext: (() => void) | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ผลของ "ทำต่อเอง" ครั้งนี้ — โฟลเดอร์ TTS ที่สร้างให้ หรือเหตุที่สร้างไม่สำเร็จ (งานจบแล้วเสมอ ไม่ว่าสร้างโฟลเดอร์ได้ไหม)
  const [takeoverResult, setTakeoverResult] = useState<{ exportPath: string | null; exportError: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();
  // ข้อความต่อท้ายพรอมต์ของ Flow — เริ่มจากค่าที่ใช้อยู่ของงาน (ติดจากรอบ 1 มารอบ 2 เอง) ใช้กับทั้ง "วาดใหม่"
  // และ "ใช้รูปนี้ → รอบ 2" · ล้างว่าง = กลับเป็นพรอมต์ตั้งต้นของบอท
  const [extra, setExtra] = useState(job.extraPrompt);
  // ตัวเลือกรูปต้นทางใหม่ (เปลี่ยนรูปต้นทาง) เปิดอยู่ไหม
  const [pickingSource, setPickingSource] = useState(false);

  // รอบรูป = เลือก 1 ใน 4 · รอบคลิป = ดูตัวอย่างแล้วผ่าน/เรนเดอร์ใหม่ — หน้าตาคนละแบบ
  const isImageReview = job.status === FLOW_STATUS.REVIEW_R1 || job.status === FLOW_STATUS.REVIEW_R2;
  const isRenderReview = job.status === FLOW_STATUS.REVIEW_R3;
  const isUpscale = job.status === FLOW_STATUS.QUEUED_UPSCALE || job.status === FLOW_STATUS.RUNNING_UPSCALE;
  const stalled = !workerAlive && isBotWorking(job.status);
  const source = currentSourceImage(job.sources);
  // เปลี่ยนรูปต้นทางได้ตั้งแต่รอเลือกรูปรอบ 1 จนก่อนเริ่มเรนเดอร์ (gate เดียวกับ action) — นอกนั้นซ่อนปุ่ม
  const sourceChangeable = canChangeSource(job.status, job.round);
  const selectedId = job.candidates.some((c) => c.id === selected) ? selected : null;
  // ค้างขั้นทำคลิปแบบที่บอทไม่ได้ทำอยู่ — ตอนปิด Render อัตโนมัติ งานพวกนี้ไม่มีใครมาหยิบต่อ ผู้ใช้ต้องทำเองแล้วปิดงาน
  const isStuckInRender = isInRenderStage(job.status, job.round) && canTakeOver(job.status);
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

  function run(action: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      }
    });
  }

  /** "ทำต่อเอง": จบงานทันที + สร้างโฟลเดอร์ TTS ให้ (ไม่มี confirm — กดครั้งเดียวตามที่ตกลงไว้) · บอทหยิบไปก่อน = โชว์ข้อความ */
  function takeOverNow() {
    setError(null);
    setTakeoverResult(null);
    startTransition(async () => {
      try {
        const r = await takeOverFlowJob(job.id);
        if (!r.taken) setError(r.message ?? "ทำต่อเองไม่สำเร็จ");
        else setTakeoverResult({ exportPath: r.exportPath, exportError: r.exportError });
      } catch (e) {
        setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      }
    });
  }

  /** "เปลี่ยนรูปต้นทาง": งานเดิมกลับไปรอวาดรอบ 1 ด้วยรูปใหม่ · บอทหยิบไปก่อน/สถานะเปลี่ยน = โชว์ข้อความ (ไม่ throw) */
  function changeSourceTo(photo: File, extraForNew: string) {
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("jobId", job.id);
        formData.set("photo", photo);
        formData.set("extraPrompt", extraForNew);
        const r = await changeFlowSource(formData);
        if (!r.changed) setError(r.message ?? "เปลี่ยนรูปต้นทางไม่สำเร็จ");
      } catch (e) {
        setError(e instanceof Error ? e.message : "เปลี่ยนรูปต้นทางไม่สำเร็จ");
      }
      setPickingSource(false);
    });
  }

  /**
   * เลือกรูปรอบ 2 เสร็จ (ปิดงาน Flow) → ต่อด้วยสกัดสเปก/สร้าง 10-part prompt/caption ให้เอง
   * ทันที ไม่ต้องกดปุ่ม "สร้างด้วย AI" เอง — แค่แจ้ง FlowRoute (onRound2Chosen) ตัวนั้นเป็นคนยิง
   * generateWithAI จริงนอก transition นี้ ปุ่มจึงปลดล็อกทันทีที่ chooseFlowCandidate เสร็จ
   * (ถ้ายิงซ้อนใน transition เดียวกัน ปุ่มจะค้าง disabled ตลอดที่ generateWithAI ทำงาน ~28 วิ — พิสูจน์แล้วจริง)
   *
   * ถ้าพัง (เช่น ยังไม่ได้ตั้ง Core Prompt) ตั้งใจไม่โชว์ error ค้างจอ — เสียงพอ ("ป๊อก")
   * entry จะไปอยู่ในตัวกรอง "ยังไม่มี prompt" ที่หน้ารายการเองอยู่แล้วให้เช็กย้อนหลังได้
   */
  function chooseAndMaybeAutoGenerate(imageId: string) {
    const isRound2Completion = job.status === FLOW_STATUS.REVIEW_R2;
    setError(null);
    startTransition(async () => {
      try {
        await chooseFlowCandidate(job.id, imageId);
        if (isRound2Completion) onRound2Chosen(job.entryId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
      }
    });
  }

  // ข้อความที่ใช้วาดชุดที่โชว์อยู่ (ทุกรูปในชุดเดียวกันใช้ข้อความเดียวกัน) · รอบคลิปดูจากคลิปตัวอย่าง
  const usedExtra = (isRenderReview ? job.video?.promptExtra : job.candidates[0]?.promptExtra) ?? "";
  const lightboxItems = job.candidates.map((c, i) => ({ src: imgUrl(job.entryId, c.filename), label: `รูป ${i + 1}` }));

  // งานคลิปที่มีไฟล์ → หน้า 3 โซนที่ lg: (คลิป · สถานะ/ปุ่ม · พร้อมโพสต์/พรอมต์) — ดู components/flow-clip-layout.tsx
  const clipFile = job.video?.filename ?? null;
  const clipLayout =
    clipFile !== null && (isRenderReview || isUpscale || job.status === FLOW_STATUS.DONE);

  // ช่องแก้ 10-part prompt: แก้ได้ (queued_r3 / review_r3 / failed รอบ 3) · running_r3 อ่านอย่างเดียว · ตัวที่ review_r3 มีคลิปอยู่ใน ClipLayout (โซนขวา)
  const promptGate = promptSaveGate(job.status, job.round);
  const showStandalonePrompt = promptGate !== "refused" && !(isRenderReview && clipLayout) && !(!renderEnabled && isStuckInRender);

  const approveButtons = (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={isPending || !canApproveRender(job.status, job.video !== null)} onClick={() => run(() => approveFlowRender(job.id))}>
        <Check data-icon="inline-start" /> ผ่าน
      </Button>
      <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => redoFlowRound(job.id, extra))}>
        <RotateCcw data-icon="inline-start" /> เรนเดอร์ใหม่
      </Button>
    </div>
  );

  return (
    <article className={cn("flex min-w-0 flex-col gap-4", clipLayout && "lg:h-full")}>
      <header className="flex flex-col gap-3 border-b border-border pb-3">
        <Button type="button" variant="ghost" size="sm" className="self-start lg:hidden" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" /> กลับไปรายการ
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-lg leading-relaxed font-semibold text-foreground">{job.productName}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <Link href={`/entry/${job.entryId}`} className="text-primary underline-offset-4 hover:underline">
                เปิดหน้า entry →
              </Link>
              {" · "}เข้าคิว {timeLabel(job.createdAt)}
              {job.startedAt ? ` · เริ่ม${ROUND_LABELS[job.round] ?? `รอบ ${job.round}`} ${timeLabel(job.startedAt)}` : ""}
              {job.attempt > 1 ? ` · ครั้งที่ ${job.attempt}` : ""}
            </p>
            <FlowProjectLink jobId={job.id} flowProjectId={job.flowProjectId} status={job.status} />
            {job.productId !== null && <ProductIdCopy productId={job.productId} />}
          </div>
          {onNext && (
            <Button type="button" variant="outline" onClick={onNext}>
              งานถัดไปที่รอคุณ <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <FlowStepperCompact
            status={job.status}
            round={job.round}
            imagesOnly={job.status === FLOW_STATUS.DONE && !renderEnabled && job.video === null}
          />
          <Badge variant={badgeVariant(job.status)}>{STATUS_LABELS[job.status as FlowStatus] ?? job.status}</Badge>
          {job.tookOver && <Badge variant="neutral">ทำเอง</Badge>}
        </div>
        {canTakeOver(job.status) ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button type="button" variant="outline" disabled={isPending} onClick={takeOverNow}>
              <Hand data-icon="inline-start" /> ทำต่อเอง
            </Button>
            <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
              ทำงานนี้เองใน Flow — จบงานทันที บอทไม่แตะอีก และสร้างโฟลเดอร์ TTS ให้
            </span>
          </div>
        ) : (
          isBotWorking(job.status) && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              บอทกำลังทำงานนี้ — กด ทำต่อเอง{job.round <= 2 ? " / เปลี่ยนรูปต้นทาง" : ""} ได้หลังบอททำเสร็จรอบนี้
            </p>
          )
        )}
        {sourceChangeable && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setPickingSource(true)}>
              <ImageUp data-icon="inline-start" /> เปลี่ยนรูปต้นทาง
            </Button>
            <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
              เลือกรูปจากร้าน{job.shopPhotos.length === 0 ? "หรือไฟล์จากเครื่อง" : ""} — งานกลับไปวาดรอบ 1 ใหม่ รูปที่วาดไปแล้วยังเก็บไว้
            </span>
          </div>
        )}
      </header>

      <div className={cn("flex flex-col gap-4", clipLayout && "lg:min-h-0 lg:flex-1")}>
        {isImageReview && (
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:gap-6">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
              {job.candidates.map((c: FlowImageRow, i: number) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={selectedId === c.id}
                  aria-label={`เลือกรูป ${i + 1}`}
                  onClick={() => setSelected(c.id)}
                  onDoubleClick={() => setLightbox(i)}
                  className={cn(
                    "relative overflow-hidden rounded-md border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    selectedId === c.id ? "border-primary" : "border-border-interactive"
                  )}
                >
                  <Image
                    src={imgUrl(job.entryId, c.filename)}
                    alt={`รูปที่วาด ${i + 1}`}
                    width={400}
                    height={533}
                    className="aspect-[3/4] w-full object-cover"
                  />
                  {selectedId === c.id && (
                    <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                      <Check className="size-4" />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex w-full min-w-0 flex-col gap-3 max-w-2xl 2xl:w-80 2xl:shrink-0">
              {source && (
                <figure className="flex flex-col gap-1">
                  <Image
                    src={imgUrl(job.entryId, source.filename)}
                    alt="รูปแคปต้นทาง"
                    width={400}
                    height={533}
                    className="aspect-[3/4] w-32 rounded-md border border-border object-cover 2xl:w-40"
                  />
                  <figcaption className="text-xs leading-relaxed text-muted-foreground">รูปแคป</figcaption>
                </figure>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {usedExtra === "" ? "ชุดนี้วาดด้วยพรอมต์ตั้งต้น" : `ชุดนี้วาดด้วยข้อความเพิ่มเติม: “${usedExtra}”`}
              </p>
              <ExtraPromptField
                id={`extra-${job.id}`}
                label="ข้อความเพิ่มเติมถึง Flow (ใช้กับ &quot;วาดใหม่&quot; ของรอบนี้เท่านั้น — รอบถัดไปเริ่มจากพรอมต์ตั้งต้นเสมอ)"
                placeholder="เช่น เอาแค่แผ่นเดียว"
                value={extra}
                onChange={setExtra}
                disabled={isPending}
                preview={`พรอมต์ที่จะส่งถ้ากดวาดใหม่: ${buildFlowPrompt(job.round === 2 ? 2 : 1, job.productName, normalizeExtraPrompt(extra))}`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={selectedId === null || isPending}
                  onClick={() => selectedId && chooseAndMaybeAutoGenerate(selectedId)}
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

        {isRenderReview && clipLayout && clipFile !== null && (
          <ClipLayout
            job={job}
            filename={clipFile}
            middle={
              <>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  ตัวอย่าง 720p — กดผ่านแล้วบอทจะโหลดไฟล์ 1080p ให้
                </p>
                {/* มีไฟล์แต่มีข้อความ (เช่น ได้แค่ 720p เพราะโหลด 1080p ไม่ได้) ต้องโชว์ด้วย */}
                <JobMessage status={job.status} message={job.errorMessage} />
                {approveButtons}
                <ExtraPromptField
                  id={`extra-${job.id}`}
                  label="ข้อความเพิ่มเติมต่อท้ายพรอมต์ (ใช้ถ้ากดเรนเดอร์ใหม่)"
                  placeholder="เช่น ห้ามมีคนในฉาก"
                  value={extra}
                  onChange={setExtra}
                  disabled={isPending}
                  preview={`ส่งถ้ากดเรนเดอร์ใหม่: พรอมต์ของงานนี้${
                    normalizeExtraPrompt(extra) === "" ? "" : ` + “${normalizeExtraPrompt(extra)}”`
                  }`}
                />
                <UsedImages job={job} />
                <BotSteps checkpoints={job.checkpoints} />
              </>
            }
            right={<PromptCard job={job} usedExtra={usedExtra} mode="edit" canRerender={canRerenderWithPrompt(job.status)} extraPrompt={extra} disabled={isPending} />}
          />
        )}

        {isRenderReview && !clipLayout && (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
            {job.video ? (
              <ClipPlayer entryId={job.entryId} filename={job.video.filename} productName={job.productName} size="lg" />
            ) : (
              <div className="flex flex-col gap-2 rounded-md border-l-4 border-status-warning bg-surface-2 p-3 leading-relaxed lg:max-w-90">
                <p className="text-sm font-medium text-foreground">คลิปเสร็จแล้วใน Flow แต่โหลดมาไม่ได้</p>
                <JobMessage status={job.status} message={job.errorMessage} />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  เปิดโปรเจกต์ในบัญชีสำรองแล้วโหลดเอง (⋯ → Download → 1080p) แล้วกดปิดงาน · หรือกด &quot;เรนเดอร์ใหม่&quot; ซึ่งจะสร้างคลิปใหม่อีกตัวและเสีย 15 เครดิต
                </p>
                {job.flowProjectId && (
                  <a
                    className="text-sm text-primary underline-offset-4 hover:underline"
                    href={flowProjectUrl(job.flowProjectId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    เปิดโปรเจกต์ใน Flow →
                  </a>
                )}
              </div>
            )}
            <div className="flex min-w-0 max-w-2xl flex-1 flex-col gap-3">
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
                  <Button type="button" variant="outline" disabled={isPending} onClick={takeOverNow}>
                    <Hand data-icon="inline-start" /> ทำต่อเอง (โหลดเองแล้ว)
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
            onFinish={takeOverNow}
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

        {stalled && (
          <p className="max-w-3xl rounded-md border-l-4 border-status-warning bg-surface-2 p-3 text-sm leading-relaxed text-foreground">
            บอทไม่ได้เปิดอยู่ — งานนี้ค้างอยู่ ไม่ได้กำลังทำ · เปิด start.bat แล้วบอทจะเก็บงานให้เอง
            {job.status === FLOW_STATUS.RUNNING_UPSCALE ? " (โหลด 1080p ที่ค้าง = จบด้วย 720p แล้วกด ลองโหลด 1080p อีกครั้ง ได้)" : ""}
          </p>
        )}

        {isUpscale && clipLayout && clipFile !== null && (
          <ClipLayout
            job={job}
            filename={clipFile}
            middle={
              <>
                <p className="text-sm font-medium text-foreground">ผ่านแล้ว — บอทกำลังโหลดไฟล์ 1080p</p>
                <UsedImages job={job} />
                <BotSteps checkpoints={job.checkpoints} />
              </>
            }
            right={<ReadyToPostCard job={job} />}
          />
        )}

        {isUpscale && !clipLayout && (
          <div className="flex flex-wrap items-start gap-3">
            {job.video && (
              <ClipPlayer entryId={job.entryId} filename={job.video.filename} productName={job.productName} size="md" />
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">ผ่านแล้ว — บอทกำลังโหลดไฟล์ 1080p</p>
          </div>
        )}

        {job.status === FLOW_STATUS.FAILED && (
          <div className="flex max-w-3xl flex-col gap-2 rounded-md border-l-4 border-status-danger bg-surface-2 p-3 leading-relaxed">
            <p className="text-sm font-medium text-foreground">
              พังที่ขั้น &quot;{STEP_LABELS[job.failedStep] ?? job.failedStep}&quot; — {pausedReasonLabel(job.errorKind, job.errorMessage)}
            </p>
            {botMovedOnNote(job, queuePaused) !== null && (
              <p className="text-sm leading-relaxed text-foreground">{botMovedOnNote(job, queuePaused)}</p>
            )}
            <JobMessage status={job.status} message={job.errorMessage} />
            {job.video && (
              <ClipPlayer entryId={job.entryId} filename={job.video.filename} productName={job.productName} size="md" />
            )}
            {job.failureDir && (
              <p className="text-xs leading-relaxed text-muted-foreground">
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
              {queuePaused && canUnpauseQueueOnly(pausedReason) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() =>
                    run(async () => {
                      const r = await unpauseQueueOnly();
                      if (!r.ok) throw new Error(r.message ?? "ปลดการหยุดไม่สำเร็จ");
                    })
                  }
                >
                  <Play data-icon="inline-start" /> ให้บอททำงานอื่นต่อ (ปล่อยงานพังไว้)
                </Button>
              )}
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

        {/* ทำต่อเองแล้วสร้างโฟลเดอร์ TTS ไม่สำเร็จ — ทุกกรณี (มีคลิปหรือไม่) · ปุ่ม ส่งเข้าโฟลเดอร์ TTS ของหน้านี้กดลองใหม่ได้ */}
        {job.status === FLOW_STATUS.DONE && takeoverResult?.exportError && (
          <p className="text-sm leading-relaxed text-destructive" role="alert">
            สร้างโฟลเดอร์ TTS ไม่สำเร็จ: {takeoverResult.exportError} — กด ส่งเข้าโฟลเดอร์ TTS เพื่อลองใหม่
          </p>
        )}

        {job.status === FLOW_STATUS.DONE && clipLayout && clipFile !== null && (
          <ClipLayout
            job={job}
            filename={clipFile}
            done
            middle={
              <>
                <p className="text-sm font-medium text-foreground">
                  คลิปพร้อมแล้ว · {clipFile === FINAL_VIDEO_FILENAME ? "1080p" : "720p"}
                </p>
                <JobMessage status={job.status} message={job.errorMessage} />
                {canRetryUpscale(job.status, job.video, job.flowProjectId) && (
                  <div className="flex flex-col items-start gap-1">
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => retryFlowUpscale(job.id))}>
                      <RotateCcw data-icon="inline-start" /> ลองโหลด 1080p อีกครั้ง
                    </Button>
                    <span className="text-xs leading-relaxed text-muted-foreground">ไม่เสียเครดิต ไม่เรนเดอร์ใหม่ — บอทไปโหลดคลิปเดิมจาก Flow</span>
                  </div>
                )}
                <UsedImages job={job} />
                <BotSteps checkpoints={job.checkpoints} />
              </>
            }
            right={<ReadyToPostCard job={job} />}
          />
        )}

        {job.status === FLOW_STATUS.DONE && job.tookOver && job.video === null && (
          <section className="flex max-w-3xl flex-col gap-3 rounded-md border-l-4 border-status-success bg-surface-2 p-3 leading-relaxed" aria-label="ทำเองแล้ว">
            <p className="text-sm font-medium text-foreground">ทำเองแล้ว — ลากรูปจากโฟลเดอร์ TTS ไปใช้ใน Flow ได้เลย</p>
            <ExportToFolder jobId={job.id} exportedPath={job.exportedPath ?? takeoverResult?.exportPath ?? null} exportedVideo={job.exportedVideo} currentVideo={null} />
            <UsedImages job={job} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              ได้คลิปแล้ววางไว้ในโฟลเดอร์นั้น · มีพรอมต์/แคปชันทีหลัง กด ส่งเข้าโฟลเดอร์ TTS อีกครั้ง ข้อความจะเข้าโฟลเดอร์เดิม
            </p>
          </section>
        )}

        {job.status === FLOW_STATUS.DONE && !clipLayout && (renderEnabled || job.video !== null) && !(job.tookOver && job.video === null) && (
          // คลิปคือของหลัก (ซ้าย) · สถานะ/ปุ่ม/รูปที่ใช้ทำคลิปอยู่ขวา — ไม่ปล่อยพื้นที่ว่างทั้งแถว
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
            {job.video && (
              <ClipPlayer entryId={job.entryId} filename={job.video.filename} productName={job.productName} size="lg" done />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-3 leading-relaxed">
              {job.video ? (
                <p className="text-sm font-medium text-foreground">
                  คลิปพร้อมแล้ว · {job.video.filename === FINAL_VIDEO_FILENAME ? "1080p" : "720p"}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">เสร็จแล้ว (ยังไม่มีไฟล์คลิปในแอป)</p>
              )}
              {job.video && <JobMessage status={job.status} message={job.errorMessage} />}
              {canRetryUpscale(job.status, job.video, job.flowProjectId) && (
                <div className="flex flex-col items-start gap-1">
                  <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => retryFlowUpscale(job.id))}>
                    <RotateCcw data-icon="inline-start" /> ลองโหลด 1080p อีกครั้ง
                  </Button>
                  <span className="text-xs leading-relaxed text-muted-foreground">ไม่เสียเครดิต ไม่เรนเดอร์ใหม่ — บอทไปโหลดคลิปเดิมจาก Flow</span>
                </div>
              )}
              {(job.chosenRound1 || job.chosenRound2) && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs leading-relaxed text-muted-foreground">รูปที่ใช้ทำคลิป</span>
                  <div className="flex gap-2">
                    {[job.chosenRound1, job.chosenRound2].map((c, i) =>
                      c ? (
                        <Image
                          key={c.id}
                          src={imgUrl(job.entryId, c.filename)}
                          alt={i === 0 ? "รูปที่เลือก พื้นหลังขาว" : "รูปที่เลือก ตอนใช้งาน"}
                          width={400}
                          height={533}
                          className="aspect-[3/4] w-24 rounded-md border border-border object-cover"
                        />
                      ) : null
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showStandalonePrompt && (
          <PromptCard
            job={job}
            mode={promptGate === "ok" ? "edit" : "readonly"}
            canRerender={canRerenderWithPrompt(job.status)}
            extraPrompt={extra}
            disabled={isPending}
            standalone
          />
        )}

        {!isUpscale && (isWaitingForBot(job.status) || isBotWorking(job.status)) && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {isBotWorking(job.status) ? (stalled ? "ค้างอยู่ (บอทไม่ได้เปิด)" : "บอทกำลังทำอยู่ตอนนี้") : "รอบอทหยิบงาน"}
          </p>
        )}

        {/* ภาพจุดเช็ก 4 จุดของครั้งล่าสุด — ย้อนดูว่าบอทตั้งค่า/แนบรูป/พิมพ์พรอมต์ถูกไหม (ลบเองหลัง 14 วัน) */}
        {job.checkpoints.length > 0 && !clipLayout && (
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
                  <span className="text-xs leading-relaxed text-muted-foreground">{c.label}</span>
                </a>
              ))}
            </div>
          </details>
        )}

        {error && <p className="text-xs leading-relaxed text-destructive">{error}</p>}
      </div>

      {pickingSource && (
        <ShowcasePhotoPicker
          productName={job.productName}
          images={job.shopPhotos.map((p) => ({ id: p.id, filename: p.filename, src: shopPhotoSrc(p.candidateId, p.filename) }))}
          allowLocalFile
          confirmVerb="เปลี่ยนรูปต้นทาง"
          note="งานนี้จะกลับไปรอบอทวาดรอบ 1 ใหม่ด้วยรูปนี้ — รูปที่วาดไปแล้วยังเก็บไว้ ไม่ถูกลบ"
          busy={isPending}
          onConfirm={changeSourceTo}
          onCancel={() => setPickingSource(false)}
        />
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
    </article>
  );
}
