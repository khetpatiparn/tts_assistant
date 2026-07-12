"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PromptEntry } from "@/components/prompt-workspace";

export function HistoryRail({
  prompts,
  selectedId,
  onSelect,
  onNew,
  onDelete,
}: {
  prompts: PromptEntry[];
  selectedId: string | null;
  onSelect: (entry: PromptEntry) => void;
  onNew: () => void;
  onDelete: (id: string, event: React.MouseEvent) => void;
}) {
  const total = prompts.length;

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-hidden bg-ink px-3 py-4 text-paper lg:h-full lg:w-60">
      <Button
        onClick={onNew}
        className="w-full bg-marigold text-ink shadow-none hover:bg-marigold/90"
      >
        <Plus className="size-4" />
        สินค้าใหม่
      </Button>

      <p className="px-1 pt-1 font-mono text-[0.65rem] tracking-widest text-paper/40 uppercase">
        ประวัติ ({total})
      </p>

      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {prompts.map((entry, index) => {
          const takeNumber = total - index;
          const isActive = selectedId === entry.id;
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md border-l-2 border-transparent px-2.5 py-2 text-left text-sm text-paper/80 transition-colors hover:bg-ink-2 hover:text-paper",
                  isActive && "border-marigold bg-ink-2 text-paper"
                )}
              >
                <span className="shrink-0 font-mono text-[0.65rem] text-marigold/80">
                  T{String(takeNumber).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.productName}</span>
                <span
                  role="button"
                  aria-label="ลบรายการ"
                  onClick={(event) => onDelete(entry.id, event)}
                  className="shrink-0 text-paper/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-record"
                >
                  <Trash2 className="size-3.5" />
                </span>
              </button>
            </li>
          );
        })}
        {prompts.length === 0 && (
          <li className="px-2.5 py-2 text-sm text-paper/40">ยังไม่มีรายการ</li>
        )}
      </ul>
    </aside>
  );
}
