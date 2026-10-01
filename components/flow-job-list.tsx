"use client";

import { ChevronRight, Download, FolderCheck } from "lucide-react";

import type { FlowJobRow } from "@/lib/flow-queries";
import { FLOW_STATUS, STATUS_LABELS, videoDownloadName, type FlowStatus } from "@/lib/flow-jobs";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FlowStepperCompact } from "@/components/flow-stepper";
import { JobThumb, badgeVariant, imgUrl } from "@/components/flow-job-parts";

export type FlowListGroup = { key: string; title: string; jobs: FlowJobRow[]; collapsible: boolean; open: boolean };

/** รายการงาน (ฝั่งซ้ายของหน้า /flow) · กดแถว = เลือกงาน · กลุ่มที่พับ (เสร็จแล้ว/ข้ามแล้ว) ไม่ render แถว */
export function FlowJobList({
  groups,
  selectedId,
  renderEnabled,
  onSelect,
  onToggleGroup,
}: {
  groups: FlowListGroup[];
  selectedId: string | null;
  renderEnabled: boolean;
  onSelect: (id: string) => void;
  onToggleGroup: (key: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {groups.map((g) => [
        <li key={`h-${g.key}`} className="border-b border-border pt-3 pb-1">
          {g.collapsible ? (
            <button
              type="button"
              aria-expanded={g.open}
              onClick={() => onToggleGroup(g.key)}
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-sm font-semibold text-foreground hover:bg-surface-2 lg:min-h-9"
            >
              <ChevronRight aria-hidden="true" className={cn("size-4 shrink-0 transition-transform", g.open && "rotate-90")} />
              {g.title} ({g.jobs.length})
            </button>
          ) : (
            <h2 className="px-1 text-sm font-semibold text-foreground">
              {g.title} ({g.jobs.length})
            </h2>
          )}
        </li>,
        ...(g.open
          ? g.jobs.map((job) => (
              <FlowJobListItem
                key={job.id}
                job={job}
                selected={job.id === selectedId}
                renderEnabled={renderEnabled}
                onSelect={() => onSelect(job.id)}
              />
            ))
          : []),
      ])}
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
            <Badge variant={badgeVariant(job.status)}>{STATUS_LABELS[job.status as FlowStatus] ?? job.status}</Badge>
            {job.exportedPath !== null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
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
