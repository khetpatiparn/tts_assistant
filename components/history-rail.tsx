"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Copy, EllipsisVertical, PanelLeft, Plus, Trash2 } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { Drawer } from "@base-ui/react/drawer";

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

type RailProps = {
  rows: EntryRow[];
  selectedId: string | null;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
};

/**
 * เนื้อในของแถบประวัติ ใช้ร่วมกันทั้งฝั่ง sidebar (เดสก์ท็อป) และฝั่งลิ้นชัก (สัมผัส)
 *
 * onNavigate ให้ฝั่งลิ้นชักปิดตัวเองหลังผู้ใช้เลือกรายการ — ฝั่ง sidebar ส่ง undefined
 */
function RailBody({
  rows,
  selectedId,
  onDuplicate,
  onDelete,
  onNavigate,
}: RailProps & { onNavigate?: () => void }) {
  return (
    <>
      <Link
        href="/entry/new"
        onClick={onNavigate}
        className={cn(buttonVariants(), "w-full shadow-none")}
      >
        <Plus className="size-4" />
        สินค้าใหม่
      </Link>

      <p className="px-1 text-xs text-header-muted">ล่าสุด</p>

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
                  onClick={onNavigate}
                  className="flex min-w-0 flex-1 items-start gap-2 py-2 pl-2.5 text-left"
                >
                  {row.thumbnailFilename ? (
                    // 72 = 36px (size-9) × DPR 2
                    <Image
                      src={`/api/uploads/${row.id}/${row.thumbnailFilename}`}
                      alt=""
                      width={72}
                      height={72}
                      className="size-9 shrink-0 rounded border border-header-foreground/10 object-cover"
                    />
                  ) : (
                    <span className="size-9 shrink-0 rounded border border-dashed border-header-foreground/10" />
                  )}

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-2 text-sm leading-tight font-semibold">
                      {row.productName}
                    </span>
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
                  {/* จอสัมผัสไม่มี hover — ต่ำกว่า lg: จึงต้องเห็นตลอด ไม่งั้นทำซ้ำ/ลบหายไปทั้งหมด */}
                  <Menu.Trigger
                    aria-label="เมนูรายการ"
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-header-muted opacity-100 transition-opacity hover:text-header-foreground focus-visible:opacity-100 data-[popup-open]:opacity-100 lg:size-auto lg:px-1.5 lg:py-2 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <EllipsisVertical className="size-3.5" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
                      <Menu.Popup className="min-w-32 rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg">
                        <Menu.Item
                          onClick={() => onDuplicate(row.id)}
                          className="flex cursor-pointer items-center gap-2 px-3 py-2.5 outline-none data-[highlighted]:bg-muted lg:py-1.5"
                        >
                          <Copy className="size-3.5" />
                          ทำซ้ำ
                        </Menu.Item>
                        <Menu.Item
                          onClick={() => onDelete(row.id)}
                          className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-destructive outline-none data-[highlighted]:bg-muted lg:py-1.5"
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
          onClick={onNavigate}
          className="mt-1 rounded-md px-2.5 py-2 text-center text-xs text-header-muted transition-colors hover:bg-header-foreground/10 hover:text-header-foreground"
        >
          ดูทั้งหมด
        </Link>
      </div>
    </>
  );
}

/**
 * แถบข้างของหน้าทำงาน — โชว์เฉพาะรายการล่าสุดเพื่อสลับงานเร็วๆ
 *
 * การค้นหา ตัวกรอง และการจัดกลุ่มย้ายไปหน้ารายการ (/) ทั้งหมดแล้ว เพราะกว้าง 240px
 * ใส่ได้แค่ชื่อกับวันที่ ไม่มีที่ให้ตัวกรองหรือคอลัมน์สถานะ
 *
 * ต่ำกว่า lg: ตัวนี้ถูกซ่อนและใช้ HistoryRailDrawer แทน — ของเดิมเป็น w-full ซึ่งกลายเป็น
 * บล็อกเต็มความกว้างวางเหนือฟอร์ม ทำให้บนมือถือต้องเลื่อนผ่าน 15 รายการก่อนถึงช่องกรอก
 */
export function HistoryRail({ rows, selectedId, onDuplicate, onDelete }: RailProps) {
  return (
    <aside className="hidden shrink-0 flex-col gap-3 overflow-hidden bg-header px-3 py-4 text-header-foreground lg:flex lg:h-full lg:w-60">
      <RailBody
        rows={rows}
        selectedId={selectedId}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </aside>
  );
}

/**
 * แถบเดียวกันในรูปลิ้นชักสำหรับจอสัมผัส
 *
 * ใช้ Drawer ของ Base UI ซึ่งมี swipe-to-dismiss และ virtual keyboard handling มาให้
 * โครงสร้าง part อ้างอิงจาก node_modules/@base-ui/react/docs/react/components/drawer.md
 * (ตัวอย่างในเอกสารเป็นลิ้นชักฝั่งขวา — ตัวนี้กลับด้านเป็นซ้ายให้ตรงกับตำแหน่ง sidebar เดิม)
 */
export function HistoryRailDrawer({ rows, selectedId, onDuplicate, onDelete }: RailProps) {
  const [open, setOpen] = useState(false);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} swipeDirection="left">
      <Drawer.Trigger
        aria-label="เปิดรายการล่าสุด"
        className="inline-flex h-11 items-center gap-1.5 rounded-md border border-header-muted/40 px-3 text-sm font-medium text-header-muted transition-colors hover:bg-header-foreground/10 hover:text-header-foreground focus-visible:ring-2 focus-visible:ring-header-active focus-visible:outline-none lg:hidden"
      >
        <PanelLeft className="size-4" />
        ล่าสุด
      </Drawer.Trigger>

      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-40 min-h-dvh bg-black/50 opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0" />
        {/* pb-safe อยู่ที่นี่ (ไม่ใช่ Popup) เพราะ Popup มี py-4 ของตัวเองอยู่แล้ว — ใส่ตรงนี้
            กันไม่ให้ทับกับ padding-bottom เดิม แค่หด flex box ให้ Popup (h-full) ลอยพ้น
            home indicator ของ iOS ตาม viewportFit: "cover" ใน app/layout.tsx */}
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-stretch justify-start pb-safe">
          <Drawer.Popup className="flex h-full w-72 max-w-[85vw] flex-col gap-3 overflow-y-auto overscroll-contain border-r border-header-muted/40 bg-header px-3 py-4 text-header-foreground outline-none [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-300 ease-out data-ending-style:[transform:translateX(-100%)] data-starting-style:[transform:translateX(-100%)]">
            <Drawer.Title className="px-1 text-sm font-semibold text-header-foreground">
              รายการล่าสุด
            </Drawer.Title>
            <Drawer.Description className="sr-only">
              เลือกสินค้าเพื่อสลับไปทำงานชิ้นนั้น
            </Drawer.Description>
            <Drawer.Content className="flex min-h-0 flex-1 flex-col gap-3">
              <RailBody
                rows={rows}
                selectedId={selectedId}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onNavigate={() => setOpen(false)}
              />
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
