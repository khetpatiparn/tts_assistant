"use client";

import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PromptEntry } from "@/components/prompt-workspace";

const UNDATED_GROUP = "ยังไม่ได้ลงคลิป";

/** An entry still needs work until both the ChatGPT output and the clip link are in. */
function isIncomplete(entry: PromptEntry) {
  return entry.chatgptOutput.trim() === "" || entry.videoUrl.trim() === "";
}

/** "ก.ค. 2026" — the month bucket an entry belongs to. */
function monthLabel(postedAt: Date | null) {
  if (!postedAt) return UNDATED_GROUP;
  return new Date(postedAt).toLocaleDateString("th-TH", {
    month: "short",
    year: "numeric",
  });
}

/** "12 ก.ค." — the short date shown next to a product name. */
function shortDate(postedAt: Date | null) {
  if (!postedAt) return null;
  return new Date(postedAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}

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
  const [query, setQuery] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const total = prompts.length;

  // Take numbers are assigned over the full list so they stay stable no
  // matter what is filtered out of view.
  const groups = useMemo(() => {
    const numbered = prompts.map((entry, index) => ({
      entry,
      takeNumber: prompts.length - index,
    }));

    const needle = query.trim().toLowerCase();
    const visible = numbered.filter(({ entry }) => {
      if (onlyIncomplete && !isIncomplete(entry)) return false;
      if (needle && !entry.productName.toLowerCase().includes(needle)) return false;
      return true;
    });

    // Entries arrive pre-sorted, so walking them in order yields month
    // buckets already in the right sequence.
    const buckets: { label: string; items: typeof visible }[] = [];
    for (const item of visible) {
      const label = monthLabel(item.entry.postedAt);
      const last = buckets[buckets.length - 1];
      if (last && last.label === label) {
        last.items.push(item);
      } else {
        buckets.push({ label, items: [item] });
      }
    }
    return buckets;
  }, [prompts, query, onlyIncomplete]);

  const visibleCount = groups.reduce((sum, g) => sum + g.items.length, 0);
  const isFiltering = query.trim() !== "" || onlyIncomplete;

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-hidden bg-ink px-3 py-4 text-paper lg:h-full lg:w-60">
      <Button
        onClick={onNew}
        className="w-full bg-marigold text-ink shadow-none hover:bg-marigold/90"
      >
        <Plus className="size-4" />
        สินค้าใหม่
      </Button>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-paper/40" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาสินค้า"
          aria-label="ค้นหาสินค้า"
          className="border-paper/15 bg-ink-2 pl-8 text-paper placeholder:text-paper/40"
        />
      </div>

      <button
        type="button"
        onClick={() => setOnlyIncomplete((v) => !v)}
        aria-pressed={onlyIncomplete}
        className={cn(
          "rounded-md px-2.5 py-1.5 text-left font-mono text-[0.65rem] tracking-widest uppercase transition-colors",
          onlyIncomplete
            ? "bg-marigold text-ink"
            : "text-paper/40 hover:bg-ink-2 hover:text-paper/70"
        )}
      >
        ยังไม่ได้กรอกผลลัพธ์
      </button>

      <p className="px-1 font-mono text-[0.65rem] tracking-widest text-paper/40 uppercase">
        {isFiltering ? `แสดง ${visibleCount}/${total}` : `ประวัติ (${total})`}
      </p>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="px-1 font-mono text-[0.6rem] tracking-widest text-marigold/60 uppercase">
              {group.label}
            </p>
            <ul className="flex flex-col gap-1">
              {group.items.map(({ entry, takeNumber }) => {
                const isActive = selectedId === entry.id;
                const date = shortDate(entry.postedAt);
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
                      {date && (
                        <span className="shrink-0 font-mono text-[0.6rem] text-paper/30">
                          {date}
                        </span>
                      )}
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
            </ul>
          </div>
        ))}

        {total === 0 && (
          <p className="px-2.5 py-2 text-sm text-paper/40">ยังไม่มีรายการ</p>
        )}
        {total > 0 && visibleCount === 0 && (
          <p className="px-2.5 py-2 text-sm text-paper/40">ไม่พบรายการ</p>
        )}
      </div>
    </aside>
  );
}
