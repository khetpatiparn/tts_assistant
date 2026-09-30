import { prisma } from "@/lib/prisma";
import type { ActivityKind } from "@/lib/flow-activity";

/**
 * บันทึกการกระทำของบอทลง FlowActivity แบบ fire-and-forget — **ห้ามทำให้งานพังเพราะ log** (dev.db ถูก Next ใช้พร้อมกัน
 * อาจชน SQLITE_BUSY) พังก็พิมพ์บรรทัดเดียวแล้วไปต่อ · ไม่ await ที่จุดเรียก
 */
export function logActivity(input: { kind: ActivityKind; jobId?: string; round?: number; detail?: Record<string, unknown> }): void {
  const report = (e: unknown): void => {
    console.log(`${new Date().toISOString()}  บันทึก FlowActivity ไม่สำเร็จ (ไม่กระทบงาน): ${e instanceof Error ? e.message : String(e)}`);
  };
  try {
    prisma.flowActivity
      .create({
        data: {
          kind: input.kind,
          jobId: input.jobId ?? "",
          round: input.round ?? 0,
          detail: input.detail === undefined ? "" : JSON.stringify(input.detail).slice(0, 2000),
        },
      })
      .catch(report);
  } catch (e) {
    report(e);
  }
}
