"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, RotateCcw, SkipForward, Play } from "lucide-react";

import {
  chooseFlowCandidate,
  generateWithAI,
  redoFlowRound,
  resumeFlowWorker,
  skipFlowJob,
} from "@/app/actions";
import { GEMINI_MODELS } from "@/lib/gemini";
import type { FlowJobRow, FlowImageRow } from "@/lib/flow-queries";
import { ERROR_KIND_LABELS, FLOW_STATUS, STATUS_LABELS, STEP_LABELS, type FlowStatus } from "@/lib/flow-jobs";
import { playCompletionSound } from "@/lib/completion-sound";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlowLightbox } from "@/components/flow-lightbox";
import { FlowStepper } from "@/components/flow-stepper";

function badgeVariant(status: string): BadgeVariant {
  if (status.startsWith("review_")) return "warning";
  if (status === FLOW_STATUS.DONE) return "success";
  if (status === FLOW_STATUS.FAILED) return "danger";
  return "neutral";
}

function imgUrl(entryId: string, filename: string): string {
  return `/api/uploads/${entryId}/flow/${filename}`;
}

function timeLabel(d: Date | null): string {
  if (d === null) return "";
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export function FlowReviewRow({ job }: { job: FlowJobRow }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // entryId ที่เพิ่งปิดงาน Flow รอบ 2 เสร็จ ให้ useEffect ด้านล่างยิง generateWithAI ต่อ —
  // ต้องแยกออกจาก startTransition ข้างบนจริงๆ (ไม่ใช่แค่ไม่ await) เพราะเรียก Server Action
  // ตัวที่สองซ้อนอยู่ใน startTransition เดียวกันแบบไม่ await ก็ยังโดนนับเป็น pending เดียวกัน
  // อยู่ดี (พิสูจน์แล้วจริงตอนทดสอบ: ปุ่มค้าง disabled ตลอด ~28 วิที่ generateWithAI ทำงาน)
  // ย้ายมาเป็น state → useEffect แยกจังหวะออกจาก transition เดิมชัดเจน ปุ่มถึงปลดล็อกไว
  const [autoGenerateEntryId, setAutoGenerateEntryId] = useState<string | null>(null);

  const isReview = job.status.startsWith("review_");
  const source = job.sources[0] ?? null;

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
        await chooseFlowCandidate(job.id, imageId);
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
    generateWithAI(entryId, GEMINI_MODELS[0].id)
      .then(() => playCompletionSound("success"))
      .catch(() => playCompletionSound("error"));
  }, [autoGenerateEntryId]);

  const lightboxItems = job.candidates.map((c, i) => ({ src: imgUrl(job.entryId, c.filename), label: `รูป ${i + 1}` }));

  return (
    <li className="flex flex-col gap-3 border-b border-border py-4">
      {/* จัดใหม่ทั้งการ์ด (แบบ A จาก visual companion 2026-09-12) — เดิมคอลัมน์ซ้าย
          220px ยัดชื่อ+เวลา+badge+stepper 6 ขั้นแน่นเกินไป ขณะที่รูป/ปุ่มฝั่งขวาใช้พื้นที่
          ไม่ถึงครึ่งจอ ตอนนี้หัวการ์ดกับ stepper เต็มความกว้างการ์ด ให้ stepper มีที่หายใจ
          และรูป/ปุ่มด้านล่างขยายใช้พื้นที่ทั้งแถวได้ */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/entry/${job.entryId}`} className="font-semibold leading-relaxed text-foreground hover:underline">
            {job.productName}
          </Link>
          <p className="text-xs leading-relaxed text-muted-foreground">
            เข้าคิว {timeLabel(job.createdAt)}
            {job.startedAt ? ` · เริ่มรอบ ${job.round} ${timeLabel(job.startedAt)}` : ""}
            {job.attempt > 1 ? ` · ครั้งที่ ${job.attempt}` : ""}
          </p>
        </div>
        <Badge variant={badgeVariant(job.status)}>{STATUS_LABELS[job.status as FlowStatus] ?? job.status}</Badge>
      </div>

      <FlowStepper status={job.status} round={job.round} />

      <div className="flex flex-col gap-3">
        {isReview && (
          <>
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={selected === null || isPending}
                onClick={() => selected && chooseAndMaybeAutoGenerate(selected)}
              >
                {job.status === FLOW_STATUS.REVIEW_R1 ? "ใช้รูปนี้ → ให้บอทวาดรอบ 2" : "ใช้รูปนี้ → บันทึกเป็นรูปสินค้า"}
              </Button>
              <Button type="button" variant="outline" disabled={isPending} onClick={() => run(() => redoFlowRound(job.id))}>
                <RotateCcw data-icon="inline-start" /> ไม่ผ่านสักรูป วาดใหม่
              </Button>
              <Button type="button" variant="ghost" disabled={job.candidates.length === 0} onClick={() => setLightbox(0)}>
                ขยายเทียบกับรูปแคป
              </Button>
            </div>
          </>
        )}

        {job.status === FLOW_STATUS.FAILED && (
          <div className="flex flex-col gap-2 rounded-md border-l-4 border-status-danger bg-surface-2 p-3 leading-relaxed">
            <p className="text-sm font-medium text-foreground">
              พังที่ขั้น &quot;{STEP_LABELS[job.failedStep] ?? job.failedStep}&quot; — {ERROR_KIND_LABELS[job.errorKind] ?? job.errorKind}
            </p>
            {job.errorMessage && <p className="text-xs text-muted-foreground">{job.errorMessage}</p>}
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

        {job.status === FLOW_STATUS.DONE && (
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
            <Link href={`/entry/${job.entryId}`} className="text-sm leading-relaxed text-primary underline-offset-4 hover:underline">
              ไปหน้า entry ดู prompt ที่สร้างให้แล้ว →
            </Link>
          </div>
        )}

        {(job.status.startsWith("queued_") || job.status.startsWith("running_")) && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {job.status.startsWith("running_") ? "บอทกำลังทำอยู่ตอนนี้" : "รอบอทหยิบงาน"}
          </p>
        )}

        {error && <p className="text-xs leading-relaxed text-destructive">{error}</p>}
      </div>

      {lightbox !== null && source && (
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
