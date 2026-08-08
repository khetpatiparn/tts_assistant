"use client";

import { useMemo } from "react";
import { ClipboardList } from "lucide-react";

import type { AffiliateOrderRecord } from "@/lib/dashboard";
import { repeatStatus } from "@/lib/angle";
import { daysUntil, nextImportDate } from "@/lib/import-schedule";
import {
  buildClipStats,
  detectTasks,
  type ClipMetricRecord,
  type ClipSignalKind,
  type ClipTask,
} from "@/lib/recommender";

const KIND_LABEL: Record<ClipSignalKind, string> = {
  growing: "กำลังโต",
  proven: "ขายดีจริง",
};

/** ทั้งสองเป็นสัญญาณเชิงบวก ต่างกันที่ "โตเร็ว" กับ "ขายได้จริง" จึงแยกสีให้จำง่าย */
const KIND_CLASS: Record<ClipSignalKind, string> = {
  growing: "border-primary/50 bg-primary/10 text-primary",
  proven: "border-status-success/50 bg-status-success/10 text-status-success",
};

/** "3 ส.ค." — importedAt เป็น timestamp จริง อ่านด้วย local getter */
function shortThaiDate(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

/**
 * บรรทัดบอกว่าทำตามงานนี้ไปแล้วหรือยัง — ตรวจจากสายเลือดการทำซ้ำ ไม่ใช่ให้ติ๊กเอง
 * (ปัญหาต้นทางของผู้ใช้คือลืม/ไม่ได้ทำ ของที่ต้องจำไปติ๊กคือของที่ลืมได้อีกอย่าง)
 */
function repeatLine(
  entries: {
    id: string;
    duplicatedFromId: string | null;
    videoUrl: string;
    postedAt: Date | null;
  }[],
  entryId: string
): string | null {
  const status = repeatStatus(entries, entryId);
  if (status.repeats === 0) return null;
  const bits = [`ทำซ้ำไปแล้ว ${status.repeats} คลิป`];
  if (status.lastPostedAt) {
    // postedAt เก็บเป็น UTC midnight จึงต้องอ่านด้วย timeZone UTC ไม่ใช่ local
    bits.push(
      "ลงล่าสุด " +
        status.lastPostedAt.toLocaleDateString("th-TH", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })
    );
  }
  if (status.hasUnposted) bits.push("มีที่ยังไม่ได้ลง");
  return bits.join(" · ");
}

/** บรรทัดตัวเลขใต้ชื่อสินค้า — ประกอบเฉพาะส่วนที่มีข้อมูลจริง */
function detailLine(task: ClipTask): string {
  const bits: string[] = [];
  if (task.viewDelta !== null) {
    bits.push(
      `วิวเพิ่ม ${task.viewDelta.toLocaleString("th-TH")} ในรอบล่าสุด (รวม ${task.views.toLocaleString("th-TH")})`
    );
  } else {
    bits.push(`${task.views.toLocaleString("th-TH")} วิว`);
  }
  bits.push(`${task.orders.toLocaleString("th-TH")} ออเดอร์`);
  if (task.convRatioRange !== null) {
    // แสดงเป็นช่วงไม่ใช่ตัวเลขเดียว — ตัวเลขเดียวสร้างความมั่นใจเกินกว่าที่ข้อมูลรองรับ
    bits.push(
      `conv ${task.convRatioRange.low.toFixed(2)}-${task.convRatioRange.high.toFixed(2)} เท่าของช่อง`
    );
  }
  return bits.join(" · ");
}

export function Recommendations({
  entries,
  metrics,
  orders,
  now,
  lastOrdersImportedAt,
  lastMetricsImportedAt,
  onOpenEntry,
}: {
  entries: {
    id: string;
    productName: string;
    duplicatedFromId: string | null;
    videoUrl: string;
    postedAt: Date | null;
  }[];
  metrics: ClipMetricRecord[];
  orders: AffiliateOrderRecord[];
  now: Date;
  lastOrdersImportedAt: Date | null;
  lastMetricsImportedAt: Date | null;
  onOpenEntry: (entryId: string) => void;
}) {
  const stats = useMemo(
    () => buildClipStats({ entries, metrics, orders, now }),
    [entries, metrics, orders, now]
  );
  const tasks = useMemo(() => detectTasks(stats), [stats]);

  const withMetrics = new Set(
    metrics.filter((m) => m.matchedEntryId !== null).map((m) => m.matchedEntryId)
  );
  const missing = entries.filter((e) => !withMetrics.has(e.id)).length;
  const hasDelta =
    metrics.length > 0 &&
    new Set(metrics.map((m) => m.capturedOn.getTime())).size >= 2;

  // deadline ยึดชนิดข้อมูลที่เก่าที่สุด เพราะผลลัพธ์สดได้เท่ากับข้อมูลที่ล้าหลังที่สุดเท่านั้น
  const importedDates = [lastMetricsImportedAt, lastOrdersImportedAt].filter(
    (d): d is Date => d !== null
  );
  const oldestImport =
    importedDates.length === 0
      ? null
      : new Date(Math.min(...importedDates.map((d) => d.getTime())));
  const due = nextImportDate(oldestImport);
  const daysLeft = due === null ? null : daysUntil(due, now);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <ClipboardList className="size-4 text-primary" />
          งานรอบนี้
        </span>
        <span className="text-xs text-muted-foreground">
          {tasks.length > 0 ? `${tasks.length} งาน` : "ไม่มีอะไรต้องรีบ"}
        </span>
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span>
          {lastMetricsImportedAt !== null
            ? `ข้อมูลวิวนำเข้า ${shortThaiDate(lastMetricsImportedAt)}`
            : "ยังไม่เคยนำเข้าข้อมูลวิว"}
          {" · "}
          {lastOrdersImportedAt !== null
            ? `รายได้นำเข้า ${shortThaiDate(lastOrdersImportedAt)}`
            : "ยังไม่เคยนำเข้าข้อมูลรายได้"}
        </span>
        {due !== null && daysLeft !== null && (
          <span>
            {daysLeft >= 0
              ? `ทำก่อนนำเข้ารอบหน้า — ${shortThaiDate(due)} (${daysLeft === 0 ? "วันนี้" : `อีก ${daysLeft} วัน`})`
              : `เลยรอบนำเข้ามาแล้ว ${Math.abs(daysLeft)} วัน — นำเข้าข้อมูลใหม่เพื่อคำนวณงานรอบถัดไป`}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <p className="text-sm text-muted-foreground">
            รอบนี้ไม่มีคลิปที่เข้าเกณฑ์ — ลงคลิปใหม่ต่อได้ตามปกติ
          </p>
          <p className="text-xs text-muted-foreground">
            (ตรวจ {stats.filter((s) => s.views > 0).length} คลิปที่มีข้อมูลครบ)
          </p>
        </div>
      ) : (
        tasks.map((task) => {
          const line = repeatLine(entries, task.entryId);
          return (
            <button
              type="button"
              key={task.entryId}
              onClick={() => onOpenEntry(task.entryId)}
              className="flex min-h-9 flex-col gap-1 rounded-md border-t border-border px-1 py-2 text-left transition-colors first:border-t-0 hover:bg-muted"
            >
              <div className="flex flex-wrap items-center gap-2">
                {task.kinds.map((kind) => (
                  <span
                    key={kind}
                    className={`rounded border px-1.5 py-0.5 text-xs ${KIND_CLASS[kind]}`}
                  >
                    {KIND_LABEL[kind]}
                  </span>
                ))}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {task.productName}
                </span>
              </div>
              <p className="text-sm text-foreground/80">ทำ angle ใหม่ซ้ำ</p>
              <p className="text-xs text-muted-foreground">{detailLine(task)}</p>
              {line !== null && <p className="text-xs text-primary">{line}</p>}
            </button>
          );
        })
      )}

      <div className="flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
        {missing > 0 && (
          <span>
            ยังไม่มีข้อมูลวิว {missing} คลิป — นำเข้าไฟล์ Content รอบใหม่เพื่อให้ครบ
          </span>
        )}
        {!hasDelta && (
          <span>สัญญาณด้านความเคลื่อนไหวจะใช้ได้หลังนำเข้าข้อมูลวิวรอบที่ 2</span>
        )}
      </div>
    </div>
  );
}
