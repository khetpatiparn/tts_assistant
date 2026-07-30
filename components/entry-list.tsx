import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EntryRow, EntryStatus } from "@/lib/entry-rows";
import { Plus, Search } from "lucide-react";

const STATUS_LABEL: Record<EntryStatus, string> = {
  "no-prompt": "ยังไม่มี prompt",
  "awaiting-clip": "รอลงคลิป",
  posted: "ลงแล้ว",
};

const STATUS_STYLE: Record<EntryStatus, string> = {
  "no-prompt": "border-record/40 text-record",
  "awaiting-clip": "border-marigold/40 text-marigold",
  posted: "border-border text-muted-foreground",
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
  page: number;
}) {
  const sp = new URLSearchParams();
  if (params.query.trim() !== "") sp.set("q", params.query);
  if (params.status !== "all") sp.set("status", params.status);
  if (params.from !== null) sp.set("from", params.from);
  if (params.to !== null) sp.set("to", params.to);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs === "" ? "/" : `/?${qs}`;
}

export function EntryList({
  rows,
  query,
  status,
  from,
  to,
  page,
  totalPages,
  matchCount,
  total,
}: {
  rows: EntryRow[];
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  page: number;
  totalPages: number;
  matchCount: number;
  total: number;
}) {
  const isFiltering = query.trim() !== "" || status !== "all";

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
          <Input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            aria-label="ตั้งแต่วันที่"
            className="w-36"
          />
          <span className="text-xs text-muted-foreground">ถึง</span>
          <Input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            aria-label="ถึงวันที่"
            className="w-36"
          />
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
            href={buildHref({ query, status: f.value, from, to, page: 1 })}
            aria-current={status === f.value ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 font-mono text-[0.65rem] tracking-widest uppercase transition-colors",
              status === f.value
                ? "bg-marigold text-ink"
                : "text-muted-foreground hover:bg-card hover:text-foreground"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <p className="font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
        {isFiltering ? `พบ ${matchCount} จาก ${total}` : `ทั้งหมด ${total} รายการ`}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {total === 0
            ? "ยังไม่มีรายการ"
            : "ไม่พบรายการ — ลองใช้คำที่สั้นลงหรือน้อยคำลง"}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const posted = postedLabel(row.postedAt);
            return (
              <li key={row.id}>
                <Link
                  href={`/entry/${row.id}`}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-marigold/50"
                >
                  {row.thumbnailFilename ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                      alt=""
                      loading="lazy"
                      className="size-14 shrink-0 rounded border border-border object-cover"
                    />
                  ) : (
                    <span className="size-14 shrink-0 rounded border border-dashed border-border" />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-sm leading-snug font-medium">{row.productName}</p>
                    {row.angle !== "" && (
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        angle: {row.angle}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 font-mono text-[0.6rem] tracking-wide",
                        STATUS_STYLE[row.status]
                      )}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                    <span className="font-mono text-[0.6rem] text-muted-foreground">
                      {posted ?? `สร้าง ${createdLabel(row.createdAt)}`}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="แบ่งหน้า">
          {page > 1 && (
            <Link
              href={buildHref({ query, status, from, to, page: page - 1 })}
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
              href={buildHref({ query, status, from, to, page: page + 1 })}
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
