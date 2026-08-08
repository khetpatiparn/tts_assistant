"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  QUICK_RANGES,
  formatDateFilterLabel,
  fromDateKey,
  matchQuickRange,
  toDateKey,
  todayKey,
  daysAgoKey,
  type QuickRangeId,
} from "@/lib/date-filter-label";
import type { EntryStatus } from "@/lib/entry-rows";
import type { DateFilterBasis } from "@/lib/entry-date-filter";

const STATUS_FILTERS: { value: EntryStatus | "all"; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "no-prompt", label: "ยังไม่มี prompt" },
  { value: "awaiting-clip", label: "รอลงคลิป" },
  { value: "posted", label: "ลงแล้ว" },
];

/**
 * แถบตัวกรองทั้งหมดของหน้ารายการ (ค้นหา + สถานะ + วันที่) รวมอยู่ที่เดียว
 *
 * นำทางด้วย router.push ไม่ใช่ form GET โดยตั้งใจ เพราะ PopoverContent ของ base-ui
 * render ผ่าน Portal (components/ui/popover.tsx) ปุ่มในเมนูจึงไม่ได้อยู่ใน <form> ตาม DOM
 * และการใช้ hidden input + setState แล้ว submit จะเกิด race เพราะ state อัปเดตแบบ async
 *
 * ผลที่ผู้ใช้เห็นเหมือนกัน: กดแล้วมีผลทันที · คำค้นหาที่พิมพ์ค้างถูกพาไปด้วย (อ่านจาก ref)
 * · URL parameter ชุดเดิม · ปุ่มย้อนกลับของเบราว์เซอร์ทำงาน
 */
export function EntryFilters({
  query,
  status,
  from,
  to,
  by,
  matchCount,
  total,
}: {
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  by: DateFilterBasis;
  matchCount: number;
  total: number;
}) {
  const router = useRouter();
  const queryRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const selected = matchQuickRange(from, to);
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");
  const [showCustom, setShowCustom] = useState(selected === "custom");

  const isFiltering =
    query.trim() !== "" || status !== "all" || from !== null || to !== null;

  /**
   * ประกอบ URL ใหม่จากค่าปัจจุบัน แล้วทับด้วย overrides
   * ไม่ใส่ page ลงไปเลย จึงกลับหน้า 1 ทุกครั้งที่เปลี่ยนตัวกรอง ซึ่งเป็นพฤติกรรมที่ถูก
   * คำค้นหาอ่านจาก ref ไม่ใช่ prop เพื่อให้คำที่พิมพ์ค้างแต่ยังไม่กดค้นหาไม่หายไป
   */
  function pushWith(overrides: {
    status?: EntryStatus | "all";
    from?: string | null;
    to?: string | null;
    by?: DateFilterBasis;
  }) {
    const nextQuery = queryRef.current?.value ?? query;
    const nextStatus = overrides.status ?? status;
    const nextFrom = overrides.from !== undefined ? overrides.from : from;
    const nextTo = overrides.to !== undefined ? overrides.to : to;
    const nextBy = overrides.by ?? by;

    const sp = new URLSearchParams();
    if (nextQuery.trim() !== "") sp.set("q", nextQuery.trim());
    if (nextStatus !== "all") sp.set("status", nextStatus);
    if (nextFrom !== null && nextFrom !== "") sp.set("from", nextFrom);
    if (nextTo !== null && nextTo !== "") sp.set("to", nextTo);
    if (nextBy === "created") sp.set("by", nextBy);

    const qs = sp.toString();
    router.push(qs === "" ? "/" : `/?${qs}`);
  }

  function applyQuickRange(id: QuickRangeId) {
    if (id === "all") {
      setShowCustom(false);
      setMenuOpen(false);
      pushWith({ from: null, to: null });
      return;
    }
    if (id === "custom") {
      // เลือก "กำหนดเอง" แค่เปิดปฏิทินให้กรอก ยังไม่กรองจนกว่าจะกด "ใช้ช่วงนี้"
      setShowCustom(true);
      return;
    }
    const range = QUICK_RANGES.find((r) => r.id === id);
    if (!range) return;
    setShowCustom(false);
    setMenuOpen(false);
    pushWith({ from: daysAgoKey(range.days), to: todayKey() });
  }

  function applyCustomRange() {
    if (customFrom === "" && customTo === "") return;
    setMenuOpen(false);
    pushWith({ from: customFrom || null, to: customTo || null });
  }

  const dateLabel = formatDateFilterLabel(from, to);
  const dateActive = from !== null || to !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            pushWith({});
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              key={query}
              ref={queryRef}
              name="q"
              defaultValue={query}
              placeholder="ค้นหาสินค้า"
              aria-label="ค้นหาสินค้า"
              className="w-64 pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            ค้นหา
          </Button>
        </form>

        <Button render={<Link href="/entry/new" />} nativeButton={false}>
          <Plus className="size-4" />
          สินค้าใหม่
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* กลุ่มตัวเลือก: กรอบรวมรอบทั้งกลุ่มเป็นตัวบอกว่าทั้งแถวกดได้
            ตัวที่ไม่ได้เลือกจึงไม่ต้องมีขอบของตัวเอง (กฎ affordance จากโปรเจกต์ A) */}
        <div
          className="inline-flex flex-wrap gap-1 rounded-lg border border-border-interactive p-1"
          role="group"
          aria-label="กรองตามสถานะ"
        >
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-current={status === filter.value ? "true" : undefined}
              onClick={() => pushWith({ status: filter.value })}
              className={cn(
                "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                status === filter.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                aria-label="ตัวกรองวันที่"
                className={cn(dateActive && "border-primary bg-muted")}
              />
            }
          >
            <CalendarDays className="size-4" />
            {dateLabel}
          </PopoverTrigger>

          <PopoverContent align="start" className="w-auto min-w-64 gap-3 p-3">
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => applyQuickRange("all")}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected === "all"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                ทั้งหมด
              </button>
              {QUICK_RANGES.map((range) => (
                <button
                  key={range.id}
                  type="button"
                  onClick={() => applyQuickRange(range.id)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    selected === range.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  {range.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyQuickRange("custom")}
                aria-expanded={showCustom}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected === "custom" && !showCustom
                    ? "bg-primary text-primary-foreground"
                    : showCustom
                      ? "bg-muted"
                      : "hover:bg-muted"
                )}
              >
                กำหนดเอง
              </button>
            </div>

            {showCustom && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <Calendar
                  mode="range"
                  numberOfMonths={1}
                  selected={{
                    from: fromDateKey(customFrom),
                    to: fromDateKey(customTo),
                  }}
                  onSelect={(range) => {
                    setCustomFrom(range?.from ? toDateKey(range.from) : "");
                    setCustomTo(range?.to ? toDateKey(range.to) : "");
                  }}
                />
                <Button
                  type="button"
                  onClick={applyCustomRange}
                  disabled={customFrom === "" && customTo === ""}
                  className="self-end"
                >
                  ใช้ช่วงนี้
                </Button>
              </div>
            )}

            {/* ฐานวันที่เป็นส่วนหนึ่งของการตั้งค่าวันที่ ไม่ใช่ตัวกรองแยก จึงอยู่ในเมนูนี้ */}
            <div className="flex items-center gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">นับจาก</span>
              <div
                className="inline-flex gap-1 rounded-lg border border-border-interactive p-1"
                role="group"
                aria-label="นับจากวันที่"
              >
                <button
                  type="button"
                  aria-current={by === "posted" ? "true" : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    pushWith({ by: "posted" });
                  }}
                  className={cn(
                    "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    by === "posted"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  ลงคลิป
                </button>
                <button
                  type="button"
                  aria-current={by === "created" ? "true" : undefined}
                  onClick={() => {
                    setMenuOpen(false);
                    pushWith({ by: "created" });
                  }}
                  className={cn(
                    "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    by === "created"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  สร้าง
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {isFiltering
          ? `พบ ${matchCount} จาก ${total} รายการ`
          : `ทั้งหมด ${total} รายการ`}
        {isFiltering && (
          <Link href="/" className="text-primary hover:underline">
            ล้างตัวกรองทั้งหมด
          </Link>
        )}
      </p>
    </div>
  );
}
