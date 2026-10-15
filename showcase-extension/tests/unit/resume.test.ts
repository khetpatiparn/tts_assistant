import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openCheckpointStore } from '../../extension/src/storage/checkpoints.js'
import type { CheckpointStore } from '../../extension/src/storage/checkpoints.js'
import { resumeDashboardState } from '../../extension/src/dashboard/resume.js'
import { validatePage } from '../../extension/src/domain/page.js'
import type { NormalizeContext } from '../../extension/src/domain/product.js'
import { overlappingPage } from '../helpers/synthetic-catalog.js'

const CTX: NormalizeContext = {
  sourceRef: 'local-profile-01',
  sourceIdentityVerified: false,
  observedAt: '2026-09-19T10:00:00Z',
}

const products = () => {
  const result = validatePage(
    {
      httpStatus: 200,
      headers: { 'content-type': 'application/json' },
      bodyText: overlappingPage(0, 6),
    },
    CTX,
  )
  if (result.outcome !== 'ok') throw new Error(result.outcome)
  return [...result.products]
}

let store: CheckpointStore
const NOW = Date.parse('2026-09-19T10:00:00Z')

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  store = await openCheckpointStore('flow-a-resume-test')
})

describe('LC02 — ปิด popup ระหว่าง scan แล้วเปิดใหม่ ต้องเห็น run เดิม ไม่เริ่มใหม่เงียบ ๆ (R10)', () => {
  it('ไม่มี run ใดเลย → no_active_run', async () => {
    const state = await resumeDashboardState(store, 'local-profile-01', NOW)
    expect(state.kind).toBe('no_active_run')
  })

  it('run กำลังทำงานอยู่ (lease ยังไม่หมดอายุ) → running พร้อม checkpoint และจำนวนสินค้าที่ staged แล้ว', async () => {
    const lease = await store.acquireLease({
      runId: 'run-1',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: NOW,
    })
    if (!lease.acquired) throw new Error('ควรได้ lease')
    await store.commitPage({
      runId: 'run-1',
      generation: lease.generation,
      pageIndex: 0,
      products: products(),
      nextOffset: 6,
      now: NOW,
    })

    const state = await resumeDashboardState(store, 'local-profile-01', NOW + 5000)
    expect(state.kind).toBe('running')
    if (state.kind !== 'running') return
    expect(state.checkpoint.runId).toBe('run-1')
    expect(state.checkpoint.nextOffset).toBe(6)
    expect(state.productCount).toBe(6)
  })

  it('lease หมดอายุโดยไม่มี heartbeat → interrupted ไม่ใช่ spinner ค้างตลอดไป', async () => {
    const lease = await store.acquireLease({
      runId: 'run-1',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: NOW,
    })
    if (!lease.acquired) throw new Error('ควรได้ lease')
    await store.commitPage({
      runId: 'run-1',
      generation: lease.generation,
      pageIndex: 0,
      products: products(),
      nextOffset: 6,
      now: NOW,
    })

    const state = await resumeDashboardState(store, 'local-profile-01', NOW + store.leaseTtlMs + 1)
    expect(state.kind).toBe('interrupted')
    if (state.kind !== 'interrupted') return
    expect(state.productCount).toBe(6)
  })

  it('run ที่จบแล้วและถูก release → ไม่นับเป็น active, เปิดใหม่ต้องเริ่ม run ใหม่ได้ปกติ', async () => {
    const lease = await store.acquireLease({
      runId: 'run-1',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: NOW,
    })
    if (!lease.acquired) throw new Error('ควรได้ lease')
    await store.releaseLease('run-1', lease.generation)

    const state = await resumeDashboardState(store, 'local-profile-01', NOW + 1000)
    expect(state.kind).toBe('no_active_run')
  })

  it('run ของ sourceRef อื่นไม่ถูกนำมาแสดงข้าม profile', async () => {
    await store.acquireLease({
      runId: 'run-1',
      sourceRef: 'other-profile',
      adapterVersion: 'mock-v0',
      now: NOW,
    })
    const state = await resumeDashboardState(store, 'local-profile-01', NOW + 1000)
    expect(state.kind).toBe('no_active_run')
  })
})
