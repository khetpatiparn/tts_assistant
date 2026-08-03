"use client";

import { useMemo } from "react";

import { IMPORT_STALE_DAYS, type ReminderState } from "@/lib/dashboard";
import {
  EXPECTED_CLIP_FILES,
  groupLatestRound,
  type ImportLogRecord,
} from "@/lib/import-log";

const KIND_LABEL: Record<string, string> = {
  orders: "รายได้",
  clips: "วิวคลิป",
  channel: "วิวทั้งช่อง",
  followers: "ผู้ติดตาม",
};

/** เรียงตามความสำคัญของไฟล์ ไม่ใช่ตามตัวอักษร — รายได้สำคัญสุด */
const KIND_ORDER = ["orders", "clips", "channel", "followers"];

/** "3 ส.ค. 13:45" — uploadedAt เป็น timestamp จริง อ่านด้วย local */
function stamp(d: Date): string {
  return (
    d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
  );
}

/** วันเดียวไม่มีเวลา — ใช้กับหัวกลุ่มที่มีหลายไฟล์ */
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
}: {
  logs: ImportLogRecord[];
  reminder: ReminderState;
}) {
  const rounds = useMemo(() => groupLatestRound(logs), [logs]);
  if (rounds.length === 0) return null;

  const sorted = [...rounds].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  );

  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">
        อัปล่าสุด
      </p>
      {sorted.map((r) => {
        // "N จาก M ไฟล์" มีความหมายเฉพาะ kind "clips" เท่านั้น (ต้องอัป 3 ช่วงวันต่อรอบ)
        // ชนิดอื่น (เช่น orders) ที่มีหลายไฟล์ในวันเดียวกันเป็นเรื่องปกติ/ที่แนะนำ
        // (อัปซ้ำช่วงกว้างขึ้นเรื่อยๆ ตาม CLAUDE.md) ไม่มี "จำนวนที่ควรจะเป็น" ให้เทียบ
        const hasMultipleFiles = r.files.length > 1;
        const isMultiExpectedKind = r.kind === "clips" && hasMultipleFiles;
        const stale = staleDaysOf(r.kind, reminder);
        const overdue = stale !== null && stale > IMPORT_STALE_DAYS;
        return (
          <div key={r.kind} className="flex flex-col gap-0.5">
            <p className="font-mono text-[0.7rem]">
              <span className="text-muted-foreground">
                {KIND_LABEL[r.kind] ?? r.kind}
              </span>{" "}
              <span className="text-foreground">
                {isMultiExpectedKind
                  ? `${dayOnly(r.files[0].uploadedAt)} · ${r.files.length} จาก ${EXPECTED_CLIP_FILES} ไฟล์`
                  : hasMultipleFiles
                    ? `${dayOnly(r.files[0].uploadedAt)} · อัป ${r.files.length} ครั้ง`
                    : `${stamp(r.files[0].uploadedAt)} · ${r.files[0].summary}`}
              </span>
              {overdue && (
                <span className="text-danger">
                  {" "}
                  — เกินกำหนดมา {stale - IMPORT_STALE_DAYS} วัน
                </span>
              )}
            </p>
            {hasMultipleFiles &&
              r.files.map((f) => (
                <p
                  key={f.uploadedAt.getTime()}
                  className="pl-4 font-mono text-[0.65rem] text-muted-foreground"
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
