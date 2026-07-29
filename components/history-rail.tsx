"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Copy, EllipsisVertical, Plus, Search, Trash2 } from "lucide-react";
import { Menu } from "@base-ui/react/menu";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PromptEntry } from "@/components/prompt-workspace";
import { matchTier, splitTerms, type MatchTier } from "@/lib/entry-search";

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
    timeZone: "UTC",
  });
}

/**
 * "12 ก.ค." ของวันที่สร้าง — ใช้กับ entry ที่ยังไม่ได้ลงคลิป (postedAt เป็น null)
 *
 * ต้องแยกจาก shortDate เพราะ createdAt เป็น timestamp จริง (อ่านด้วย local getter)
 * ส่วน postedAt เก็บเป็น UTC midnight — ใช้ตัวจัดรูปแบบร่วมกันจะเพี้ยนไป 1 วันสำหรับ
 * entry ที่สร้างก่อน 7 โมงเช้าเวลาไทย (กับดักเดียวกับ toDateInputValue ใน production-panel.tsx)
 */
function shortCreatedDate(createdAt: Date) {
  return new Date(createdAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}

export function HistoryRail({
  prompts,
  selectedId,
  onSelect,
  onNew,
  onDuplicate,
  onDelete,
}: {
  prompts: PromptEntry[];
  selectedId: string | null;
  onSelect: (entry: PromptEntry) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  // ผลที่แมตช์เฉพาะ productInfo (ข้อความร้าน) พับไว้เป็นค่าเริ่มต้น — เป็นต้นเหตุที่ทำให้
  // ผลค้นบวม แต่ยังต้องเก็บไว้เพราะบางครั้งค้นชื่อแบรนด์ที่ปรากฏแค่ในข้อความร้าน
  const [showInfoMatches, setShowInfoMatches] = useState(false);

  const total = prompts.length;

  // Take numbers are assigned over the full list so they stay stable no
  // matter what is filtered out of view.
  // เมื่อไม่มีคำค้น: จัดกลุ่มตามเดือนเหมือนเดิม
  // เมื่อมีคำค้น: จัดเป็นชั้นตามความน่าเชื่อถือของฟิลด์ที่แมตช์ เพื่อให้ของที่ตรงจริงอยู่บนสุด
  //   (ค้น "ผ้า" เคยได้ 28 จาก 71 รายการเพราะแมตช์ productInfo ที่เป็นข้อความร้าน)
  const view = useMemo(() => {
    const numbered = prompts.map((entry, index) => ({
      entry,
      takeNumber: prompts.length - index,
    }));

    const terms = splitTerms(query);
    const afterFilter = numbered.filter(
      ({ entry }) => !onlyIncomplete || isIncomplete(entry)
    );

    if (terms.length === 0) {
      // Entries arrive pre-sorted, so walking them in order yields month
      // buckets already in the right sequence.
      const buckets: { label: string; items: typeof numbered }[] = [];
      for (const item of afterFilter) {
        const label = monthLabel(item.entry.postedAt);
        const last = buckets[buckets.length - 1];
        if (last && last.label === label) last.items.push(item);
        else buckets.push({ label, items: [item] });
      }
      return { mode: "months" as const, buckets };
    }

    const tiers: Record<MatchTier, typeof numbered> = { name: [], notes: [], info: [] };
    for (const item of afterFilter) {
      const tier = matchTier(item.entry, terms);
      if (tier) tiers[tier].push(item);
    }
    return { mode: "search" as const, tiers };
  }, [prompts, query, onlyIncomplete]);

  const visibleCount =
    view.mode === "months"
      ? view.buckets.reduce((sum, g) => sum + g.items.length, 0)
      : view.tiers.name.length + view.tiers.notes.length + view.tiers.info.length;

  const isFiltering = query.trim() !== "" || onlyIncomplete;

  function renderItems(items: { entry: PromptEntry; takeNumber: number }[]) {
    return (
      <ul className="flex flex-col gap-1">
        {items.map(({ entry, takeNumber }) => {
          const isActive = selectedId === entry.id;
          const date = shortDate(entry.postedAt);
          return (
            <li
              key={entry.id}
              className={cn(
                "group flex items-center rounded-md border-l-2 border-transparent text-sm text-paper/80 transition-colors hover:bg-ink-2 hover:text-paper",
                isActive && "border-marigold bg-ink-2 text-paper"
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className="flex min-w-0 flex-1 items-start gap-2 py-2 pl-2.5 text-left"
              >
                {entry.productImages[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/uploads/${entry.productImages[0].entryId}/${entry.productImages[0].filename}`}
                    alt=""
                    loading="lazy"
                    className="size-9 shrink-0 rounded border border-paper/10 object-cover"
                  />
                ) : (
                  <span className="size-9 shrink-0 rounded border border-dashed border-paper/10" />
                )}

                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-2 leading-tight">{entry.productName}</span>
                  <span className="flex items-center gap-1.5 font-mono text-[0.6rem]">
                    <span className="text-marigold/80">
                      T{String(takeNumber).padStart(2, "0")}
                    </span>
                    {date ? (
                      <span className="text-paper/30">{date}</span>
                    ) : (
                      <span className="text-paper/20">
                        สร้าง {shortCreatedDate(entry.createdAt)}
                      </span>
                    )}
                  </span>
                </span>
              </button>

              <Menu.Root>
                <Menu.Trigger
                  aria-label="เมนูรายการ"
                  className="shrink-0 rounded-md px-1.5 py-2 text-paper/30 opacity-0 transition-opacity hover:text-paper focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
                >
                  <EllipsisVertical className="size-3.5" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
                    <Menu.Popup className="min-w-32 rounded-md border border-paper/15 bg-ink-2 py-1 text-sm text-paper shadow-lg">
                      <Menu.Item
                        onClick={() => onDuplicate(entry.id)}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none data-[highlighted]:bg-ink"
                      >
                        <Copy className="size-3.5" />
                        ทำซ้ำ
                      </Menu.Item>
                      <Menu.Item
                        onClick={() => onDelete(entry.id)}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-record outline-none data-[highlighted]:bg-ink"
                      >
                        <Trash2 className="size-3.5" />
                        ลบ
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </li>
          );
        })}
      </ul>
    );
  }

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
        {view.mode === "months" &&
          view.buckets.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-1 font-mono text-[0.6rem] tracking-widest text-marigold/60 uppercase">
                {group.label}
              </p>
              {renderItems(group.items)}
            </div>
          ))}

        {view.mode === "search" && (
          <>
            {view.tiers.name.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="px-1 font-mono text-[0.6rem] tracking-widest text-marigold/60 uppercase">
                  ตรงชื่อสินค้า ({view.tiers.name.length})
                </p>
                {renderItems(view.tiers.name)}
              </div>
            )}

            {view.tiers.notes.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="px-1 font-mono text-[0.6rem] tracking-widest text-marigold/60 uppercase">
                  พบในโน้ตของฉัน ({view.tiers.notes.length})
                </p>
                {renderItems(view.tiers.notes)}
              </div>
            )}

            {view.tiers.info.length > 0 && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setShowInfoMatches((v) => !v)}
                  aria-expanded={showInfoMatches}
                  className="flex items-center gap-1 px-1 text-left font-mono text-[0.6rem] tracking-widest text-paper/40 uppercase hover:text-paper/70"
                >
                  <ChevronRight
                    className={cn("size-3 transition-transform", showInfoMatches && "rotate-90")}
                  />
                  พบในรายละเอียดสินค้า ({view.tiers.info.length})
                </button>
                {showInfoMatches && renderItems(view.tiers.info)}
              </div>
            )}
          </>
        )}

        {total === 0 && (
          <p className="px-2.5 py-2 text-sm text-paper/40">ยังไม่มีรายการ</p>
        )}
        {total > 0 && visibleCount === 0 && (
          <p className="px-2.5 py-2 text-sm text-paper/40">
            ไม่พบรายการ — ลองใช้คำที่สั้นลงหรือน้อยคำลง
          </p>
        )}
      </div>
    </aside>
  );
}
