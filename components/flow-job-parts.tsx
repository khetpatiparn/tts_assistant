import Image from "next/image";
import { Download, Eraser } from "lucide-react";

import { EXTRA_PROMPT_MAX, FLOW_STATUS, friendlyJobMessage, videoDownloadName } from "@/lib/flow-jobs";
import { cn } from "@/lib/utils";
import type { BadgeVariant } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";

export function badgeVariant(status: string): BadgeVariant {
  if (status.startsWith("review_")) return "warning";
  if (status === FLOW_STATUS.DONE) return "success";
  if (status === FLOW_STATUS.FAILED) return "danger";
  return "neutral";
}

export function imgUrl(entryId: string, filename: string): string {
  return `/api/uploads/${entryId}/flow/${filename}`;
}

/** ชื่อรอบที่โชว์ใต้ชื่อสินค้า — รอบ 3/4 ไม่ใช่ "รอบวาด" จึงเรียกตามงานจริง */
export const ROUND_LABELS: Record<number, string> = { 1: "รอบ 1", 2: "รอบ 2", 3: "ทำคลิป", 4: "โหลด 1080p" };

export function timeLabel(d: Date | null): string {
  if (d === null) return "";
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

/**
 * ช่องข้อความเพิ่มเติมที่ต่อท้ายพรอมต์ของครั้งถัดไป + ปุ่มล้าง + ตัวอย่างพรอมต์ — ใช้ร่วมทั้งรอบรูปและรอบคลิป
 * (รอบคลิปไม่พิมพ์ 10-part prompt ทั้งก้อน ~3,000 ตัวลงหน้า โชว์แค่ส่วนที่ต่อท้าย)
 */
export function ExtraPromptField({
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

/** เครื่องเล่นคลิป + ปุ่มดาวน์โหลด — ใช้กับทุกสถานะที่มีไฟล์วิดีโอ (ดูตัวอย่าง/รอโหลด 1080p/พัง/เสร็จ) */
export function ClipPlayer({
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
    <div className={cn("flex flex-col gap-2", size === "lg" && "w-full max-w-72 lg:max-w-90")}>
      <video
        src={imgUrl(entryId, filename)}
        controls
        preload="metadata"
        className={cn(
          "aspect-[9/16] rounded-md bg-surface-2",
          done ? "border-2 border-status-success" : "border border-border",
          size === "lg" ? "w-full" : "w-28 lg:w-36"
        )}
      />
      <a
        href={imgUrl(entryId, filename)}
        download={videoDownloadName(productName)}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), size === "lg" && "self-start")}
      >
        <Download data-icon="inline-start" /> ดาวน์โหลดคลิป
      </a>
    </div>
  );
}

/** ข้อความของงานแบบอ่านง่าย 1 บรรทัด + ข้อความดิบเต็มพับไว้ใน "รายละเอียด" */
export function JobMessage({ status, message }: { status: string; message: string }) {
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


/** รูปย่อ 48px ของงาน (ใช้ในรายการ) */
export function JobThumb({ entryId, filename }: { entryId: string; filename: string | null }) {
  if (filename === null) {
    return <span aria-hidden="true" className="size-12 shrink-0 rounded-md border border-border bg-surface-2" />;
  }
  return <Image src={imgUrl(entryId, filename)} alt="" width={96} height={128} className="size-12 shrink-0 rounded-md border border-border object-cover" />;
}
