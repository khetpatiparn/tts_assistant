import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateRangeFields } from "@/components/date-range-fields";
import { cn } from "@/lib/utils";
import type { EntryRow, EntryStatus } from "@/lib/entry-rows";
import type { DateFilterBasis } from "@/lib/entry-date-filter";
import type { EntrySalesSummary } from "@/lib/entry-sales";
import { Plus, Search } from "lucide-react";

function baht(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

const STATUS_LABEL: Record<EntryStatus, string> = {
  "no-prompt": "ยังไม่มี prompt",
  "awaiting-clip": "รอลงคลิป",
  posted: "ลงแล้ว",
};

const STATUS_BADGE_VARIANT: Record<EntryStatus, "success" | "warning" | "neutral"> = {
  "no-prompt": "neutral",
  "awaiting-clip": "warning",
  posted: "success",
};

const FILTERS: { value: EntryStatus | "all"; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "no-prompt", label: "ยังไม่มี prompt" },
  { value: "awaiting-clip", label: "รอลงคลิป" },
  { value: "posted", label: "ลงแล้ว" },
];

/** "12 ก.ค. 2026" — postedAt เก็บเป็น UTC midnight จึงอ่านด้วย UTC */
function postedLabel(postedAt: Date | null) {
  if (!postedAt) return null;
  return new Date(postedAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** createdAt เป็น timestamp จริง อ่านด้วย local getter — ห้ามใช้ตัวเดียวกับ postedLabel */
function createdLabel(createdAt: Date) {
  return new Date(createdAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function buildHref(params: {
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  by: DateFilterBasis;
  page: number;
}) {
  const sp = new URLSearchParams();
  if (params.query.trim() !== "") sp.set("q", params.query);
  if (params.status !== "all") sp.set("status", params.status);
  if (params.from !== null) sp.set("from", params.from);
  if (params.to !== null) sp.set("to", params.to);
  if (params.by === "created") sp.set("by", params.by);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs === "" ? "/" : `/?${qs}`;
}

/** "YYYY-MM-DD" ของวันนี้ตามปฏิทินท้องถิ่น (เวลาไทย) — ใช้ local getter เสมอไม่ว่า by จะเป็นค่าไหน
 *  เพราะ new Date() เป็น timestamp จริง ไม่ใช่ค่าที่เข้ารหัสเป็น UTC midnight แบบ postedAt ที่เก็บไว้ —
 *  filterByPostedDateRange/filterByCreatedDateRange ใน lib/entry-date-filter.ts เป็นตัวตีความสตริงนี้
 *  ต่างกันไปตามฐานเอง ไม่ใช่หน้าที่ของฟังก์ชันนี้ */
function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysAgoKey(days: number): string {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  base.setTime(base.getTime() - days * 86400000);
  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const QUICK_RANGES: { label: string; days: number }[] = [
  { label: "วันนี้", days: 0 },
  { label: "7 วัน", days: 6 },
  { label: "30 วัน", days: 29 },
];

export function EntryList({
  rows,
  query,
  status,
  from,
  to,
  by,
  page,
  totalPages,
  matchCount,
  total,
}: {
  rows: (EntryRow & { sales: EntrySalesSummary | null })[];
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  by: DateFilterBasis;
  page: number;
  totalPages: number;
  matchCount: number;
  total: number;
}) {
  const isFiltering =
    query.trim() !== "" || status !== "all" || from !== null || to !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form method="get" action="/" className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={query}
              placeholder="ค้นหาสินค้า"
              aria-label="ค้นหาสินค้า"
              className="w-64 pl-8"
            />
          </div>
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <DateRangeFields initialFrom={from ?? ""} initialTo={to ?? ""} />
          <Button type="submit" variant="secondary">
            ค้นหา
          </Button>
        </form>

        <Button render={<Link href="/entry/new" />} nativeButton={false}>
          <Plus className="size-4" />
          สินค้าใหม่
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={buildHref({ query, status: f.value, from, to, by, page: 1 })}
            aria-current={status === f.value ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 font-mono text-[0.65rem] tracking-widest uppercase transition-colors",
              status === f.value
                ? "bg-teal text-primary-foreground"
                : "text-muted-foreground hover:bg-card hover:text-foreground"
            )}
          >
            {f.label}
          </Link>
        ))}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        {QUICK_RANGES.map((r) => {
          const rangeTo = todayKey();
          const rangeFrom = daysAgoKey(r.days);
          const isActive = from === rangeFrom && to === rangeTo;
          return (
            <Link
              key={r.label}
              href={buildHref({ query, status, from: rangeFrom, to: rangeTo, by, page: 1 })}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 font-mono text-[0.65rem] tracking-widest uppercase transition-colors",
                isActive
                  ? "bg-teal text-primary-foreground"
                  : "text-muted-foreground hover:bg-card hover:text-foreground"
              )}
            >
              {r.label}
            </Link>
          );
        })}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        <span className="font-mono text-[0.65rem] text-muted-foreground">ตามวัน:</span>
        <Link
          href={buildHref({ query, status, from, to, by: "posted", page: 1 })}
          aria-current={by === "posted" ? "page" : undefined}
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[0.65rem] uppercase transition-colors",
            by === "posted"
              ? "bg-teal/20 text-teal"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          ลงคลิป
        </Link>
        <Link
          href={buildHref({ query, status, from, to, by: "created", page: 1 })}
          aria-current={by === "created" ? "page" : undefined}
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[0.65rem] uppercase transition-colors",
            by === "created"
              ? "bg-teal/20 text-teal"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          สร้าง
        </Link>
      </div>

      <p className="flex items-center gap-2 font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
        {isFiltering ? `พบ ${matchCount} จาก ${total}` : `ทั้งหมด ${total} รายการ`}
        {isFiltering && (
          <Link href="/" className="text-teal normal-case hover:underline">
            ล้างตัวกรองทั้งหมด
          </Link>
        )}
      </p>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "ยังไม่มีรายการ"
              : query.trim() !== ""
                ? "ไม่พบรายการ — ลองใช้คำที่สั้นลงหรือน้อยคำลง"
                : "ไม่พบรายการ — ลองปรับช่วงวันที่หรือตัวกรองสถานะ"}
          </p>
          {total === 0 && (
            <Button render={<Link href="/entry/new" />} nativeButton={false} size="sm">
              <Plus className="size-4" />
              เพิ่มสินค้าแรก
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/entry/${row.id}`}
                className="flex items-center gap-3.5 rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-teal/50"
              >
                {row.thumbnailFilename ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                    alt=""
                    loading="lazy"
                    className="size-11 shrink-0 rounded-lg border border-border object-cover"
                  />
                ) : (
                  <span className="size-11 shrink-0 rounded-lg border border-dashed border-border" />
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-sm leading-snug font-bold">{row.productName}</p>
                  {row.angle !== "" && (
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      angle: {row.angle}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-4 border-l border-border pl-4">
                  <div className="flex min-w-14 flex-col items-end gap-1">
                    <span className="font-mono text-[0.55rem] tracking-wide text-muted-foreground uppercase">
                      สถานะ
                    </span>
                    <Badge variant={STATUS_BADGE_VARIANT[row.status]}>
                      {STATUS_LABEL[row.status]}
                    </Badge>
                  </div>

                  <div className="flex min-w-14 flex-col items-end gap-0.5">
                    <span className="font-mono text-[0.55rem] tracking-wide text-muted-foreground uppercase">
                      {postedLabel(row.postedAt) ? "วันที่" : "สร้างเมื่อ"}
                    </span>
                    <span className="font-mono text-xs font-semibold">
                      {postedLabel(row.postedAt) ?? createdLabel(row.createdAt)}
                    </span>
                  </div>

                  {row.sales !== null && row.sales.orderCount > 0 && (
                    <div className="flex min-w-16 flex-col items-end gap-0.5">
                      <span className="font-mono text-[0.55rem] tracking-wide text-muted-foreground uppercase">
                        ยอดขาย
                      </span>
                      <span className="font-mono text-xs font-semibold text-teal">
                        {baht(row.sales.settledRevenue)}
                      </span>
                      {row.sales.pendingGmv > 0 && (
                        <Badge variant="warning" className="mt-0.5">
                          รอรอบจ่าย
                        </Badge>
                      )}
                    </div>
                  )}

                  {row.sales !== null && row.sales.views !== null && (
                    <div className="flex min-w-12 flex-col items-end gap-0.5">
                      <span className="font-mono text-[0.55rem] tracking-wide text-muted-foreground uppercase">
                        วิว
                      </span>
                      <span className="font-mono text-xs font-semibold">
                        {row.sales.views.toLocaleString("th-TH")}
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="แบ่งหน้า">
          {page > 1 && (
            <Link
              href={buildHref({ query, status, from, to, by, page: page - 1 })}
              className="rounded-md border border-border px-3 py-1.5 font-mono text-xs transition-colors hover:bg-card"
            >
              ก่อนหน้า
            </Link>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            หน้า {page} จาก {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={buildHref({ query, status, from, to, by, page: page + 1 })}
              className="rounded-md border border-border px-3 py-1.5 font-mono text-xs transition-colors hover:bg-card"
            >
              ถัดไป
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
