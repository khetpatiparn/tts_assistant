import Link from "next/link";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntryFilters } from "@/components/entry-filters";
import type { EntryRow, EntryStatus } from "@/lib/entry-rows";
import type { DateFilterBasis } from "@/lib/entry-date-filter";

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

/** "12 ก.ค. 2026" — postedAt เก็บเป็น UTC midnight จึงต้องอ่านด้วย timeZone UTC */
function postedLabel(postedAt: Date | null): string | null {
  if (!postedAt) return null;
  return new Date(postedAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** createdAt เป็น timestamp จริง อ่านด้วย local getter — ห้ามใช้ตัวเดียวกับ postedLabel */
function createdLabel(createdAt: Date): string {
  return new Date(createdAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function buildPageHref(params: {
  query: string;
  status: EntryStatus | "all";
  from: string | null;
  to: string | null;
  by: DateFilterBasis;
  page: number;
}): string {
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
  rows: EntryRow[];
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
  // หัวคอลัมน์ที่ 4 และค่าในแถวต้องมาจากฐานเดียวกันเสมอ ไม่งั้นอ่านแล้วไม่รู้ว่าคอลัมน์นี้คืออะไร
  const dateColumnLabel = by === "created" ? "วันที่สร้าง" : "วันที่ลงคลิป";

  return (
    <div className="flex flex-col gap-4">
      <EntryFilters
        query={query}
        status={status}
        from={from}
        to={to}
        by={by}
        matchCount={matchCount}
        total={total}
      />

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
            <Button render={<Link href="/entry/new" />} nativeButton={false}>
              <Plus className="size-4" />
              เพิ่มสินค้าแรก
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col">
          {/* หัวคอลัมน์ไม่ใช่แถวที่กดได้ — ไม่มีการเรียงลำดับตามคอลัมน์
              การเรียงยังเป็นแบบเดิมจาก lib/entry-sort.ts (ยังไม่ลงคลิปอยู่บนสุด แล้วใหม่ไปเก่า)
              ซ่อนที่ base เพราะต่ำกว่า md: ไม่มีคอลัมน์ให้หัวแล้ว */}
          <div
            className="hidden items-center gap-4 border-b border-border px-4 pb-2 text-xs text-muted-foreground md:flex"
            aria-hidden="true"
          >
            <span className="w-20 shrink-0">รูป</span>
            <span className="flex-1">สินค้า</span>
            <span className="w-32 shrink-0">สถานะ</span>
            <span className="w-28 shrink-0 text-right">{dateColumnLabel}</span>
          </div>

          <ul className="flex flex-col gap-2 pt-2">
            {rows.map((row) => {
              const dateText =
                by === "created"
                  ? createdLabel(row.createdAt)
                  : (postedLabel(row.postedAt) ?? "-");

              return (
                <li key={row.id}>
                  <Link
                    href={`/entry/${row.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-interactive md:gap-4"
                  >
                    {row.thumbnailFilename ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                        alt=""
                        loading="lazy"
                        className="size-16 shrink-0 rounded-lg border border-border object-cover md:size-20"
                      />
                    ) : (
                      <span className="size-16 shrink-0 rounded-lg border border-dashed border-border md:size-20" />
                    )}

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="truncate text-base font-bold md:text-lg">{row.productName}</p>
                      {row.angle !== "" && (
                        <p className="line-clamp-1 text-sm text-muted-foreground">
                          angle: {row.angle}
                        </p>
                      )}

                      {/* ต่ำกว่า md: สถานะกับวันที่ย้ายลงมาอยู่ใต้ชื่อแทนที่จะเป็นคอลัมน์ตายตัว
                          ที่กินความกว้าง 240px จนชื่อสินค้าไม่เหลือที่บนจอ 390px */}
                      <div className="flex flex-wrap items-center gap-2 md:hidden">
                        <Badge variant={STATUS_BADGE_VARIANT[row.status]}>
                          {STATUS_LABEL[row.status]}
                        </Badge>
                        <span className="text-xs whitespace-nowrap text-muted-foreground">
                          {dateText}
                        </span>
                      </div>
                    </div>

                    <div className="hidden w-32 shrink-0 md:block">
                      <Badge variant={STATUS_BADGE_VARIANT[row.status]}>
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </div>

                    <div className="hidden w-28 shrink-0 text-right md:block">
                      <span className="text-sm whitespace-nowrap">{dateText}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="แบ่งหน้า">
          {page > 1 && (
            <Button
              render={
                <Link
                  href={buildPageHref({ query, status, from, to, by, page: page - 1 })}
                />
              }
              nativeButton={false}
              variant="outline"
            >
              ก่อนหน้า
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            หน้า <span className="font-mono">{page}</span> จาก{" "}
            <span className="font-mono">{totalPages}</span>
          </span>
          {page < totalPages && (
            <Button
              render={
                <Link
                  href={buildPageHref({ query, status, from, to, by, page: page + 1 })}
                />
              }
              nativeButton={false}
              variant="outline"
            >
              ถัดไป
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
