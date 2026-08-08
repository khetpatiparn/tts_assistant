"use client";

import Link from "next/link";
import { Copy, EllipsisVertical, Plus, Trash2 } from "lucide-react";
import { Menu } from "@base-ui/react/menu";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EntryRow } from "@/lib/entry-rows";

/** "12 ก.ค." ของวันที่ลงคลิป — postedAt เก็บเป็น UTC midnight จึงอ่านด้วย UTC */
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
 * entry ที่สร้างก่อน 7 โมงเช้าเวลาไทย
 */
function shortCreatedDate(createdAt: Date) {
  return new Date(createdAt).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}

/**
 * แถบข้างของหน้าทำงาน — โชว์เฉพาะรายการล่าสุดเพื่อสลับงานเร็วๆ
 *
 * การค้นหา ตัวกรอง และการจัดกลุ่มย้ายไปหน้ารายการ (/) ทั้งหมดแล้ว เพราะกว้าง 240px
 * ใส่ได้แค่ชื่อกับวันที่ ไม่มีที่ให้ตัวกรองหรือคอลัมน์สถานะ
 */
export function HistoryRail({
  rows,
  selectedId,
  onDuplicate,
  onDelete,
}: {
  rows: EntryRow[];
  selectedId: string | null;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-hidden bg-header px-3 py-4 text-header-foreground lg:h-full lg:w-60">
      <Link
        href="/entry/new"
        className={cn(buttonVariants(), "w-full shadow-none")}
      >
        <Plus className="size-4" />
        สินค้าใหม่
      </Link>

      <p className="px-1 text-xs text-header-muted">
        ล่าสุด
      </p>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        <ul className="flex flex-col gap-1">
          {rows.map((row) => {
            const isActive = selectedId === row.id;
            const date = shortDate(row.postedAt);
            return (
              <li
                key={row.id}
                className={cn(
                  "group flex items-center rounded-md border-l-2 border-transparent text-sm text-header-muted transition-colors hover:bg-header-foreground/10 hover:text-header-foreground",
                  isActive && "border-header-active bg-header-foreground/10 text-header-foreground"
                )}
              >
                <Link
                  href={`/entry/${row.id}`}
                  className="flex min-w-0 flex-1 items-start gap-2 py-2 pl-2.5 text-left"
                >
                  {row.thumbnailFilename ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                      alt=""
                      loading="lazy"
                      className="size-9 shrink-0 rounded border border-header-foreground/10 object-cover"
                    />
                  ) : (
                    <span className="size-9 shrink-0 rounded border border-dashed border-header-foreground/10" />
                  )}

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-2 text-sm leading-tight font-semibold">{row.productName}</span>
                    <span className="flex items-center gap-1.5 text-xs">
                      {date ? (
                        <span className="font-mono text-header-muted">{date}</span>
                      ) : (
                        <span className="text-header-muted">
                          สร้าง <span className="font-mono">{shortCreatedDate(row.createdAt)}</span>
                        </span>
                      )}
                    </span>
                  </span>
                </Link>

                <Menu.Root>
                  <Menu.Trigger
                    aria-label="เมนูรายการ"
                    className="shrink-0 rounded-md px-1.5 py-2 text-header-muted opacity-0 transition-opacity hover:text-header-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100"
                  >
                    <EllipsisVertical className="size-3.5" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
                      <Menu.Popup className="min-w-32 rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg">
                        <Menu.Item
                          onClick={() => onDuplicate(row.id)}
                          className="flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none data-[highlighted]:bg-muted"
                        >
                          <Copy className="size-3.5" />
                          ทำซ้ำ
                        </Menu.Item>
                        <Menu.Item
                          onClick={() => onDelete(row.id)}
                          className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-destructive outline-none data-[highlighted]:bg-muted"
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

        <Link
          href="/"
          className="mt-1 rounded-md px-2.5 py-2 text-center text-xs text-header-muted transition-colors hover:bg-header-foreground/10 hover:text-header-foreground"
        >
          ดูทั้งหมด
        </Link>
      </div>
    </aside>
  );
}
