import { Check, Inbox, Loader2, MousePointerClick, SkipForward, X, type LucideIcon } from "lucide-react";

import { FLOW_STATUS } from "@/lib/flow-jobs";
import { cn } from "@/lib/utils";

const STEP_SHORT_LABELS = ["เข้าคิว", "วาดรอบ1", "เลือกรอบ1", "วาดรอบ2", "เลือกรอบ2", "เสร็จ"];

type StepState = "done" | "queued" | "system" | "user" | "fail" | "skip" | "pending";

/**
 * แปลงสถานะจริงของ FlowJob เป็นตำแหน่ง/สถานะของ 6 ขั้นใน stepper — queued_r2/running_r2
 * ใช้ตำแหน่งเดียวกัน ("วาดรอบ2") ต่างกันแค่ไอคอน (กล่องจดหมาย=รอคิว / หมุนๆ=กำลังทำจริง)
 * ตกลงกันตอนออกแบบผ่าน visual companion (2026-09-08) ว่าไม่ต้องแยกเป็น 8 ขั้น จะยาวเกินไป
 */
function deriveSteps(status: string, round: number): { states: StepState[]; current: number } {
  const states: StepState[] = ["pending", "pending", "pending", "pending", "pending", "pending"];
  switch (status) {
    case FLOW_STATUS.QUEUED_R1:
      states[0] = "queued";
      return { states, current: 0 };
    case FLOW_STATUS.RUNNING_R1:
      states[0] = "done";
      states[1] = "system";
      return { states, current: 1 };
    case FLOW_STATUS.REVIEW_R1:
      states[0] = states[1] = "done";
      states[2] = "user";
      return { states, current: 2 };
    case FLOW_STATUS.QUEUED_R2:
      states[0] = states[1] = states[2] = "done";
      states[3] = "queued";
      return { states, current: 3 };
    case FLOW_STATUS.RUNNING_R2:
      states[0] = states[1] = states[2] = "done";
      states[3] = "system";
      return { states, current: 3 };
    case FLOW_STATUS.REVIEW_R2:
      states[0] = states[1] = states[2] = states[3] = "done";
      states[4] = "user";
      return { states, current: 4 };
    case FLOW_STATUS.DONE:
      return { states: ["done", "done", "done", "done", "done", "done"], current: 5 };
    case FLOW_STATUS.FAILED:
    case FLOW_STATUS.SKIPPED: {
      // พังได้เฉพาะตอนกำลังวาด (running_*) เท่านั้น — round บอกว่าพังที่รอบไหน
      // (ตำแหน่ง 1 = วาดรอบ1, ตำแหน่ง 3 = วาดรอบ2)
      const failIdx = round === 2 ? 3 : 1;
      for (let i = 0; i < failIdx; i++) states[i] = "done";
      states[failIdx] = status === FLOW_STATUS.SKIPPED ? "skip" : "fail";
      return { states, current: failIdx };
    }
    default:
      return { states, current: 0 };
  }
}

const ICON_BY_STATE: Partial<Record<StepState, LucideIcon>> = {
  done: Check,
  queued: Inbox,
  system: Loader2,
  user: MousePointerClick,
  fail: X,
  skip: SkipForward,
  // pending ไม่มีไอคอน — วงกลมเปล่าจางๆ พอ
};

// สูตรสีเดียวกับ components/recommendations.tsx (border-status-X/50 bg-status-X/10 text-status-X)
// ตั้งใจไม่ใช้พื้นสีทึบ+ไอคอนขาว เพราะยังไม่เคยมีคู่สีนี้ผ่าน scripts/check-contrast.mjs มาก่อน
const CLASSES_BY_STATE: Record<StepState, string> = {
  done: "border-status-success/50 bg-status-success/10 text-status-success",
  queued: "border-border text-muted-foreground",
  system: "border-status-neutral/50 bg-status-neutral/10 text-status-neutral",
  user: "border-status-warning bg-status-warning/15 text-status-warning ring-2 ring-status-warning/25",
  fail: "border-status-danger/50 bg-status-danger/10 text-status-danger",
  skip: "border-border bg-surface-2 text-muted-foreground",
  pending: "border-border text-muted-foreground/40",
};

/**
 * แถบแสดงความคืบหน้า 6 ขั้นของงาน Flow 1 ชิ้น — ออกแบบร่วมกับผู้ใช้ผ่าน visual companion
 * (2026-09-08) ไม่มี label ข้อความ "รอระบบ/รอคุณ" กำกับเพิ่ม — ตั้งใจให้สี+ไอคอนสื่อความหมาย
 * พอในตัว (Loader2 หมุน = รอระบบ, MousePointerClick = รอคุณ) ตามที่ยืนยันกับผู้ใช้แล้ว
 */
export function FlowStepper({ status, round }: { status: string; round: number }) {
  const { states, current } = deriveSteps(status, round);

  return (
    <div className="flex items-start" aria-label={`ความคืบหน้า: ${STEP_SHORT_LABELS[current]}`}>
      {states.map((state, i) => {
        const Icon = ICON_BY_STATE[state];
        return (
          <div key={i} className="relative flex flex-1 flex-col items-center">
            {i > 0 && (
              <div
                aria-hidden="true"
                className={cn("absolute top-3 right-1/2 h-0.5 w-full", states[i - 1] === "done" ? "bg-status-success" : "bg-border")}
              />
            )}
            <div className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border", CLASSES_BY_STATE[state])}>
              {Icon && (
                <Icon className={cn("size-3.5", state === "system" && "animate-spin")} strokeWidth={state === "done" ? 3 : 2} />
              )}
            </div>
            <span
              className={cn(
                "mt-1 max-w-14 text-center text-xs leading-tight text-muted-foreground",
                i === current && "font-semibold text-foreground"
              )}
            >
              {STEP_SHORT_LABELS[i]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
