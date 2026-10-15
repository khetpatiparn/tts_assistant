"use client";

import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** "12 ก.ค. 2026" — เทียบเท่ากับ postedLabel ใน entry-list.tsx ให้หน้าตาวันที่ตรงกันทั้งแอป */
function formatThaiDate(date: Date): string {
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * "YYYY-MM-DD" -> Date ที่เที่ยงคืนตามเวลาท้องถิ่น ใช้แสดงผลในปฏิทิน/ป้ายกำกับเท่านั้น
 * ค่าจริงที่ไหลผ่าน onChange/hidden input ยังเป็น string เดิม ไม่แตะตรรกะ timezone ที่มีอยู่
 */
function parseISODate(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * ช่องเลือกวันที่แบบปฏิทิน (แทน <input type="date"> ของเบราว์เซอร์ที่คุมหน้าตาไม่ได้เลย)
 *
 * ค่าที่ใช้จริงตอน submit form คือ hidden input ตาม `name` — ปุ่มที่เห็นเป็นแค่ trigger
 * เปิดปฏิทิน ไม่ใช่ input จริง
 */
export function DatePickerField({
  name,
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
}) {
  const selected = parseISODate(value);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <input type="hidden" name={name} value={value} />
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            className={cn(
              "justify-start font-normal",
              !selected && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon className="size-4" />
        {selected ? formatThaiDate(selected) : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            onChange(date ? toISODate(date) : "");
            setOpen(false);
          }}
          // ปุ่มวันที่/เดือนใช้ --cell-size กำหนดทั้งขนาด — ค่าเดิม (spacing(7) = 28px) เล็กกว่า
          // เป้าสัมผัส 44px ที่ควรได้บนมือถือ ตามกฎเป้าสัมผัสของแผนนี้ (44px ต่ำกว่า lg:,
          // 36px-เทียบเท่าที่ lg: ขึ้นไปสำหรับเมาส์) — 640-1023px (sm:) ยังเป็นช่วงจอสัมผัส
          // (มือถือแนวนอน/แท็บเล็ต) จึงต้องคืนค่าเล็กที่ lg: ไม่ใช่ sm:
          className="[--cell-size:--spacing(11)] lg:[--cell-size:--spacing(7)]"
        />
      </PopoverContent>
    </Popover>
  );
}
