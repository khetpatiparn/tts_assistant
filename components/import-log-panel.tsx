"use client";

import { useMemo } from "react";

import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";
import { daysUntil, nextImportDate } from "@/lib/import-schedule";
import {
  EXPECTED_CLIP_FILES,
  groupLatestRound,
  type ImportLogRecord,
} from "@/lib/import-log";

const KIND_LABEL: Record<string, string> = {
  orders: "รายได้",
  clips: "วิวคลิป",
};

/** เรียงตามความสำคัญของไฟล์ ไม่ใช่ตามตัวอักษร — รายได้สำคัญสุด */
const KIND_ORDER = ["orders", "clips"];

/** "3 ส.ค. 13:45" — uploadedAt เป็น timestamp จริง อ่านด้วย local */
function stamp(d: Date): string {
  return (
    d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
  );
}

/** วันเดียวไม่มีเวลา — ใช้กับหัวกลุ่มที่มีหลายไฟล์ และบรรทัดรอบถัดไป */
function dayOnly(d: Date): string {
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function staleDaysOf(kind: string, reminder: ReminderState): number | null {
  if (kind === "orders") return reminder.daysSinceOrdersImport;
  if (kind === "clips") return reminder.daysSinceMetricsImport;
  return null;
}

export function ImportLogPanel({
  logs,
  reminder,
  now,
  lastOrdersImportedAt,
  lastMetricsImportedAt,
}: {
  logs: ImportLogRecord[];
  reminder: ReminderState;
  now: Date;
  lastOrdersImportedAt: Date | null;
  lastMetricsImportedAt: Date | null;
}) {
  const rounds = useMemo(() => groupLatestRound(logs), [logs]);

  function importedAtOf(kind: string): Date | null {
    if (kind === "orders") return lastOrdersImportedAt;
    if (kind === "clips") return lastMetricsImportedAt;
    return null;
  }

  // แสดงชนิดที่ "มีแถว log" หรือ "มีข้อมูลนำเข้าแล้ว" อย่างใดอย่างหนึ่ง
  //
  // สองอย่างนี้ไม่เท่ากัน: ImportLog เพิ่งถูกเพิ่มทีหลัง รอบนำเข้ารายได้ที่เกิดก่อนหน้านั้น
  // จึงไม่มีแถว log ทั้งที่ข้อมูลมีอยู่จริง ถ้ายึดแถว log อย่างเดียวบรรทัดรายได้จะหายไปทั้งบรรทัด
  const visible = KIND_ORDER.map((kind) => ({
    kind,
    round: rounds.find((r) => r.kind === kind) ?? null,
    importedAt: importedAtOf(kind),
  })).filter((v) => v.round !== null || v.importedAt !== null);

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">อัปล่าสุด</p>
      {visible.map(({ kind, round, importedAt }) => {
        // "N จาก M ไฟล์" มีความหมายเฉพาะ kind "clips" เท่านั้น (ต้องอัป 3 ช่วงวันต่อรอบ)
        // ชนิดอื่นที่มีหลายไฟล์ในวันเดียวกันเป็นเรื่องปกติ ไม่มี "จำนวนที่ควรจะเป็น" ให้เทียบ
        const hasMultipleFiles = round !== null && round.files.length > 1;
        const isMultiExpectedKind = kind === "clips" && hasMultipleFiles;
        const stale = staleDaysOf(kind, reminder);
        const overdue = stale !== null && stale > IMPORT_STALE_DAYS;
        const due = nextImportDate(importedAt);
        const daysLeft = due === null ? null : daysUntil(due, now);

        return (
          <div key={kind} className="flex flex-col gap-0.5">
            <p className="text-xs">
              <span className="text-muted-foreground">{KIND_LABEL[kind] ?? kind}</span>{" "}
              <span className="text-foreground">
                {round === null
                  ? importedAt !== null
                    ? stamp(importedAt)
                    : "-"
                  : isMultiExpectedKind
                    ? `${dayOnly(round.files[0].uploadedAt)} · ${round.files.length} จาก ${EXPECTED_CLIP_FILES} ไฟล์`
                    : hasMultipleFiles
                      ? `${dayOnly(round.files[0].uploadedAt)} · อัป ${round.files.length} ครั้ง`
                      : `${stamp(round.files[0].uploadedAt)} · ${round.files[0].summary}`}
              </span>
              {overdue && (
                <span className="text-status-warning">
                  {" "}
                  — เกินกำหนดมา {stale - IMPORT_STALE_DAYS} วัน
                </span>
              )}
            </p>

            {/* เลยกำหนดแล้วใช้ข้อความเตือนด้านบนพอ ไม่ต้องบอกวันที่แนะนำซ้อนอีก */}
            {!overdue && due !== null && daysLeft !== null && (
              <p className="pl-4 text-xs text-muted-foreground">
                แนะนำรอบหน้า {dayOnly(due)}{" "}
                {daysLeft === 0 ? "(วันนี้)" : `(อีก ${daysLeft} วัน)`}
              </p>
            )}

            {hasMultipleFiles &&
              round !== null &&
              round.files.map((f) => (
                <p
                  key={f.uploadedAt.getTime()}
                  className="pl-4 text-xs text-muted-foreground"
                >
                  {f.summary} ({stamp(f.uploadedAt)})
                </p>
              ))}
          </div>
        );
      })}
    </div>
  );
}
