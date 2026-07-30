"use client";

import { useState } from "react";

import { DatePickerField } from "@/components/date-picker-field";

/**
 * สองช่องเลือกวันที่ (จาก/ถึง) ของฟอร์มค้นหาในหน้ารายการ — แยกเป็น client component
 * เพราะ entry-list.tsx เป็น server component แต่ปฏิทินต้องมี state ของตัวเอง
 *
 * ค่าเริ่มต้นมาจาก URL (?from=&to=) ผ่าน prop ธรรมดา ส่วนค่าที่ submit จริงมาจาก
 * hidden input ใน DatePickerField (name="from"/"to") ตอนกดปุ่ม "ค้นหา" ของฟอร์มเดิม
 */
export function DateRangeFields({
  initialFrom,
  initialTo,
}: {
  initialFrom: string;
  initialTo: string;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  return (
    <>
      <DatePickerField
        name="from"
        value={from}
        onChange={setFrom}
        placeholder="จากวันที่"
        ariaLabel="ตั้งแต่วันที่"
      />
      <span className="text-xs text-muted-foreground">ถึง</span>
      <DatePickerField
        name="to"
        value={to}
        onChange={setTo}
        placeholder="ถึงวันที่"
        ariaLabel="ถึงวันที่"
      />
    </>
  );
}
