"use client";

import { Download, FolderCheck } from "lucide-react";

import type { FlowJobRow } from "@/lib/flow-queries";
import { FLOW_STATUS, STATUS_LABELS, closeTimeLabel, currentSourceImage, groupClosedByDay, jobKindLabel, videoDownloadName, type FlowStatus } from "@/lib/flow-jobs";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FlowStepperCompact } from "@/components/flow-stepper";
import { JobThumb, badgeVariant, imgUrl } from "@/components/flow-job-parts";

/** รายการงานของแท็บที่เลือก (ฝั่งซ้ายของหน้า /flow) · กดแถว = เลือกงาน · ป้ายรอบ/ชนิดงานมาจาก jobKindLabel */
export function FlowJobList({
  jobs,
  selectedId,
  renderEnabled,
  onSelect,
  groupByDayFrom,
}: {
  jobs: FlowJobRow[];
  selectedId: string | null;
  renderEnabled: boolean;
  onSelect: (id: string) => void;
  /** แท็บ เสร็จ / ข้าม: ส่ง "ตอนนี้" มา = แบ่งกลุ่มตามวันปิด (jobs ต้องเรียงตามเวลาปิดแล้ว) + โชว์เวลาปิดในแถว */
  groupByDayFrom?: Date | null;
}) {
  const item = (job: FlowJobRow) => (
    <FlowJobListItem
      key={job.id}
      job={job}
      selected={job.id === selectedId}
      renderEnabled={renderEnabled}
      showCloseTime={groupByDayFrom != null}
      onSelect={() => onSelect(job.id)}
    />
  );
  if (groupByDayFrom == null) return <ul className="flex flex-col border-t border-border">{jobs.map(item)}</ul>;
  return (
    <div className="flex flex-col gap-4">
      {groupClosedByDay(jobs, groupByDayFrom).map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h2 className="pb-1 text-sm leading-relaxed font-semibold text-foreground">{g.label}</h2>
          <ul className="flex flex-col border-t border-border">{g.jobs.map(item)}</ul>
        </section>
      ))}
    </div>
  );
}

function FlowJobListItem({
  job,
  selected,
  renderEnabled,
  showCloseTime,
  onSelect,
}: {
  job: FlowJobRow;
  selected: boolean;
  renderEnabled: boolean;
  showCloseTime: boolean;
  onSelect: () => void;
}) {
  const kind = jobKindLabel(job.status, job.round);
  // ยังไม่มีรูปที่วาดของรอบนี้ (รอบอท/เพิ่งเปลี่ยนรูปต้นทาง) → รูปต้นทางปัจจุบัน
  const thumb = job.chosenRound2 ?? job.chosenRound1 ?? job.candidates[job.candidates.length - 1] ?? currentSourceImage(job.sources);
  return (
    <li
      className={cn(
        "flex items-center gap-1 border-b border-l-4 border-b-border py-1 pr-1",
        selected ? "border-l-primary bg-surface" : "border-l-transparent"
      )}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <JobThumb entryId={job.entryId} filename={thumb?.filename ?? null} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="line-clamp-2 text-sm leading-relaxed font-semibold break-words text-foreground">{job.productName}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <FlowStepperCompact
              status={job.status}
              round={job.round}
              imagesOnly={job.status === FLOW_STATUS.DONE && !renderEnabled && job.video === null}
            />
            {kind !== null && <Badge variant="neutral">{kind}</Badge>}
            <Badge variant={badgeVariant(job.status)}>{STATUS_LABELS[job.status as FlowStatus] ?? job.status}</Badge>
            {job.tookOver && <Badge variant="neutral">ทำเอง</Badge>}
            {showCloseTime && <span className="text-xs leading-relaxed text-muted-foreground">{closeTimeLabel(job)}</span>}
            {job.exportedPath !== null && (
              <span className="flex items-center gap-1 text-xs leading-relaxed text-muted-foreground">
                <FolderCheck aria-hidden="true" className="size-4" /> ส่ง TTS แล้ว
              </span>
            )}
          </span>
        </span>
      </button>
      {job.status === FLOW_STATUS.DONE && job.video && (
        <a
          href={imgUrl(job.entryId, job.video.filename)}
          download={videoDownloadName(job.productName)}
          aria-label="ดาวน์โหลดคลิป"
          title="ดาวน์โหลดคลิป"
          className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "shrink-0")}
        >
          <Download />
        </a>
      )}
    </li>
  );
}
