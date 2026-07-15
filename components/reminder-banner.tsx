"use client";

import { useCallback, useSyncExternalStore } from "react";
import { BellRing, X } from "lucide-react";

import type { ReminderState } from "@/lib/dashboard";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "reminder-dismissed";
// localStorage.setItem ใน tab เดียวกันไม่ยิง "storage" event (ยิงแค่ tab อื่น) —
// เลย broadcast custom event เองเพื่อให้ useSyncExternalStore รู้ตัวทันทีหลังกดปิด
const DISMISS_EVENT = "reminder-banner:dismissed";

function messages(r: ReminderState): string[] {
  const out: string[] = [];
  if (r.daysSinceImport !== null && r.daysSinceImport > 7) {
    out.push(`ไม่ได้นำเข้าข้อมูลรายได้มา ${r.daysSinceImport} วันแล้ว`);
  }
  if (r.clipsAwaitingRevenue >= 3) {
    out.push(`มี ${r.clipsAwaitingRevenue} คลิปที่ยังไม่มีข้อมูลรายได้`);
  }
  if (r.unmatchedSoldProducts > 0) {
    out.push(`มี ${r.unmatchedSoldProducts} สินค้าที่ขายได้แต่ยังไม่มีในแอป`);
  }
  return out;
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(DISMISS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(DISMISS_EVENT, callback);
  };
}

function dismiss(signature: string) {
  localStorage.setItem(STORAGE_KEY, signature);
  window.dispatchEvent(new Event(DISMISS_EVENT));
}

export function ReminderBanner({
  reminder,
  onGoImport,
}: {
  reminder: ReminderState;
  onGoImport: () => void;
}) {
  const msgs = messages(reminder);
  // ลายเซ็นของสถานะ — ถ้าเปลี่ยน (มีข้อมูลใหม่) banner จะกลับมาแสดง
  const signature = `${reminder.daysSinceImport}|${reminder.clipsAwaitingRevenue}|${reminder.unmatchedSoldProducts}`;

  // อ่าน localStorage (external system) ผ่าน useSyncExternalStore แทน useEffect+setState —
  // ฝั่ง server ไม่มี localStorage เลยต้องมี server snapshot แยก (คืน "dismissed" เสมอ
  // เพื่อกัน hydration mismatch) แล้วค่อย sync กับของจริงหลัง mount
  const getSnapshot = useCallback(
    () => localStorage.getItem(STORAGE_KEY) === signature,
    [signature]
  );
  const getServerSnapshot = useCallback(() => true, []);
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (msgs.length === 0 || dismissed) return null;

  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-marigold/40 bg-marigold/10 px-3 py-2 text-sm sm:mx-6">
      <BellRing className="size-4 shrink-0 text-marigold" />
      <span className="text-foreground/90">{msgs.join(" · ")}</span>
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={onGoImport}
          className="bg-marigold text-ink hover:bg-marigold/90"
        >
          ไปที่ Dashboard
        </Button>
        <button
          type="button"
          aria-label="ปิด"
          onClick={() => dismiss(signature)}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
