import { prisma } from "@/lib/prisma";
import type { ActivityKind } from "@/lib/flow-activity";

/**
 * บันทึกการกระทำของผู้ใช้บนงาน Flow ลง FlowActivity (kind ขึ้นต้น "user_") — เรียกหลัง action เขียน DB สำเร็จแล้วเท่านั้น
 * ห้าม throw เด็ดขาด: ล้มเหลวแค่ console.error ไม่ให้ action ของผู้ใช้พังเพราะสมุดบันทึก
 */
export async function logUserActivity(args: {
  kind: Extract<ActivityKind, `user_${string}`>;
  jobId: string;
  round: number;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.flowActivity.create({
      data: { kind: args.kind, jobId: args.jobId, round: args.round, detail: JSON.stringify(args.detail ?? {}) },
    });
  } catch (err) {
    console.error("[flow-user-activity] บันทึกไม่สำเร็จ:", err);
  }
}

/** เวลาที่งานรอผู้ใช้ (ms) — ใช้ FlowJob.updatedAt ก่อน action เขียนทับ (= ตอนบอท/ระบบเปลี่ยนสถานะล่าสุด) */
export function waitedMsSince(updatedAt: Date): number {
  return Math.max(0, Date.now() - updatedAt.getTime());
}
