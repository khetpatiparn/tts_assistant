import type { CheckpointStore, RunCheckpoint } from '../storage/checkpoints.js'

export type ResumeState =
  | { readonly kind: 'no_active_run' }
  | { readonly kind: 'running'; readonly checkpoint: RunCheckpoint; readonly productCount: number }
  | { readonly kind: 'interrupted'; readonly checkpoint: RunCheckpoint; readonly productCount: number }

/**
 * §10 — เมื่อ UI เปิดใหม่ ให้ตรวจ lease/heartbeat ที่หมดอายุแล้วเปลี่ยน Running เป็น Interrupted
 * ไม่ปล่อย spinner ตลอดไป และไม่เริ่ม run ใหม่ทับของเดิมที่ยังไม่เสร็จเงียบ ๆ (LC02)
 */
export async function resumeDashboardState(
  store: CheckpointStore,
  sourceRef: string,
  now: number,
): Promise<ResumeState> {
  // findActiveRunWithCount อ่าน checkpoint และ productCount ใน transaction เดียว — สำคัญเพราะ
  // ถ้าแยกอ่านคนละ transaction (เดิม: findActiveRun แล้วค่อย countProducts) คำขอที่มาคาบเกี่ยวกับ
  // commitPage พอดีจะได้ checkpoint.lastCommitAt เก่าจับคู่กับ productCount ใหม่ ทำให้ผู้ที่วัด
  // "เวลาผ่านไปนานแค่ไหนจาก commit จริงล่าสุด" (เช่น dashboard, latency.spec.ts §16) เห็นค่าที่
  // ล้าหลังเกือบหนึ่งรอบ PAGE_INTERVAL_MS ทั้งที่ productCount ที่รายงานนั้นสดจริง
  const found = await store.findActiveRunWithCount(sourceRef)
  if (found === null) return { kind: 'no_active_run' }

  const { checkpoint, productCount } = found
  return checkpoint.leaseExpiresAt > now
    ? { kind: 'running', checkpoint, productCount }
    : { kind: 'interrupted', checkpoint, productCount }
}
