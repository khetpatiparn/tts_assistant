"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ClipboardPaste,
  Coins,
  Layers,
  Lightbulb,
  Trash2,
  TrendingUp,
  TriangleAlert,
  X,
} from "lucide-react";

import {
  createEntryFromCandidate,
  createEntryFromCandidateWithImages,
  deleteCandidateBatch,
  extractCandidates,
  importShowcaseFile,
} from "@/app/actions";
import { isCommissionPercentPlausible } from "@/lib/candidates";
import type {
  BatchSummary,
  CandidateRow,
  FocusCategory,
} from "@/lib/candidate-queries";
import { playCompletionSound } from "@/lib/completion-sound";
import { IMPORT_STALE_DAYS } from "@/lib/import-schedule";
import { cn } from "@/lib/utils";
import { CandidateImagePicker } from "@/components/candidate-image-picker";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

type CreatedFilter = "all" | "todo" | "created";

const FILTERS: { key: CreatedFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "todo", label: "ยังไม่ได้สร้าง" },
  { key: "created", label: "สร้างแล้ว" },
];

function imageFilesFrom(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => ALLOWED.includes(f.type));
}

function formatThaiDate(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

// เทียบที่ระดับวันตามปฏิทินท้องถิ่น ไม่ใช่ชั่วโมง — กันกรณีเก็บข้อมูลตอนดึกแล้วนับเป็น
// "เกินกำหนดไปแล้ว" ทั้งที่ยังไม่ครบวันจริง (บั๊กคลาสเดียวกับ toDateInputValue)
function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ใช้ร่วมกันทั้งการ์ด (ต่ำกว่า md) และตาราง (md ขึ้นไป) — ต้องประกอบคำเตือน
// จากเงื่อนไขชุดเดียวกันทุกครั้ง ไม่ใช่ก๊อปมาสองที่แล้วเสี่ยงหลุดตรงกันภายหลัง
function buildCandidateWarnings(
  r: CandidateRow,
  plausible: boolean
): { key: string; text: string; danger: boolean }[] {
  const warnings: { key: string; text: string; danger: boolean }[] = [];
  if (!plausible) {
    warnings.push({
      key: "price",
      danger: true,
      text:
        `ราคาที่อ่านได้ (฿${r.price.toLocaleString()}) ดูผิดปกติ — ` +
        "%ค่าคอมที่คำนวณได้เกิน 100% ซึ่งเป็นไปไม่ได้จริง น่าจะเป็นราคาโปรโมชั่น" +
        "ที่ AI อ่านตามจอ ไม่ใช่ราคาที่ใช้เทียบได้ ให้ตรวจสอบราคาจริงก่อนตัดสินใจ",
    });
  }
  if (r.demandTotal === null) {
    // แถวจาก Showcase import (sourceProductId ไม่ null) ไม่มีตัวเลขยอดขายเป็นเรื่องปกติ/
    // โครงสร้างเสมอ (Showcase ไม่มีฟิลด์นี้ให้เลย) — คำแนะนำ "ลองแคปจากหน้าขายดีที่สุด" ผิด
    // ทั้งหมดสำหรับแถวเหล่านี้เพราะไม่มีสกรีนช็อตให้แคปใหม่ ใช้ข้อความกลางๆ ที่ตรงกับความจริงแทน
    if (r.sourceProductId !== null) {
      warnings.push({
        key: "nosales",
        danger: false,
        text: "นำเข้าจาก Showcase — ไม่มีตัวเลขยอดขายรายสัปดาห์ จึงจัดอันดับศักยภาพรายได้ให้ไม่ได้",
      });
    } else {
      warnings.push({
        key: "nosales",
        danger: true,
        text:
          'แถวนี้ไม่มีตัวเลขยอดขาย (น่าจะมาจากหน้า "คะแนนสูงสุด") จัดอันดับให้ไม่ได้ — ' +
          'ลองแคปจากหน้า "ขายดีที่สุด" แทน',
      });
    }
  }
  if (r.flags.includes("mechanism")) {
    warnings.push({
      key: "mechanism",
      danger: false,
      text: "ชื่อบ่งบอกว่าอาจมีกลไก (พับ/หมุน/ปรับระดับ) — ตรวจรูปสินค้าก่อนทำ",
    });
  }
  if (r.flags.includes("heavyText")) {
    warnings.push({
      key: "heavyText",
      danger: false,
      text: "อาจมีฉลาก/ข้อความบนตัวสินค้าเยอะ — AI สร้างวิดีโอมักทำตัวหนังสือเพี้ยน",
    });
  }
  return warnings;
}

export function CandidatesRoute({
  rows,
  batches,
  focus,
  now,
}: {
  rows: CandidateRow[];
  batches: BatchSummary[];
  focus: FocusCategory[];
  now: Date;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [filter, setFilter] = useState<CreatedFilter>("all");
  // null = มุมมองดีฟอลต์ (ชุดล่าสุดของแต่ละหมวด) · ไม่ null = ดูชุดเดียวเจาะจง
  const [batchView, setBatchView] = useState<string | null>(null);
  // เก็บ id ของชุดที่กดลบไว้รอยืนยัน — ยืนยันในที่เดิมแทนการเปิด dialog
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // ไม่ null = กำลังเปิด dialog เลือกรูปสำหรับ candidate นี้ก่อนสร้างงาน
  const [pickerFor, setPickerFor] = useState<{
    id: string;
    images: { id: string; filename: string }[];
  } | null>(null);
  const [isExtracting, startExtracting] = useTransition();
  const [isUpdating, startUpdating] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    let list =
      batchView === null
        ? rows.filter((r) => r.isLatestForCategory)
        : rows.filter((r) => r.batchId === batchView);
    if (filter === "todo") list = list.filter((r) => r.linkedEntryId === null);
    else if (filter === "created") list = list.filter((r) => r.linkedEntryId !== null);
    // เรียงตามศักยภาพรายได้มากไปน้อย แถวที่ไม่มีศักยภาพรายได้เพราะข้อมูลพัง (screenshot ที่ขาด
    // ยอดขายจริงๆ) ไปท้ายสุดเหมือนเดิม — แต่แถว Showcase import (sourceProductId ไม่ null) ไม่มี
    // ยอดขายโดยโครงสร้างเสมอ (Showcase ไม่มีฟิลด์นี้) ไม่ใช่ปัญหาคุณภาพข้อมูล จึงให้คีย์กลางๆ (0)
    // แทนที่จะโดนฝัง -1 ไว้ใต้ทุกแถว screenshot ที่มีตัวเลขจริงโดยธรรมชาติ
    const sortKey = (r: CandidateRow): number => {
      if (r.demandTotal !== null) return r.demandTotal;
      return r.sourceProductId !== null ? 0 : -1;
    };
    return [...list].sort((a, b) => sortKey(b) - sortKey(a));
  }, [rows, filter, batchView]);

  // จำนวนแถวของแต่ละชุดที่กำลังโชว์อยู่ในมุมมองดีฟอลต์ (ไม่ใช่ทั้งหมด batchView) — ใช้เตือน
  // ตอนกดลบว่ากำลังจะทำหน้าจอปัจจุบันของผู้ใช้ว่างไปกี่รายการ (Finding 1: ชุดที่ดูเหมือน "เก่า"
  // เพราะเก็บมาก่อนอาจยังมีแถวเป็นส่วนใหญ่ของสิ่งที่ผู้ใช้เห็นอยู่ตอนนี้จริงๆ)
  const currentViewCountByBatch = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.isLatestForCategory) continue;
      map.set(r.batchId, (map.get(r.batchId) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  function handleExtract() {
    if (files.length === 0) return;
    setError(null);
    setResult(null);
    startExtracting(async () => {
      let outcome: "success" | "error" = "success";
      try {
        const formData = new FormData();
        for (const f of files) formData.append("files", f);
        const r = await extractCandidates(formData);
        setFiles([]);
        setResult(
          `เพิ่มชุดใหม่ ${r.added} รายการ` +
            (r.skipped > 0 ? ` · ข้ามบรรทัดที่อ่านไม่ออก ${r.skipped}` : "")
        );
        // กลับมามุมมองดีฟอลต์เสมอ — ถ้ายังค้าง batchView ของชุดเก่าอยู่ ผู้ใช้จะไม่เห็นชุดที่
        // เพิ่งอัปโหลดเลย ทั้งที่ banner บอกว่าเพิ่มสำเร็จแล้ว (ดูเหมือนอัปโหลดไม่ทำอะไร)
        setBatchView(null);
      } catch (e) {
        outcome = "error";
        setError(e instanceof Error ? e.message : "อ่านข้อมูลจากรูปไม่สำเร็จ");
      }
      playCompletionSound(outcome);
    });
  }

  function handleCreate(candidate: { id: string; images: { id: string; filename: string }[] }) {
    if (candidate.images.length > 0) {
      setPickerFor({ id: candidate.id, images: candidate.images });
      return;
    }
    startUpdating(async () => {
      try {
        await createEntryFromCandidate(candidate.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "สร้างรายการไม่สำเร็จ");
      }
    });
  }

  function handleConfirmPicker(candidateId: string, chosenImageIds: string[]) {
    setPickerFor(null);
    setError(null);
    setResult(null);
    startUpdating(async () => {
      try {
        const { flowEnqueueError } = await createEntryFromCandidateWithImages(
          candidateId,
          chosenImageIds
        );
        // entry ถูกสร้างสำเร็จเสมอถึงจุดนี้ — ถ้าแค่ขั้นเข้าคิว Flow อัตโนมัติพัง ต้องโชว์ผู้ใช้
        // เห็น ไม่ใช่ปล่อยให้หายเงียบๆ (entry ยังใช้งานได้ปกติ ไปอัปโหลดรูปเองที่หน้ารายการได้)
        if (flowEnqueueError) {
          setResult(
            `สร้างรายการแล้ว แต่เข้าคิว Flow อัตโนมัติไม่สำเร็จ (${flowEnqueueError}) — ` +
              "ไปอัปโหลดรูปเองที่หน้ารายการนี้ได้"
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "สร้างรายการไม่สำเร็จ");
      }
    });
  }

  function handleDeleteBatch(batchId: string) {
    startUpdating(async () => {
      try {
        await deleteCandidateBatch(batchId);
        setConfirmDelete(null);
        // ถ้ากำลังดูชุดที่เพิ่งลบอยู่ ต้องเด้งกลับมุมมองดีฟอลต์ ไม่งั้นหน้าจะว่างเปล่าแบบงงๆ
        setBatchView((current) => (current === batchId ? null : current));
      } catch (e) {
        setError(e instanceof Error ? e.message : "ลบชุดไม่สำเร็จ");
      }
    });
  }

  return (
    // min-w-0 ที่นี่ด้วย — ตัวนี้เป็น flex item ของ layout หน้า ถ้าไม่ใส่ min-width:auto จะไต่ขึ้นไป
    // ตามลูกที่กว้างที่สุด (ตาราง) แล้วดันหน้าเพจล้นแนวนอนเหมือนกัน ต้องใส่ให้ครบทั้งสาย
    <div className="flex min-w-0 flex-col gap-5">
      {/* แถบเตือนหมวดที่ควรโฟกัส — ต้องมีจำนวนออเดอร์กำกับเสมอ เพราะบางหมวด %สูง
          แต่มาจากออเดอร์น้อยมาก ถ้าโชว์แต่ % จะอ่านผิดว่าหมวดนั้นดีกว่า */}
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 leading-relaxed">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Lightbulb className="size-4 shrink-0 text-primary" />
          หมวดที่ควรโฟกัส — อ้างอิงค่าคอมจริงจากยอดขายของคุณเอง
        </p>
        {focus.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            ยังไม่มีข้อมูลยอดขายพอจะคำนวณ — นำเข้าไฟล์รายได้ในแท็บรายได้ก่อน
          </p>
        ) : (
          <p className="text-sm text-foreground/80">
            {focus.map((f, i) => (
              <span key={f.label}>
                {i > 0 && <span className="text-muted-foreground"> · </span>}
                {f.label} {f.ratePercent.toFixed(1)}%{" "}
                <span className="text-muted-foreground">({f.orderCount} ออเดอร์)</span>
              </span>
            ))}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          แคปจากหน้า &quot;ขายดีที่สุด&quot; (รายการเต็ม 15 อันดับ) เท่านั้น — หมวดอื่นก็แคปได้ ระบบไม่ได้จำกัด
        </p>
      </section>

      {/* รายการชุด — 1 ชุด = 1 ครั้งที่อ่านข้อมูลจากรูป ดูเจาะจงหรือลบทั้งชุดได้จากตรงนี้ */}
      {batches.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 leading-relaxed">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Layers className="size-4 shrink-0 text-primary" />
              ชุดที่เก็บมาแล้ว
            </p>
            <button
              type="button"
              onClick={() => setBatchView(null)}
              aria-pressed={batchView === null}
              className={
                "inline-flex h-11 items-center rounded-lg border border-border-interactive px-3 text-sm transition-colors lg:h-9 " +
                (batchView === null
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-foreground/5")
              }
            >
              ดูชุดล่าสุดของทุกหมวด
            </button>
          </div>

          <ul className="flex flex-col gap-2">
            {batches.map((b) => {
              const selected = batchView === b.id;
              // เตือนเฉพาะชุดที่ยังเป็นชุดล่าสุดของอย่างน้อยหนึ่งหมวด — ชุดเก่าที่ถูก
              // แทนที่ไปแล้วจะเก่าแค่ไหนก็ไม่ใช่ข่าว ไม่ต้องเตือนซ้ำ
              const age = daysBetween(b.capturedOn, now);
              const stale = b.isLatestForAnyCategory && age > IMPORT_STALE_DAYS;
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border p-3"
                >
                  <span className="text-sm text-foreground">
                    {b.categories.map((c) => `${c.label} ${c.count}`).join(" · ")}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    เก็บ {formatThaiDate(b.capturedOn)}
                  </span>
                  {b.isLatestForAnyCategory && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs leading-relaxed font-medium text-primary">
                      ล่าสุด
                    </span>
                  )}
                  {stale && (
                    <span className="flex items-center gap-1 text-xs leading-relaxed text-destructive">
                      <TriangleAlert className="size-3.5 shrink-0" />
                      ข้อมูลเก่าเกินกำหนดมา {age - IMPORT_STALE_DAYS} วัน — ควรแคปหน้าจัดอันดับใหม่
                    </span>
                  )}

                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      onClick={() => setBatchView(selected ? null : b.id)}
                      aria-pressed={selected}
                    >
                      {selected ? "กำลังดูชุดนี้" : "ดูชุดนี้"}
                    </Button>

                    {confirmDelete === b.id ? (
                      <>
                        <span className="text-sm text-destructive">
                          {(() => {
                            const currentCount = currentViewCountByBatch.get(b.id) ?? 0;
                            // ถ้ามีแถวของชุดนี้อยู่ในมุมมองดีฟอลต์ (ที่ผู้ใช้กำลังดูอยู่ตอนนี้)
                            // ต้องเน้นให้เห็นชัดว่าลบแล้วหน้าจอปัจจุบันจะว่างไปกี่รายการ — ชุดที่
                            // ดูเหมือน "เก่า" เพราะเก็บมาก่อนอาจยังเป็นส่วนใหญ่ของสิ่งที่เห็นอยู่จริง
                            return currentCount > 0 ? (
                              <>
                                ลบ {b.rowCount} รายการถาวร?{" "}
                                <span className="font-semibold">
                                  รวม {currentCount} รายการที่กำลังแสดงอยู่ในหน้านี้ตอนนี้
                                </span>{" "}
                                (งานที่สร้างไปแล้วไม่หาย เสียแค่ลิงก์)
                              </>
                            ) : (
                              <>ลบ {b.rowCount} รายการถาวร? (งานที่สร้างไปแล้วไม่หาย เสียแค่ลิงก์)</>
                            );
                          })()}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDeleteBatch(b.id)}
                          disabled={isUpdating}
                        >
                          ยืนยันลบ
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmDelete(null)}
                        >
                          ยกเลิก
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmDelete(b.id)}
                        disabled={isUpdating}
                      >
                        <Trash2 className="size-4" />
                        ลบชุดนี้
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* กล่องแปะรูป */}
      <section className="flex flex-col gap-3 rounded-xl border border-dashed border-border-interactive bg-surface p-5">
        <div
          role="button"
          tabIndex={0}
          aria-label="เลือกแคปหน้าจัดอันดับสินค้า"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onPaste={(e) => {
            const picked = imageFilesFrom(e.clipboardData?.files);
            if (picked.length > 0) {
              e.preventDefault();
              setFiles((prev) => [...prev, ...picked]);
            }
          }}
          className="flex cursor-pointer flex-col gap-2"
        >
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ClipboardPaste className="size-4 shrink-0" />
            กดที่นี่แล้ว Ctrl+V เพื่อแปะแคป หรือกดเพื่อเลือกไฟล์ (แปะหลายใบพร้อมกันได้)
          </p>
          {files.length > 0 && (
            <p className="text-sm text-foreground">แนบไว้ {files.length} รูป</p>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              setFiles((prev) => [...prev, ...imageFilesFrom(e.target.files)]);
              e.target.value = "";
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={handleExtract}
            disabled={isExtracting || files.length === 0}
          >
            {isExtracting ? "กำลังอ่าน..." : "อ่านข้อมูลจากรูป"}
          </Button>
          {files.length > 0 && (
            <Button type="button" variant="outline" onClick={() => setFiles([])}>
              <X className="size-4" />
              ล้างรูป
            </Button>
          )}
        </div>

        <form
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3"
          action={(formData) => {
            setError(null);
            setResult(null);
            startUpdating(async () => {
              try {
                const r = await importShowcaseFile(formData);
                setResult(
                  `นำเข้า ${r.added} รายการ` +
                    (r.skipped > 0 ? ` · ข้ามบรรทัดที่อ่านไม่ออก ${r.skipped}` : "") +
                    (r.imagesFailed > 0 ? ` · โหลดรูปไม่สำเร็จ ${r.imagesFailed} รูป` : "")
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "นำเข้าไฟล์ไม่สำเร็จ");
              }
            });
          }}
        >
          <label className="text-sm leading-relaxed text-foreground" htmlFor="showcase-json">
            นำเข้าจากไฟล์ Showcase (.json)
          </label>
          <input
            id="showcase-json"
            name="file"
            type="file"
            accept="application/json"
            required
            className="text-sm"
          />
          <Button type="submit" disabled={isUpdating}>
            นำเข้า
          </Button>
        </form>

        {result && <p className="text-sm text-foreground/80">{result}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      {/* ตัวกรองสร้างงานแล้ว/ยังไม่ได้สร้าง — ไม่ใช่ตัวกรองสถานะ triage แล้ว (ระบบปัดตก/สนใจ
          ถูกถอดออกทั้งหมดเมื่อ 2026-08-23) เหลือแค่แยกว่าแถวไหนกด "สร้างงานเลย" ไปแล้วหรือยัง */}
      <div className="inline-flex flex-wrap gap-1 self-start rounded-lg border border-border-interactive p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={
              "inline-flex h-11 items-center rounded-md px-3 text-sm font-medium transition-colors lg:h-9 " +
              (filter === f.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ตารางผลลัพธ์ — เป็นตารางจริงเพราะข้อมูลเป็นตัวเลขที่ต้องเทียบข้ามแถว
          (เดิมเป็นการ์ดใบละแถว เนื้อหากระจุกชิดซ้าย เห็นได้แค่ ~2 สินค้าต่อหน้าจอ) */}
      {visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed text-muted-foreground">
          {rows.length === 0
            ? "ยังไม่มีสินค้าในระบบ — แปะแคปหน้าจัดอันดับสินค้าด้านบนเพื่อเริ่ม"
            : "ไม่มีสินค้าที่ตรงกับตัวกรองนี้"}
        </p>
      ) : (
        <>
          {/* ต่ำกว่า md: เป็นการ์ด — ตาราง 10 คอลัมน์กว้าง 1024px บนจอ 390px คือการเลื่อน
              ซ้ายขวาหาข้อมูลตลอดเวลา · เลือกเฉพาะสิ่งที่ใช้ตัดสินใจ: ชื่อ+ป้ายเป็นหัว
              ศักยภาพรายได้เด่นสุด (เป็นตัวจัดอันดับอยู่แล้ว) ที่เหลือเป็นแถวรอง */}
          <ul className="flex flex-col gap-2 md:hidden">
            {visible.map((r) => {
              const plausible = isCommissionPercentPlausible(r.commissionPercent);
              const warnings = buildCandidateWarnings(r, plausible);

              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
                >
                  {/* ชื่อสินค้าต้องได้แถวเต็มความกว้างของตัวเองก่อน แล้วปุ่ม action ค่อยขึ้น
                      แถวใหม่ด้านล่าง — เดิมทั้งสองอยู่แถวเดียวกันแบบ shrink-0 whitespace-nowrap
                      ทำให้ปุ่ม 3 ปุ่มแย่งพื้นที่ ~220px จาก 390px เหลือชื่อแค่ ~110px จนตัดคำ
                      3-4 บรรทัด (บั๊กเดียวกับที่ entry-list.tsx เคยแก้ไปแล้ว) */}
                  <p className="text-base leading-relaxed font-medium text-foreground">
                    {r.name}
                  </p>
                  {r.images.length > 0 && (
                    <div className="flex gap-1">
                      {r.images.slice(0, 3).map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={img.id}
                          src={`/api/uploads/_candidates/${r.id}/${img.filename}`}
                          alt=""
                          // lazy จำเป็นทั้งสองชุด (การ์ดมือถือ + ตาราง) — รายการนี้ render ซ้ำ 2 ชุดแล้ว
                          // ซ่อนชุดหนึ่งด้วย CSS ถ้าไม่ lazy เบราว์เซอร์โหลดรูปของทุกแถวทั้งสองชุดทันที
                          // (วัดจริง 2026-09-29: 350 request / 5.7 MB ทั้งที่รูปโชว์แค่ 40px)
                          loading="lazy"
                          decoding="async"
                          className="size-10 rounded border border-border object-cover"
                        />
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.linkedEntryId === null ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleCreate(r)}
                        disabled={isUpdating}
                      >
                        สร้างงานเลย
                      </Button>
                    ) : (
                      <Link
                        href={`/entry/${r.linkedEntryId}`}
                        className="inline-flex h-11 items-center text-primary underline underline-offset-2 lg:h-9"
                      >
                        สร้างแล้ว →
                      </Link>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.badges.map((b) => (
                      <span
                        key={b.type}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs leading-relaxed font-medium whitespace-nowrap text-primary"
                      >
                        {b.type === "topSeller" ? (
                          <TrendingUp className="size-3 shrink-0" />
                        ) : (
                          <Coins className="size-3 shrink-0" />
                        )}
                        {b.type === "topSeller" ? "ขายดี" : "ค่าคอม/ชิ้น"} #{b.rank}
                      </span>
                    ))}
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {r.categoryLabel || "ไม่ระบุหมวด"}
                    </span>
                  </div>

                  <p className="font-mono text-lg font-bold text-foreground">
                    {r.demandTotal === null
                      ? "—"
                      : Math.round(r.demandTotal).toLocaleString()}
                  </p>

                  <dl className="grid grid-cols-3 gap-2 text-xs leading-relaxed">
                    <div>
                      <dt className="text-muted-foreground">ราคา</dt>
                      <dd className="font-mono text-foreground">
                        {r.price.toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ค่าคอม</dt>
                      <dd className="font-mono text-foreground">
                        {r.commission.toLocaleString()}
                        {plausible ? ` (${r.commissionPercent.toFixed(1)}%)` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ขาย/สัปดาห์</dt>
                      <dd className="font-mono text-foreground">
                        {r.weeklySales === null ? "—" : r.weeklySales.toLocaleString()}
                      </dd>
                    </div>
                  </dl>

                  {/* คำเตือนเป็นข้อความจริง ไม่ใช่ title= ที่จอสัมผัสไม่มีทางเห็น */}
                  {warnings.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {warnings.map((w) => (
                        <li
                          key={w.key}
                          className={cn(
                            "text-xs leading-relaxed",
                            w.danger ? "text-destructive" : "text-muted-foreground"
                          )}
                        >
                          {w.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {/* คลาส 3 ตัวนี้จำเป็นทั้งหมด ไม่ใช่ของประดับ (วัดจริงที่จอ 900px ทีละตัว):
           · min-w-0 — flex item มี min-width:auto โดยดีฟอลต์ จึงไม่ยอมหดต่ำกว่า min-content
             ของตารางข้างใน แล้วดันทั้งหน้าให้กว้างเกินจอแทนที่จะให้กล่องนี้สกรอลเอง
           · overflow-x-auto — ให้ตารางสกรอลแนวนอนในกล่องตัวเอง จอแคบจึงไม่พังทั้งหน้า
           · relative — sr-only ของ Tailwind คือ position:absolute ถ้าไม่มี ancestor ที่ positioned
             containing block จะไปตกที่ initial containing block แปลว่ามันหลุดการ clip ของกล่องนี้
             แล้วไปยืด scrollWidth ของหน้าเพจตามตำแหน่ง static ที่อยู่นอกจอ (วัดได้ล้น 209px
             จาก sr-only 21 ตัว) ใส่ relative แล้วเหลือ 0px โดยยังเก็บ sr-only ไว้ครบ */}
        <div className="relative hidden min-w-0 overflow-x-auto rounded-xl border border-border bg-surface md:block">
          <table className="w-full min-w-[64rem] border-collapse text-sm leading-relaxed">
            {/* หัวตารางไม่ sticky โดยตั้งใจ — overflow-x-auto ของ div ครอบทำให้ overflow-y
                คำนวณเป็น auto ตามสเปก CSS กล่องนั้นจึงเป็น scroll container ของตัวเองที่ไม่เคย
                สกรอล (scrollHeight === clientHeight) sticky เลยถูกขังไว้ข้างในและไม่ทำงาน
                ถ้าจะเอาหัวตารางติดบนจริง ต้องให้กล่องนี้มีความสูงจำกัดแล้วสกรอลเองทั้งสองแกน */}
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">ชื่อสินค้า</th>
                <th scope="col" className="px-3 py-2 font-medium">หมวด</th>
                <th scope="col" className="px-3 py-2 font-medium">ป้าย</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">ราคา</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">ค่าคอม</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">ขาย/สัปดาห์</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">%</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">ศักยภาพรายได้</th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">คำเตือน</span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const plausible = isCommissionPercentPlausible(r.commissionPercent);
                const warnings = buildCandidateWarnings(r, plausible);

                return (
                  <tr
                    key={r.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-foreground/5"
                  >
                    <td className="px-3 py-2">
                      <div
                        className="max-w-[22rem] truncate font-medium text-foreground"
                        title={r.name}
                      >
                        {r.name}
                      </div>
                      {r.images.length > 0 && (
                        <div className="mt-1 flex gap-1">
                          {r.images.slice(0, 3).map((img) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={img.id}
                              src={`/api/uploads/_candidates/${r.id}/${img.filename}`}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="size-10 rounded border border-border object-cover"
                            />
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2">
                      <div
                        className="max-w-[10rem] truncate text-muted-foreground"
                        title={`เก็บ ${formatThaiDate(r.capturedOn)}`}
                      >
                        {r.categoryLabel || "ไม่ระบุหมวด"}
                      </div>
                    </td>

                    <td className="px-3 py-2">
                      {r.badges.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {r.badges.map((b) => (
                            <span
                              key={b.type}
                              title={
                                (b.type === "topSeller"
                                  ? "ยอดขายดี"
                                  : "ค่าคอมต่อชิ้นสูงสุด") +
                                ` อันดับ ${b.rank} ในหมวด ${r.categoryLabel || "ไม่ระบุหมวด"}`
                              }
                              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs leading-relaxed font-medium whitespace-nowrap text-primary"
                            >
                              {b.type === "topSeller" ? (
                                <TrendingUp className="size-3 shrink-0" />
                              ) : (
                                <Coins className="size-3 shrink-0" />
                              )}
                              {b.type === "topSeller" ? "ขายดี" : "ค่าคอม/ชิ้น"} #{b.rank}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* ตัวเลขใช้ JetBrains Mono ให้หลักตรงกันทุกแถว (กฎ: mono เฉพาะตัวเลขที่เรียงเป็นคอลัมน์) */}
                    <td className="px-3 py-2 text-right font-mono text-foreground/80">
                      {r.price.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-foreground/80">
                      {r.commission.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-foreground/80">
                      {r.weeklySales === null ? "—" : r.weeklySales.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-foreground/80">
                      {plausible ? `${r.commissionPercent.toFixed(1)}%` : "—"}
                    </td>
                    {/* ศักยภาพรายได้เป็นคอลัมน์ที่ใช้เรียงลำดับ จึงเน้นให้ชัดกว่าตัวเลขอื่น */}
                    <td className="px-3 py-2 text-right font-mono font-medium text-foreground">
                      {r.demandTotal === null
                        ? "—"
                        : Math.round(r.demandTotal).toLocaleString()}
                    </td>

                    <td className="px-3 py-2">
                      {warnings.length > 0 && (
                        <div className="flex items-center gap-0.5">
                          {/* ไอคอนอย่างเดียวพึ่ง title (hover) ซึ่งแท็บเล็ต/มือถือที่จอ md–lg
                              ก็เป็นจอสัมผัสเหมือนกันไม่มีทาง hover ได้ — ใช้ Popover ที่กดแล้ว
                              เห็นข้อความจริงแทน title ยังคงไว้เป็นตัวช่วยสำหรับเมาส์ */}
                          {warnings.map((w) => (
                            <Popover key={w.key}>
                              <PopoverTrigger
                                render={
                                  <button
                                    type="button"
                                    title={w.text}
                                    aria-label={w.text}
                                    className="inline-flex size-6 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                  />
                                }
                              >
                                <TriangleAlert
                                  className={
                                    "size-4 shrink-0 " +
                                    (w.danger ? "text-destructive" : "text-primary")
                                  }
                                />
                                <span className="sr-only">{w.text}</span>
                              </PopoverTrigger>
                              <PopoverContent
                                align="start"
                                className="w-64 text-xs leading-relaxed text-foreground"
                              >
                                {w.text}
                              </PopoverContent>
                            </Popover>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        {r.linkedEntryId === null ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleCreate(r)}
                            disabled={isUpdating}
                          >
                            สร้างงานเลย
                          </Button>
                        ) : (
                          <Link
                            href={`/entry/${r.linkedEntryId}`}
                            className="inline-flex h-11 items-center text-primary underline underline-offset-2 lg:h-9"
                          >
                            สร้างแล้ว →
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {pickerFor && (
        <CandidateImagePicker
          candidateId={pickerFor.id}
          images={pickerFor.images}
          onConfirm={handleConfirmPicker}
          onCancel={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}
