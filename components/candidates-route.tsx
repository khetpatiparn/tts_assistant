"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  ClipboardPaste,
  Lightbulb,
  Package,
  Percent,
  TrendingUp,
  TriangleAlert,
  X,
} from "lucide-react";

import {
  createEntryFromCandidate,
  extractCandidates,
  setCandidateStatus,
} from "@/app/actions";
import type {
  CandidateRow,
  CategorySummary,
  FocusCategory,
} from "@/lib/candidate-queries";
import { playCompletionSound } from "@/lib/completion-sound";
import { IMPORT_STALE_DAYS } from "@/lib/import-schedule";
import { Button } from "@/components/ui/button";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

type StatusFilter = "active" | "all" | "new" | "interested" | "rejected";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "active", label: "ยังไม่ปัดตก" },
  { key: "new", label: "ยังไม่ตัดสิน" },
  { key: "interested", label: "สนใจ" },
  { key: "rejected", label: "ปัดตกแล้ว" },
  { key: "all", label: "ทั้งหมด" },
];

function imageFilesFrom(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => ALLOWED.includes(f.type));
}

function formatThaiDate(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function CandidatesRoute({
  rows,
  summaries,
  benchmarkPercent,
  benchmarkOrderCount,
  focus,
  now,
}: {
  rows: CandidateRow[];
  summaries: CategorySummary[];
  benchmarkPercent: number;
  benchmarkOrderCount: number;
  focus: FocusCategory[];
  now: Date;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [isExtracting, startExtracting] = useTransition();
  const [isUpdating, startUpdating] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    let list = rows;
    if (filter === "active") list = list.filter((r) => r.status !== "rejected");
    else if (filter !== "all") list = list.filter((r) => r.status === filter);
    if (categoryFilter !== null) {
      list = list.filter((r) => (r.categoryLabel || "ไม่ระบุหมวด") === categoryFilter);
    }
    // เรียงตามดีมานด์รวมมากไปน้อย แถวที่ไม่มีดีมานด์รวม (ขาดยอดขาย) ไปท้ายสุด
    return [...list].sort((a, b) => (b.demandTotal ?? -1) - (a.demandTotal ?? -1));
  }, [rows, filter, categoryFilter]);

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
          `เพิ่มใหม่ ${r.added} รายการ · อัปเดต ${r.updated} รายการ` +
            (r.skipped > 0 ? ` · ข้ามบรรทัดที่อ่านไม่ออก ${r.skipped}` : "")
        );
      } catch (e) {
        outcome = "error";
        setError(e instanceof Error ? e.message : "อ่านข้อมูลจากรูปไม่สำเร็จ");
      }
      playCompletionSound(outcome);
    });
  }

  function handleStatus(id: string, status: string) {
    startUpdating(async () => {
      try {
        await setCandidateStatus(id, status);
      } catch (e) {
        setError(e instanceof Error ? e.message : "อัปเดตสถานะไม่สำเร็จ");
      }
    });
  }

  function handleCreate(id: string) {
    startUpdating(async () => {
      try {
        await createEntryFromCandidate(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "สร้างรายการไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
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

      {/* สรุปหมวดที่เก็บมาแล้ว */}
      {summaries.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 leading-relaxed">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Package className="size-4 shrink-0 text-primary" />
            เก็บมาแล้วในระบบ
          </p>
          <div className="flex flex-wrap gap-2">
            {summaries.map((s) => {
              const age = daysBetween(s.lastCapturedOn, now);
              const stale = age > IMPORT_STALE_DAYS;
              const selected = categoryFilter === s.label;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setCategoryFilter(selected ? null : s.label)}
                  aria-pressed={selected}
                  className={
                    "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-interactive px-3 text-sm transition-colors " +
                    (selected
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-foreground/5")
                  }
                >
                  {s.label} {s.count} รายการ
                  <span className={selected ? "text-primary-foreground/80" : "text-muted-foreground"}>
                    · {formatThaiDate(s.lastCapturedOn)}
                  </span>
                  {stale && <TriangleAlert className="size-3.5 shrink-0 text-destructive" />}
                </button>
              );
            })}
          </div>
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
        {result && <p className="text-sm text-foreground/80">{result}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      {/* ตัวกรองสถานะ */}
      <div className="inline-flex flex-wrap gap-1 self-start rounded-lg border border-border-interactive p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors " +
              (filter === f.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ตารางผลลัพธ์ */}
      {visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed text-muted-foreground">
          ยังไม่มีสินค้าในรายการนี้ — แปะแคปหน้าจัดอันดับสินค้าด้านบนเพื่อเริ่ม
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((r) => {
            const better = benchmarkOrderCount > 0 && r.commissionPercent > benchmarkPercent;
            return (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 leading-relaxed"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <span
                    aria-hidden
                    className={
                      "mt-1 size-2.5 shrink-0 rounded-full " +
                      (benchmarkOrderCount === 0
                        ? "bg-muted-foreground"
                        : better
                          ? "bg-primary"
                          : "bg-destructive")
                    }
                  />
                  <p className="flex-1 text-base font-medium text-foreground">{r.name}</p>
                </div>

                {r.badges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {r.badges.includes("topSeller") && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs leading-relaxed font-medium text-primary">
                        <TrendingUp className="size-3 shrink-0" />
                        ยอดขายดี
                      </span>
                    )}
                    {r.badges.includes("topCommission") && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs leading-relaxed font-medium text-primary">
                        <Percent className="size-3 shrink-0" />
                        ค่าคอมสูงสุด
                      </span>
                    )}
                  </div>
                )}

                <p className="text-sm text-foreground/80">
                  ราคา {r.price.toLocaleString()} · ค่าคอม {r.commission.toLocaleString()} ·{" "}
                  {r.weeklySales === null
                    ? "ไม่มีข้อมูลยอดขาย"
                    : `ขายได้ ${r.weeklySales.toLocaleString()}/สัปดาห์`}
                </p>

                <p className="text-sm text-foreground/80">
                  ได้ {r.commissionPercent.toFixed(1)}%
                  {benchmarkOrderCount === 0
                    ? " — ยังไม่มีข้อมูลยอดขายมาเทียบ"
                    : better
                      ? ` — ดีกว่าค่าคอมจริงเฉลี่ยของคุณ (${benchmarkPercent.toFixed(1)}%)`
                      : ` — ต่ำกว่าค่าคอมจริงเฉลี่ยของคุณ (${benchmarkPercent.toFixed(1)}%)`}
                </p>

                {r.demandTotal === null ? (
                  <p className="flex items-start gap-1.5 text-sm text-destructive">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    แถวนี้ไม่มีตัวเลขยอดขาย (น่าจะมาจากหน้า &quot;คะแนนสูงสุด&quot;) จัดอันดับให้ไม่ได้ —
                    ลองแคปจากหน้า &quot;ขายดีที่สุด&quot; แทน
                  </p>
                ) : (
                  <p className="text-sm text-foreground/80">
                    ดีมานด์รวม {Math.round(r.demandTotal).toLocaleString()}
                  </p>
                )}

                {r.flags.includes("mechanism") && (
                  <p className="flex items-start gap-1.5 text-sm text-foreground/80">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
                    ชื่อบ่งบอกว่าอาจมีกลไก (พับ/หมุน/ปรับระดับ) — ตรวจรูปสินค้าก่อนทำ
                  </p>
                )}
                {r.flags.includes("heavyText") && (
                  <p className="flex items-start gap-1.5 text-sm text-foreground/80">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
                    อาจมีฉลาก/ข้อความบนตัวสินค้าเยอะ — AI สร้างวิดีโอมักทำตัวหนังสือเพี้ยน
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {r.status === "done" ? (
                    <span className="text-sm text-muted-foreground">สร้างรายการแล้ว</span>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatus(r.id, "interested")}
                        disabled={isUpdating || r.status === "interested"}
                      >
                        {r.status === "interested" ? "สนใจอยู่" : "สนใจ"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleStatus(r.id, "rejected")}
                        disabled={isUpdating || r.status === "rejected"}
                      >
                        {r.status === "rejected" ? "ปัดตกแล้ว" : "ปัดตก"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleCreate(r.id)}
                        disabled={isUpdating}
                      >
                        สร้างงานเลย
                      </Button>
                    </>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {r.categoryLabel || "ไม่ระบุหมวด"} · เก็บ {formatThaiDate(r.capturedOn)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
