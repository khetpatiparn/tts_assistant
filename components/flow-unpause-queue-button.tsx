"use client";

import { useState, useTransition } from "react";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";

import { unpauseQueueOnly } from "@/app/actions";
import { unpauseQueueButtonLabel } from "@/lib/flow-lifecycle";
import { Button } from "@/components/ui/button";

/**
 * ปุ่มปลดการหยุดของบอทอย่างเดียว (unpauseQueueOnly — ไม่แตะงานพัง) ใช้ทั้งแถบ "บอทหยุดแล้ว" (flow-route) และการ์ดงานพัง
 * (flow-job-detail) · ข้อความ/การโชว์ตัดสินที่ unpauseQueueButtonLabel: เหตุที่ห้ามปลด = ไม่มีปุ่ม · ไม่มีงานพัง = "ให้บอททำงานต่อ"
 * · ปลดไม่ได้ (บอทเพิ่งหยุดด้วยเหตุอื่น) = ข้อความใต้ปุ่ม (ขึ้นบรรทัดใหม่ใน flex-wrap ของผู้เรียก)
 */
export function UnpauseQueueButton({
  pausedReason,
  failedJobs,
  disabled = false,
}: {
  pausedReason: string;
  failedJobs: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const label = unpauseQueueButtonLabel(pausedReason, failedJobs);
  if (label === null) return null;

  function unpause() {
    setMessage(null);
    startTransition(async () => {
      try {
        const r = await unpauseQueueOnly();
        if (!r.ok) setMessage(r.message ?? "ปลดการหยุดไม่สำเร็จ");
        else router.refresh();
      } catch {
        setMessage("ปลดการหยุดไม่สำเร็จ — ลองกดอีกครั้ง");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={disabled || pending} onClick={unpause}>
        <Play data-icon="inline-start" /> {label}
      </Button>
      {message !== null && (
        <p className="basis-full text-sm leading-relaxed text-destructive" role="alert">
          {message}
        </p>
      )}
    </>
  );
}
