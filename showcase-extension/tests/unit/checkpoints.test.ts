import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openCheckpointStore } from '../../extension/src/storage/checkpoints.js'
import type { CheckpointStore } from '../../extension/src/storage/checkpoints.js'
import { validatePage } from '../../extension/src/domain/page.js'
import type { NormalizeContext, NormalizedProduct } from '../../extension/src/domain/product.js'
import type { RunReport } from '../../extension/src/core/runner.js'
import { overlappingPage } from '../helpers/synthetic-catalog.js'

const CTX: NormalizeContext = {
  sourceRef: 'local-profile-01',
  sourceIdentityVerified: false,
  observedAt: '2026-09-19T10:00:00Z',
}

const productsFrom = (startIndex: number, size: number): NormalizedProduct[] => {
  const result = validatePage(
    {
      httpStatus: 200,
      headers: { 'content-type': 'application/json' },
      bodyText: overlappingPage(startIndex, size),
    },
    CTX,
  )
  if (result.outcome !== 'ok') throw new Error(result.outcome)
  return [...result.products]
}

let store: CheckpointStore

beforeEach(async () => {
  // ฐานข้อมูลใหม่ทุกเทสต์ เพื่อไม่ให้ lease ของเทสต์ก่อนรั่วมา
  globalThis.indexedDB = new IDBFactory()
  store = await openCheckpointStore('flow-a-test')
})

const startRun = (runId: string) =>
  store.acquireLease({
    runId,
    sourceRef: 'local-profile-01',
    adapterVersion: 'mock-v0',
    now: Date.parse('2026-09-19T10:00:00Z'),
  })

const sampleReport = (overrides: Partial<RunReport> = {}): RunReport => ({
  runId: 'run-finished-1',
  sourceRef: 'local-profile-01',
  adapterVersion: 'mock-v0',
  state: 'ready_complete',
  stopReason: 'endpoint_end',
  scanCoverage: 'reached_endpoint_end',
  dataQuality: 'clean',
  snapshotConsistency: 'unverified',
  counters: {
    requests: 1,
    successfulPages: 1,
    receivedRows: 1,
    invalidRows: 0,
    duplicateValidRows: 0,
    uniqueValidProducts: 1,
    candidates: 0,
    otherStatus: 0,
    unknownStatus: 1,
  },
  productIds: ['P0'],
  products: productsFrom(0, 1),
  quarantined: [],
  firstOffset: 0,
  pageSizeReductions: 0,
  observedIdentity: null,
  sourceIdentityVerified: false,
  changedWithinRun: false,
  warnings: [],
  resumeAfterMs: null,
  ...overrides,
})

describe('lease — หนึ่งงานต่อ profile (LC01/R03)', () => {
  it('run แรกได้ lease', async () => {
    const lease = await startRun('run-1')
    expect(lease.acquired).toBe(true)
    if (!lease.acquired) return
    expect(lease.generation).toBe(1)
  })

  it('run ที่สองถูกปฏิเสธขณะที่ lease แรกยังไม่หมดอายุ', async () => {
    await startRun('run-1')
    const second = await startRun('run-2')
    expect(second.acquired).toBe(false)
    if (second.acquired) return
    expect(second.reason).toBe('run_already_active')
    expect(second.activeRunId).toBe('run-1')
  })

  it('race สอง acquireLease พร้อมกันบน sourceRef เดียวกัน มีแค่หนึ่งที่สำเร็จ', async () => {
    const now = Date.parse('2026-09-19T10:00:00Z')
    const [a, b] = await Promise.all([
      store.acquireLease({ runId: 'run-A', sourceRef: 'local-profile-01', adapterVersion: 'mock-v0', now }),
      store.acquireLease({ runId: 'run-B', sourceRef: 'local-profile-01', adapterVersion: 'mock-v0', now }),
    ])
    const acquired = [a, b].filter((r) => r.acquired)
    expect(acquired).toHaveLength(1)
  })

  it('generation เพิ่มขึ้นทุกครั้งที่ยึด lease ใหม่หลังของเดิมหมดอายุ', async () => {
    await startRun('run-1')
    const later = Date.parse('2026-09-19T10:00:00Z') + store.leaseTtlMs + 1
    const second = await store.acquireLease({
      runId: 'run-2',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: later,
    })
    expect(second.acquired).toBe(true)
    if (!second.acquired) return
    expect(second.generation).toBe(2)
  })
})

describe('findActiveRunWithCount — checkpoint กับ productCount ต้องมาจาก snapshot เดียวกันเสมอ (D1/D2)', () => {
  it('race กับ commitPage หลายรอบติดกัน ไม่เคยเห็นคู่ checkpoint เก่า + productCount ใหม่ (หรือกลับกัน)', async () => {
    const lease = await startRun('run-race')
    if (!lease.acquired) throw new Error('ควรได้ lease')

    // หน้าแรก commit แบบ sequential ก่อน เพื่อให้มี "ก่อนแข่ง" ที่รู้ค่าแน่นอน
    await store.commitPage({
      runId: 'run-race',
      generation: lease.generation,
      pageIndex: 0,
      products: productsFrom(0, 6),
      nextOffset: 6,
      now: 1_000,
    })

    let page = 1
    let beforeCount = 6
    let beforeCommitAt: number | null = 1_000

    // ยิง findActiveRunWithCount แข่งกับ commitPage หน้าถัดไปพร้อมกันหลายรอบติด ๆ กัน (Promise.all) —
    // แบบเดียวกับเทสต์ race ของ acquireLease ด้านบน เพื่ออาศัย transaction scheduling จริงของ
    // fake-indexeddb (ไม่ใช่แค่ mock เวลา) กวาดหาช่วงที่การอ่านคาบเกี่ยวกับ commit จริง ๆ
    for (let round = 0; round < 25; round += 1) {
      const commitNow = 2_000 + round
      const afterCount = beforeCount + 6
      const afterCommitAt = commitNow

      const [found] = await Promise.all([
        store.findActiveRunWithCount('local-profile-01'),
        store.commitPage({
          runId: 'run-race',
          generation: lease.generation,
          pageIndex: page,
          products: productsFrom(page * 6, 6),
          nextOffset: (page + 1) * 6,
          now: commitNow,
        }),
      ])

      if (found === null) throw new Error('ควรเจอ active run เสมอระหว่างที่ run ยังไม่ release')

      // ค่าที่เห็นต้องเป็น snapshot "ก่อน" หรือ "หลัง" การ commit ของรอบนี้ทั้งคู่พร้อมกันเท่านั้น —
      // ห้ามเป็น checkpoint.lastCommitAt เก่าจับคู่กับ productCount ใหม่ (หรือกลับกัน) เด็ดขาด
      const matchesBefore = found.checkpoint.lastCommitAt === beforeCommitAt && found.productCount === beforeCount
      const matchesAfter = found.checkpoint.lastCommitAt === afterCommitAt && found.productCount === afterCount
      expect(matchesBefore || matchesAfter).toBe(true)

      page += 1
      beforeCount = afterCount
      beforeCommitAt = afterCommitAt
    }
  })

  it('เมื่อมีมากกว่าหนึ่ง active run ค้างอยู่ (lease หมดอายุแต่ยังไม่ release) เลือกตัวที่ updatedAt ล่าสุด', async () => {
    const stale = await startRun('run-old')
    if (!stale.acquired) throw new Error('ควรได้ lease')

    // ปล่อยให้ lease ของ run-old หมดอายุโดยไม่ release แล้วเริ่ม run ใหม่ทับ (เคสเดียวกับที่
    // findActiveRun เดิมมี comment ไว้ว่า "เช่น run เก่าที่ lease หมดอายุแล้วยังไม่ release")
    const later = Date.parse('2026-09-19T10:00:00Z') + store.leaseTtlMs + 1
    const fresh = await store.acquireLease({
      runId: 'run-new',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: later,
    })
    if (!fresh.acquired) throw new Error('ควรได้ lease ใหม่')

    const found = await store.findActiveRunWithCount('local-profile-01')
    expect(found?.checkpoint.runId).toBe('run-new')
  })
})

describe('LC03/LC04 — commit หน้าและ checkpoint เป็น transaction เดียว (R10)', () => {
  it('หลัง commit หน้าแรก ข้อมูลยังอยู่แม้ worker หายไป', async () => {
    const lease = await startRun('run-1')
    if (!lease.acquired) throw new Error('ควรได้ lease')

    await store.commitPage({
      runId: 'run-1',
      generation: lease.generation,
      pageIndex: 0,
      products: productsFrom(0, 6),
      nextOffset: 6,
      now: Date.parse('2026-09-19T10:00:10Z'),
    })

    // จำลอง worker ถูกหยุด: เปิด store ใหม่จากศูนย์
    const reopened = await openCheckpointStore('flow-a-test')
    const checkpoint = await reopened.readCheckpoint('run-1')
    expect(checkpoint?.nextOffset).toBe(6)
    expect(checkpoint?.lastCommittedPage).toBe(0)
    expect(await reopened.countProducts('run-1')).toBe(6)
  })

  it('ไม่มีสภาพครึ่ง ๆ: ถ้าเขียนแถวพัง checkpoint ต้องไม่เดิน', async () => {
    const lease = await startRun('run-1')
    if (!lease.acquired) throw new Error('ควรได้ lease')

    await store.commitPage({
      runId: 'run-1',
      generation: lease.generation,
      pageIndex: 0,
      products: productsFrom(0, 6),
      nextOffset: 6,
      now: Date.parse('2026-09-19T10:00:10Z'),
    })

    const poisoned = productsFrom(6, 6)
    // ค่าที่ structured clone ไม่ได้ ทำให้ transaction ล้มกลางคัน
    ;(poisoned[3] as unknown as Record<string, unknown>)['boom'] = (): void => undefined

    const result = await store.commitPage({
      runId: 'run-1',
      generation: lease.generation,
      pageIndex: 1,
      products: poisoned,
      nextOffset: 12,
      now: Date.parse('2026-09-19T10:00:20Z'),
    })

    expect(result.committed).toBe(false)
    if (result.committed) return
    expect(result.reason).toBe('storage_error')

    const checkpoint = await store.readCheckpoint('run-1')
    expect(checkpoint?.nextOffset).toBe(6)
    expect(checkpoint?.lastCommittedPage).toBe(0)
    expect(await store.countProducts('run-1')).toBe(6)
  })
})

describe('LC05 — fencing ปฏิเสธ write ที่มาช้าหลัง restart (R10)', () => {
  it('generation เก่าเขียนทับ run ใหม่ไม่ได้', async () => {
    const first = await startRun('run-1')
    if (!first.acquired) throw new Error('ควรได้ lease')

    const later = Date.parse('2026-09-19T10:00:00Z') + store.leaseTtlMs + 1
    const second = await store.acquireLease({
      runId: 'run-2',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: later,
    })
    if (!second.acquired) throw new Error('ควรได้ lease ใหม่')

    const stale = await store.commitPage({
      runId: 'run-1',
      generation: first.generation,
      pageIndex: 0,
      products: productsFrom(0, 6),
      nextOffset: 6,
      now: later + 10,
    })

    expect(stale.committed).toBe(false)
    if (stale.committed) return
    expect(stale.reason).toBe('stale_generation')
    expect(await store.countProducts('run-1')).toBe(0)
  })

  it('run ที่ถูกยกเลิกแล้วรับ commit ไม่ได้อีก', async () => {
    const lease = await startRun('run-1')
    if (!lease.acquired) throw new Error('ควรได้ lease')
    await store.releaseLease('run-1', lease.generation)

    const late = await store.commitPage({
      runId: 'run-1',
      generation: lease.generation,
      pageIndex: 0,
      products: productsFrom(0, 6),
      nextOffset: 6,
      now: Date.parse('2026-09-19T10:00:30Z'),
    })
    expect(late.committed).toBe(false)
  })
})

describe('LC03 — lease หมดอายุกลายเป็น interrupted ไม่ใช่ spinner ค้าง (R10)', () => {
  it('run ที่ heartbeat ขาดถูกรายงานว่า stale', async () => {
    const start = Date.parse('2026-09-19T10:00:00Z')
    await startRun('run-1')

    expect(await store.findStaleRuns(start + 1000)).toEqual([])
    const stale = await store.findStaleRuns(start + store.leaseTtlMs + 1)
    expect(stale).toEqual(['run-1'])
  })

  it('heartbeat ต่ออายุ lease ได้', async () => {
    const start = Date.parse('2026-09-19T10:00:00Z')
    const lease = await startRun('run-1')
    if (!lease.acquired) throw new Error('ควรได้ lease')

    await store.heartbeat('run-1', lease.generation, start + store.leaseTtlMs - 1000)
    expect(await store.findStaleRuns(start + store.leaseTtlMs + 1)).toEqual([])
  })
})

describe('LC07 — ขอบเขตพื้นที่ staging (V14b/R10)', () => {
  it('commit ที่ทำให้เกินเพดาน byte ถูกปฏิเสธ และ offset ไม่เดิน', async () => {
    const small = await openCheckpointStore('flow-a-test-small', { maxStagingBytes: 4096 })
    const lease = await small.acquireLease({
      runId: 'run-1',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: Date.parse('2026-09-19T10:00:00Z'),
    })
    if (!lease.acquired) throw new Error('ควรได้ lease')

    let committedPages = 0
    let rejected: string | null = null
    for (let page = 0; page < 20; page += 1) {
      const result = await small.commitPage({
        runId: 'run-1',
        generation: lease.generation,
        pageIndex: page,
        products: productsFrom(page * 6, 6),
        nextOffset: (page + 1) * 6,
        now: Date.parse('2026-09-19T10:00:00Z') + page * 1000,
      })
      if (result.committed) committedPages += 1
      else {
        rejected = result.reason
        break
      }
    }

    expect(rejected).toBe('staging_limit_reached')
    expect(committedPages).toBeGreaterThan(0)

    const checkpoint = await small.readCheckpoint('run-1')
    expect(checkpoint?.nextOffset).toBe(committedPages * 6)
    expect(await small.countProducts('run-1')).toBe(committedPages * 6)
  })
})

describe('checkpoint เก็บข้อมูลตามที่ §10 กำหนด', () => {
  it('มี runId, sourceRef, adapterVersion, lastCommittedPage, nextOffset, timestamps, generation', async () => {
    const lease = await startRun('run-1')
    if (!lease.acquired) throw new Error('ควรได้ lease')
    await store.commitPage({
      runId: 'run-1',
      generation: lease.generation,
      pageIndex: 0,
      products: productsFrom(0, 6),
      nextOffset: 6,
      now: Date.parse('2026-09-19T10:00:10Z'),
    })

    const checkpoint = await store.readCheckpoint('run-1')
    expect(checkpoint).toMatchObject({
      runId: 'run-1',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      lastCommittedPage: 0,
      nextOffset: 6,
      generation: 1,
    })
    expect(typeof checkpoint?.startedAt).toBe('number')
    expect(typeof checkpoint?.updatedAt).toBe('number')
  })

  it('ไม่เก็บ body ดิบหรือ header ไว้ใน checkpoint', async () => {
    const lease = await startRun('run-1')
    if (!lease.acquired) throw new Error('ควรได้ lease')
    await store.commitPage({
      runId: 'run-1',
      generation: lease.generation,
      pageIndex: 0,
      products: productsFrom(0, 6),
      nextOffset: 6,
      now: Date.parse('2026-09-19T10:00:10Z'),
    })
    const serialized = JSON.stringify(await store.readCheckpoint('run-1'))
    for (const leak of ['bodyText', 'headers', 'cookie', 'authorization']) {
      expect(serialized.toLowerCase()).not.toContain(leak)
    }
  })
})

describe('lastCommitAt — เวลาที่ commit สำเร็จล่าสุด แยกความหมายจาก updatedAt (D1/D2)', () => {
  it('lastCommitAt เป็น null ก่อน commit แรก และเท่ากับเวลา commit หลังจากนั้น', async () => {
    const lease = await store.acquireLease({
      runId: 'run-commit-at',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: 1_000,
    })
    if (!lease.acquired) throw new Error('lease ต้องได้')

    const fresh = await store.readCheckpoint('run-commit-at')
    expect(fresh?.lastCommitAt).toBeNull()

    const result = await store.commitPage({
      runId: 'run-commit-at',
      generation: lease.generation,
      pageIndex: 0,
      products: [],
      nextOffset: 6,
      now: 4_242,
    })
    expect(result.committed).toBe(true)

    const after = await store.readCheckpoint('run-commit-at')
    expect(after?.lastCommitAt).toBe(4_242)
  })

  it('heartbeat ไม่เปลี่ยน lastCommitAt — เป็นคนละความหมายกับ updatedAt', async () => {
    const lease = await store.acquireLease({
      runId: 'run-hb',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: 1_000,
    })
    if (!lease.acquired) throw new Error('lease ต้องได้')
    await store.commitPage({
      runId: 'run-hb',
      generation: lease.generation,
      pageIndex: 0,
      products: [],
      nextOffset: 6,
      now: 2_000,
    })
    await store.heartbeat('run-hb', lease.generation, 9_000)

    const after = await store.readCheckpoint('run-hb')
    expect(after?.lastCommitAt).toBe(2_000)
    expect(after?.updatedAt).toBe(9_000)
  })
})

describe('finished report — ผลของ run ที่จบแล้วต้องรอดจาก service worker ตาย (D5)', () => {
  it('readFinishedReport คืน null เมื่อยังไม่เคย save', async () => {
    expect(await store.readFinishedReport('local-profile-01')).toBeNull()
  })

  it('save แล้วอ่านกลับมาได้ครบทุก field รวมถึง products/quarantined/warnings', async () => {
    const report = sampleReport({ warnings: ['source_identity_unverified'] })
    await store.saveFinishedReport('local-profile-01', report)
    const readBack = await store.readFinishedReport('local-profile-01')
    expect(readBack).toEqual(report)
  })

  it('save ครั้งใหม่เขียนทับของเดิมของ sourceRef เดียวกัน ไม่สะสม/ไม่ append', async () => {
    await store.saveFinishedReport('local-profile-01', sampleReport({ runId: 'run-old' }))
    await store.saveFinishedReport('local-profile-01', sampleReport({ runId: 'run-new' }))
    const readBack = await store.readFinishedReport('local-profile-01')
    expect(readBack?.runId).toBe('run-new')
  })

  it('แยกกันตาม sourceRef — sourceRef อื่นไม่เห็นของกันและกัน', async () => {
    await store.saveFinishedReport('profile-a', sampleReport({ sourceRef: 'profile-a', runId: 'run-a' }))
    await store.saveFinishedReport('profile-b', sampleReport({ sourceRef: 'profile-b', runId: 'run-b' }))
    expect((await store.readFinishedReport('profile-a'))?.runId).toBe('run-a')
    expect((await store.readFinishedReport('profile-b'))?.runId).toBe('run-b')
  })

  it('clearFinishedReport ลบเฉพาะของ sourceRef ที่ระบุ', async () => {
    await store.saveFinishedReport('profile-a', sampleReport({ sourceRef: 'profile-a' }))
    await store.saveFinishedReport('profile-b', sampleReport({ sourceRef: 'profile-b' }))
    await store.clearFinishedReport('profile-a')
    expect(await store.readFinishedReport('profile-a')).toBeNull()
    expect(await store.readFinishedReport('profile-b')).not.toBeNull()
  })

  it('clearFinishedReport บน sourceRef ที่ไม่เคย save ไม่ throw', async () => {
    await expect(store.clearFinishedReport('never-existed')).resolves.toBeUndefined()
  })
})

describe('clearAll — ล้างข้อมูลที่ extension เก็บไว้ทั้งหมด (PK05)', () => {
  it('clearAll ลบทั้ง runs, products และ finished reports (D5) — ไม่มีสโตร์ไหนหลุดจากรอบล้าง', async () => {
    const lease = await store.acquireLease({
      runId: 'run-clear',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: 1_000,
    })
    if (!lease.acquired) throw new Error('lease ต้องได้')
    await store.commitPage({
      runId: 'run-clear',
      generation: lease.generation,
      pageIndex: 0,
      products: productsFrom(0, 6),
      nextOffset: 6,
      now: 1_100,
    })
    expect(await store.countProducts('run-clear')).toBe(6)
    await store.saveFinishedReport('local-profile-01', sampleReport({ runId: 'run-clear' }))
    expect(await store.readFinishedReport('local-profile-01')).not.toBeNull()

    await store.clearAll()

    expect(await store.countProducts('run-clear')).toBe(0)
    expect(await store.readCheckpoint('run-clear')).toBeNull()
    expect(await store.readFinishedReport('local-profile-01')).toBeNull()
    // หมายเหตุ (Task 3 fix round 1): findActiveRun ถูกลบแล้ว (dead code หลังเปลี่ยนไปใช้
    // findActiveRunWithCount) ใช้ตัวนั้นแทน — null semantics เหมือนเดิม
    expect(await store.findActiveRunWithCount('local-profile-01')).toBeNull()
  })

  it('หลัง clearAll ยังเริ่ม run ใหม่ได้และ generation ไม่ชนของเดิม', async () => {
    await store.acquireLease({
      runId: 'run-a',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: 1_000,
    })
    await store.clearAll()
    const again = await store.acquireLease({
      runId: 'run-b',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: 2_000,
    })
    expect(again.acquired).toBe(true)
  })
})
