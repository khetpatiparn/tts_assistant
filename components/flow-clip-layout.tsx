"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, Copy, Download, FolderInput, X } from "lucide-react";

import { exportClipToFolder } from "@/app/actions";
import { FINAL_VIDEO_FILENAME, videoDownloadName } from "@/lib/flow-jobs";
import { exportStaleHint } from "@/lib/clip-export";
import type { FlowCheckpoint, FlowJobRow } from "@/lib/flow-queries";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { imgUrl } from "@/components/flow-job-parts";
import { ClaimWarnings } from "@/components/claim-warnings";

/** สูงสุด/ต่ำสุดของกรอบคลิปบนเดสก์ท็อป (px) — คลิปเป็น 9:16 ความกว้างตามความสูง */
const CLIP_MIN_H = 280;
const CLIP_MAX_H = 760;
/** ที่เผื่อให้ปุ่มดาวน์โหลด + ปุ่มส่งเข้าโฟลเดอร์ TTS + ข้อความผลลัพธ์ใต้คลิป */
const CLIP_FOOTER_PX = 150;

/**
 * หน้างานแบบคลิป (ดูตัวอย่าง/รอโหลด 1080p/เสร็จ) ที่ lg: ขึ้นไป — 3 โซน: คลิป · กลาง (สถานะ/ปุ่ม/รูป/ขั้นตอนบอท) · ขวา (พร้อมโพสต์ หรือพรอมต์)
 * ที่ ≥1400px: 3 โซนเรียงข้าง · lg–1400px: โซนขวาย้ายลงใต้โซนกลาง (ยังอยู่ขวาของคลิป)
 * ความสูงคลิป "วัดจริง" จากกรอบที่ได้รับ (ResizeObserver) ไม่เดาจาก viewport เพื่อให้พอดีกับพื้นที่ที่เหลือใต้หัวงานโดยไม่ต้องเลื่อน
 * ต่ำกว่า lg: วางเรียงลงมาตามปกติ ไม่วัด
 */
export function ClipLayout({
  job,
  filename,
  done = false,
  middle,
  right,
}: {
  job: FlowJobRow;
  filename: string;
  done?: boolean;
  middle: ReactNode;
  right: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [clipH, setClipH] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    function measure() {
      const target = wrapRef.current;
      if (target === null) return;
      // ต่ำกว่า lg: ไม่จำกัดความสูง (กรอบไม่ได้ถูกบีบด้วยหน้าต่าง)
      if (window.innerWidth < 1024) {
        setClipH(null);
        return;
      }
      const h = Math.floor(target.clientHeight - CLIP_FOOTER_PX);
      setClipH(Math.max(CLIP_MIN_H, Math.min(CLIP_MAX_H, h)));
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div ref={wrapRef} className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-start lg:gap-6">
      <div className="flex w-full max-w-72 shrink-0 flex-col gap-2 lg:w-auto lg:max-w-none">
        <video
          src={imgUrl(job.entryId, filename)}
          controls
          preload="metadata"
          style={clipH === null ? undefined : { height: clipH }}
          className={cn(
            "aspect-[9/16] rounded-md bg-surface-2 max-lg:w-full",
            done ? "border-2 border-status-success" : "border border-border"
          )}
        />
        <a
          href={imgUrl(job.entryId, filename)}
          download={videoDownloadName(job.productName)}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
        >
          <Download data-icon="inline-start" /> ดาวน์โหลดคลิป
        </a>
        <ExportToFolder
          jobId={job.id}
          exportedPath={job.exportedPath}
          exportedVideo={job.exportedVideo}
          currentVideo={job.video?.filename ?? null}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4 min-[1400px]:h-full min-[1400px]:flex-row min-[1400px]:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4 leading-relaxed">{middle}</div>
        <div className="flex min-w-0 flex-col gap-3 min-[1400px]:min-h-0 min-[1400px]:w-80 min-[1400px]:shrink-0 min-[1700px]:w-88">{right}</div>
      </div>
    </div>
  );
}

/**
 * ปุ่ม "ส่งเข้าโฟลเดอร์ TTS" — ให้เซิร์ฟเวอร์ก๊อปคลิป+รูป+ข้อความเข้าโฟลเดอร์ของวันนี้แล้วเปิดให้
 * คลิปของงานเปลี่ยนหลังส่ง (720p → 1080p / เรนเดอร์ใหม่) = ชวนกดอีกครั้งเพื่ออัปเดตโฟลเดอร์เดิม
 */
function ExportToFolder({
  jobId,
  exportedPath,
  exportedVideo,
  currentVideo,
}: {
  jobId: string;
  exportedPath: string | null;
  exportedVideo: string | null;
  currentVideo: string | null;
}) {
  const [pending, startTransition] = useTransition();
  // เคยส่งแล้ว (อ่านจาก log ตอนโหลดหน้า) = โชว์ทันทีโดยไม่ต้องกดซ้ำ · stale = คลิปที่ส่งไว้ไม่ใช่คลิปปัจจุบัน
  const [result, setResult] = useState<{ path: string; already: boolean; updated: boolean; stale: string | null } | null>(
    exportedPath === null
      ? null
      : { path: exportedPath, already: true, updated: false, stale: exportStaleHint(exportedVideo, currentVideo, FINAL_VIDEO_FILENAME) },
  );
  const [error, setError] = useState("");
  function run() {
    setError("");
    startTransition(async () => {
      try {
        const r = await exportClipToFolder(jobId);
        setResult({ path: r.path, already: r.alreadyExported, updated: r.updated, stale: null });
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "ส่งเข้าโฟลเดอร์ TTS ไม่สำเร็จ");
      }
    });
  }
  return (
    <div className="flex w-0 min-w-full flex-col gap-1.5">
      <Button type="button" size="sm" disabled={pending} onClick={run} className="self-start">
        <FolderInput data-icon="inline-start" /> {pending ? "กำลังส่ง…" : "ส่งเข้าโฟลเดอร์ TTS"}
      </Button>
      <div role="status" className="text-xs leading-relaxed text-muted-foreground">
        {result !== null && (
          <p className="break-all">
            {result.updated ? "อัปเดตคลิปในโฟลเดอร์เดิมแล้ว" : result.already ? "ส่งเข้าโฟลเดอร์ TTS แล้ว" : "ส่งแล้ว"} → {result.path}
          </p>
        )}
        {result?.stale && <p className="font-medium text-foreground">{result.stale}</p>}
        {error !== "" && <p className="text-destructive">{error}</p>}
      </div>
    </div>
  );
}

/** รูป 2 รูปที่บอทใช้ทำคลิป (พื้นหลังขาว + ตอนใช้งาน) แบบรูปเล็ก */
export function UsedImages({ job }: { job: FlowJobRow }) {
  const items = [
    { row: job.chosenRound1, alt: "รูปที่เลือก พื้นหลังขาว", label: "พื้นหลังขาว" },
    { row: job.chosenRound2, alt: "รูปที่เลือก ตอนใช้งาน", label: "ตอนใช้งาน" },
  ];
  if (!items.some((i) => i.row)) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs leading-relaxed text-muted-foreground">รูปที่ใช้ทำคลิป</span>
      <div className="flex gap-3">
        {items.map((i) =>
          i.row ? (
            <figure key={i.row.id} className="flex flex-col gap-1">
              <Image
                src={imgUrl(job.entryId, i.row.filename)}
                alt={i.alt}
                width={400}
                height={533}
                className="aspect-[3/4] w-16 rounded-md border border-border object-cover"
              />
              <figcaption className="text-xs leading-relaxed text-muted-foreground">{i.label}</figcaption>
            </figure>
          ) : null
        )}
      </div>
    </div>
  );
}

/** ภาพจุดเช็กของบอท (ย่อ) — กดดูขยาย · ลบเองหลัง 14 วัน */
export function BotSteps({ checkpoints }: { checkpoints: FlowCheckpoint[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (checkpoints.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs leading-relaxed text-muted-foreground">ขั้นตอนที่บอททำ ({checkpoints.length} ภาพ) — กดที่ภาพเพื่อขยาย</span>
      <ul className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(checkpoints.length, 5)}, minmax(0, 1fr))` }}>
        {checkpoints.map((c, i) => (
          <li key={c.path} className="min-w-0">
            <button
              type="button"
              aria-label={`ขยายภาพ ${c.label}`}
              onClick={() => setOpen(i)}
              className="flex w-full flex-col gap-1 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/uploads/${c.path}`}
                alt=""
                loading="lazy"
                className="aspect-video w-full rounded-md border border-border-interactive object-cover object-bottom"
              />
              <span className="text-xs leading-relaxed text-muted-foreground">{c.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <ImageViewer item={checkpoints[open]} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ImageViewer({ item, onClose }: { item: FlowCheckpoint; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const src = `/api/uploads/${item.path}`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`ภาพขั้นตอน ${item.label}`}
      className="fixed inset-0 z-50 flex flex-col gap-3 bg-background/95 p-3 sm:p-6"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm leading-relaxed text-foreground">
          {item.label} ·{" "}
          <a href={src} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
            เปิดในแท็บใหม่
          </a>{" "}
          · Esc ปิด
        </p>
        <Button type="button" variant="outline" size="icon" aria-label="ปิด" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={item.label} className="size-full rounded-lg border border-border object-contain" />
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied && !failed) return;
    const t = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
    return () => clearTimeout(t);
  }, [copied, failed]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={text === ""} aria-label={`คัดลอก${label}`} onClick={copy}>
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />} คัดลอก
      </Button>
      <span role="status" className="text-xs leading-relaxed text-muted-foreground">
        {copied ? "คัดลอกแล้ว" : failed ? "คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C" : ""}
      </span>
    </div>
  );
}

function ReadOnlyBox({ id, label, value, rows }: { id: string; label: string; value: string; rows: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <textarea
        id={id}
        readOnly
        rows={rows}
        value={value}
        className="w-full resize-none rounded-md border border-border-interactive bg-background p-2 text-sm leading-relaxed text-foreground"
      />
      <CopyButton text={value} label={label} />
    </div>
  );
}

/** การ์ด "พร้อมโพสต์" — แคปชัน + แฮชแท็ก + angle ของ Entry คัดลอกไปวางตอนโพสต์ */
export function ReadyToPostCard({ job }: { job: FlowJobRow }) {
  const empty = job.caption.trim() === "" && job.hashtags.trim() === "";
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 leading-relaxed" aria-label="พร้อมโพสต์">
      <h3 className="text-base font-semibold text-foreground">พร้อมโพสต์</h3>
      {empty ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีแคปชัน — กด &quot;สร้างด้วย AI&quot; ในหน้างาน{" "}
          <Link href={`/entry/${job.entryId}`} className="text-primary underline-offset-4 hover:underline">
            เปิดหน้างาน →
          </Link>
        </p>
      ) : (
        <>
          <ClaimWarnings tenPart={job.prompt} caption={job.caption} hashtags={job.hashtags} />
          <ReadOnlyBox id={`caption-${job.id}`} label="แคปชัน" value={job.caption} rows={5} />
          <ReadOnlyBox id={`hashtags-${job.id}`} label="แฮชแท็ก" value={job.hashtags} rows={2} />
        </>
      )}
      {job.angle.trim() !== "" && (
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">angle:</span> {job.angle}
        </p>
      )}
    </section>
  );
}

/** การ์ด "พรอมต์ที่ใช้ทำคลิปนี้" — 10-part prompt อ่านอย่างเดียว เลื่อนดูได้ + ข้อความเพิ่มเติมที่ต่อท้าย */
export function PromptCard({ job, usedExtra }: { job: FlowJobRow; usedExtra: string }) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 leading-relaxed min-[1400px]:h-full"
      aria-label="พรอมต์ที่ใช้ทำคลิปนี้"
    >
      <h3 className="text-base font-semibold text-foreground">พรอมต์ที่ใช้ทำคลิปนี้</h3>
      {job.prompt.trim() === "" ? (
        <p className="text-sm text-muted-foreground">ยังไม่มี 10-part prompt</p>
      ) : (
        <>
          <label htmlFor={`prompt-${job.id}`} className="sr-only">
            10-part prompt
          </label>
          <textarea
            id={`prompt-${job.id}`}
            readOnly
            value={job.prompt}
            className="h-64 w-full resize-none rounded-md border border-border-interactive bg-background p-2 text-sm leading-relaxed text-foreground min-[1400px]:h-auto min-[1400px]:min-h-0 min-[1400px]:flex-1"
          />
        </>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {usedExtra === "" ? "ไม่มีข้อความเพิ่มเติมต่อท้าย" : `ข้อความเพิ่มเติมที่ต่อท้าย: “${usedExtra}”`}
      </p>
    </section>
  );
}
