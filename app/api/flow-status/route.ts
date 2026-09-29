import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FLOW_STATUS, WORKER_STATE_ID } from "@/lib/flow-jobs";

/**
 * สถานะย่อของคิว Flow ให้ components/flow-title-badge.tsx โพลทุกหน้า — นับแค่สิ่งที่ต้องการคน
 * (งานรอเลือกรูป/รอดูคลิป + บอทหยุด) ไม่ส่งรายการงาน เพราะถูกเรียกทุก 30 วิจากทุกแท็บที่เปิดอยู่
 */
export async function GET() {
  const [waitingUser, state] = await Promise.all([
    prisma.flowJob.count({
      where: { status: { in: [FLOW_STATUS.REVIEW_R1, FLOW_STATUS.REVIEW_R2, FLOW_STATUS.REVIEW_R3] } },
    }),
    prisma.flowWorkerState.findUnique({ where: { id: WORKER_STATE_ID }, select: { pausedReason: true } }),
  ]);
  return NextResponse.json({ waitingUser, paused: (state?.pausedReason ?? "") !== "" });
}
