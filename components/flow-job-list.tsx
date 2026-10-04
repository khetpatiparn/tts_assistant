"use client";

import { Download, FolderCheck } from "lucide-react";

import type { FlowJobRow } from "@/lib/flow-queries";
import { FLOW_STATUS, STATUS_LABELS, jobKindLabel, videoDownloadName, type FlowStatus } from "@/lib/flow-jobs";
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
}: {
  jobs: FlowJobRow[];
  selectedId: string | null;
  renderEnabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col border-t border-border">
      {jobs.map((job) => (
        <FlowJobListItem
          key={job.id}
          job={job}
          selected={job.id === selectedId}
          renderEnabled={renderEnabled}
          onSelect={() => onSelect(job.id)}
        />
      ))}
    </ul>
  );
}

function FlowJobListItem({
  job,
  selected,
  renderEnabled,
  onSelect,
}: {
  job: FlowJobRow;
  selected: boolean;
  renderEnabled: boolean;
  onSelect: () => void;
}) {
  const kind = jobKindLabel(job.status, job.round);
  const thumb = job.chosenRound2 ?? job.chosenRound1 ?? job.candidates[job.candidates.length - 1] ?? null;
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
