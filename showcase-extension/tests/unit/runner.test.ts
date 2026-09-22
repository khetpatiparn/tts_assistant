import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { runImport, MAX_QUARANTINED_RECORDS } from '../../extension/src/core/runner.js'
import type { RunnerDeps } from '../../extension/src/core/runner.js'
import { openCheckpointStore } from '../../extension/src/storage/checkpoints.js'
import type { CheckpointStore } from '../../extension/src/storage/checkpoints.js'
import { createMockShowcaseAdapter } from '../../extension/src/adapters/mock-showcase.js'
import type { MockPageScript } from '../../extension/src/adapters/mock-showcase.js'
import type { ShowcaseAdapter } from '../../extension/src/adapters/types.js'
import { RETRY_POLICY } from '../../extension/src/core/retry.js'
import { FlowAError } from '../../extension/src/domain/errors.js'
import { catalogId, createCatalogServer, expectedIds } from '../helpers/synthetic-catalog.js'

let store: CheckpointStore
let clock = Date.parse('2026-09-19T10:00:00Z')
const sleepLog: number[] = []

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  store = await openCheckpointStore('flow-a-runner')
  clock = Date.parse('2026-09-19T10:00:00Z')
  sleepLog.length = 0
})

const deps = (pages: readonly MockPageScript[]): RunnerDeps => ({
  adapter: createMockShowcaseAdapter({ pages }),
  store,
  now: () => clock,
  sleep: async (ms, signal) => {
    sleepLog.push(ms)
    clock += ms
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    await Promise.resolve()
  },
})

const catalogPages = (total: number, pageSize: number): MockPageScript[] => {
  const server = createCatalogServer({ total })
  const pages: MockPageScript[] = []
  for (let offset = 0; offset <= total; offset += pageSize) {
    pages.push({ bodyText: server.page(offset, pageSize) })
  }
  return pages
}

const start = (pages: readonly MockPageScript[], overrides: Record<string, unknown> = {}) =>
  runImport(
    {
      runId: 'run-1',
      sourceRef: 'local-profile-01',
      pageSize: 6,
      signal: new AbortController().signal,
      ...overrides,
    } as Parameters<typeof runImport>[0],
    deps(pages),
  )

describe('เส้นทางปกติ — สแกนจนถึงปลายทาง', () => {
  it('ได้ ID ครบและรายงานว่าถึงปลายทางที่ API แจ้ง', async () => {
    const report = await start(catalogPages(18, 6))
    expect(report.state).toBe('ready_complete')
    expect(report.scanCoverage).toBe('reached_endpoint_end')
    expect(report.counters.uniqueValidProducts).toBe(18)
    expect(report.productIds).toEqual(expectedIds(18))
  })

  it('สมการ counters ของ §9.5 เป็นจริงทั้ง run', async () => {
    const report = await start(catalogPages(18, 6))
    const c = report.counters
    expect(c.receivedRows).toBe(c.invalidRows + c.duplicateValidRows + c.uniqueValidProducts)
    expect(c.uniqueValidProducts).toBe(c.candidates + c.otherStatus + c.unknownStatus)
  })

  it('นับ request รวมหน้าว่างหน้าสุดท้ายด้วย', async () => {
    const report = await start(catalogPages(18, 6))
    expect(report.counters.successfulPages).toBe(3)
    expect(report.counters.requests).toBe(4)
  })

  it('snapshotConsistency เป็น unverified เสมอ — offset API ไม่มี atomic snapshot', async () => {
    const report = await start(catalogPages(18, 6))
    expect(report.snapshotConsistency).toBe('unverified')
  })

  it('ข้อมูลถูก commit ลง staging ครบ', async () => {
    await start(catalogPages(18, 6))
    expect(await store.countProducts('run-1')).toBe(18)
  })

  it('เว้นระยะระหว่างหน้าตาม policy ไม่ยิงติดกันรัว ๆ', async () => {
    await start(catalogPages(18, 6))
    expect(sleepLog.length).toBeGreaterThanOrEqual(3)
    for (const ms of sleepLog) expect(ms).toBeGreaterThanOrEqual(1000)
  })

  it('maxPages ไม่ระบุ (undefined ใน RunRequest) เท่ากับไม่จำกัด — สแกนจนจบเหมือนเดิม', async () => {
    // start() ไม่ใส่ maxPages เลย (RunRequest.maxPages เป็น optional) — ต้องเท่ากับพฤติกรรมเดิมทุกจุด
    // ทดสอบนี้ยืนยันว่าฟีเจอร์ใหม่ไม่เปลี่ยนพฤติกรรม default ของ test อื่นทั้งไฟล์ที่ไม่ได้แตะ maxPages เลย
    const report = await start(catalogPages(18, 6))
    expect(report.state).toBe('ready_complete')
    expect(report.stopReason).toBe('endpoint_end')
  })

  it('D2 — runner ต่ออายุ lease หลัง commit ทุกหน้า จึงไม่ถูกรายงานว่า interrupted ระหว่างวิ่ง', async () => {
    const heartbeats: { runId: string; now: number }[] = []
    const spied: CheckpointStore = {
      ...store,
      async heartbeat(runId: string, generation: number, now: number) {
        heartbeats.push({ runId, now })
        await store.heartbeat(runId, generation, now)
      },
    }

    const report = await runImport(
      { runId: 'run-hb-e2e', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      { adapter: createMockShowcaseAdapter({ pages: catalogPages(18, 6) }), store: spied, now: () => clock, sleep: async () => {} },
    )

    expect(report.state).toBe('ready_complete')
    // 18 รายการ / หน้าละ 6 = 3 หน้าที่มีข้อมูล → heartbeat อย่างน้อย 3 ครั้ง
    expect(heartbeats.length).toBeGreaterThanOrEqual(3)
    expect(heartbeats.every((h) => h.runId === 'run-hb-e2e')).toBe(true)
  })

  it('D2 gap — รอ retry สะสมนานเกิน leaseTtlMs โดยไม่มี commitPage คั่นกลาง lease ต้องไม่หมดอายุกลางคัน', async () => {
    // ช่องว่างจริงของ D2 ไม่ได้อยู่ที่หลัง commitPage (ซึ่ง commitPage เองก็ต่ออายุ lease อยู่แล้วตั้งแต่ก่อน
    // Task 2) แต่อยู่ที่ระหว่างรอ retry/backoff (deps.sleep(plan.waitMs, ...)) ซึ่งไม่มี commit เกิดขึ้นเลย —
    // จำลองด้วย rate_limited ที่ไม่เคยสำเร็จเลย (offset 0 ตลอด) พร้อม Retry-After คงที่ (เลี่ยง jitter เพื่อ
    // ผลลัพธ์ที่ deterministic) แล้วสอดแนม checkpoint ก่อนเริ่ม sleep แต่ละครั้ง
    const rateLimited: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: () =>
        Promise.resolve({ httpStatus: 429, headers: { 'retry-after': '40' }, bodyText: '{}' }),
    }

    const waitSnapshots: { beforeWaitNow: number; waitMs: number; leaseExpiresAt: number | null }[] = []

    const report = await runImport(
      {
        runId: 'run-hb-gap',
        sourceRef: 'local-profile-01',
        pageSize: 6,
        signal: new AbortController().signal,
        // งบมากพอที่จะไม่ pause เพราะงบเวลาไม่พอ (ไม่ใช่สิ่งที่ทดสอบนี้ต้องการพิสูจน์)
        budget: { maxDurationMs: 200_000, maxRequests: 20, maxProducts: 5000 },
      },
      {
        adapter: rateLimited,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          // อ่าน checkpoint "ก่อน" เดินนาฬิกา — นี่คือสถานะ lease ณ จุดที่เริ่มรอจริง
          const checkpoint = await store.readCheckpoint('run-hb-gap')
          waitSnapshots.push({
            beforeWaitNow: clock,
            waitMs: ms,
            leaseExpiresAt: checkpoint?.leaseExpiresAt ?? null,
          })
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )

    // maxAttemptsPerOffset=2 → ต้องมีอย่างน้อย 2 รอบของการรอก่อน give_up
    expect(waitSnapshots.length).toBeGreaterThanOrEqual(2)
    expect(report.stopReason).toBe('rate_limited')

    const secondWait = waitSnapshots[1]
    if (secondWait === undefined || secondWait.leaseExpiresAt === null) {
      throw new Error('ต้องมี snapshot ของการรอครั้งที่สองพร้อม checkpoint')
    }

    // จุดที่พิสูจน์ว่าช่องว่างถูกปิดจริง: lease ต้องถูกต่ออายุ "ก่อน" เริ่มรอครั้งที่สอง ให้ครอบคลุมตลอด
    // ความยาวของการรอครั้งนั้น (ไม่ใช่แค่ยังไม่หมดอายุ ณ วินาทีที่เริ่ม ซึ่งจะจริงเสมอเพราะรอบแรกสั้นกว่า
    // leaseTtlMs อยู่แล้ว) — ถ้า heartbeat ไม่ได้ถูกเรียกก่อน sleep รอบสอง lease จะยังเป็นค่าจาก
    // acquireLease ตอนต้น run (leaseTtlMs=60000 นับจาก run เริ่ม) ซึ่งน้อยกว่าจุดสิ้นสุดของการรอครั้งที่สอง
    // (beforeWaitNow + waitMs = 40000 + 40000 = 80000 นับจาก run เริ่ม) แน่นอน
    expect(secondWait.leaseExpiresAt).toBeGreaterThanOrEqual(secondWait.beforeWaitNow + secondWait.waitMs)
  })

  it('D2 — Retry-After ยาวสุดที่นโยบายยอมรับ (15 นาที) lease ต้องไม่หมดอายุแม้แต่วินาทีเดียวระหว่างรอ', async () => {
    // เคสนี้คือช่องว่างตัวจริงที่เทสต์ข้างบนจับไม่ได้: heartbeat "ครั้งเดียวก่อนรอ" ต่ออายุ lease ได้แค่
    // leaseTtlMs (60 วินาที) แต่ RETRY_POLICY.maxRetryAfterMs ยอมให้รอได้ถึง 15 นาที — lease จึงหมดอายุ
    // กลาง wait ทั้งที่ run ยังวิ่งอยู่ ทำให้ถูกตีความเป็น interrupted ผิด ๆ และเปิดช่องให้ run อื่นแย่ง lease
    //
    // พิสูจน์โดยเดินนาฬิกาไปทีละ chunk แล้วตรวจ "ทุกจุดเวลา" ว่า leaseExpiresAt ยังอยู่ข้างหน้าเสมอ
    const RETRY_AFTER_SECONDS = 900
    const rateLimited: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: () =>
        Promise.resolve({
          httpStatus: 429,
          headers: { 'retry-after': String(RETRY_AFTER_SECONDS) },
          bodyText: '{}',
        }),
    }

    /** ทุกจุดเวลาที่นาฬิกาเดินไปถึง คู่กับ lease ที่ยังถืออยู่ ณ ตอนนั้น */
    const timeline: { at: number; leaseExpiresAt: number | null }[] = []

    const report = await runImport(
      {
        runId: 'run-hb-long',
        sourceRef: 'local-profile-01',
        pageSize: 6,
        signal: new AbortController().signal,
        // งบต้องมากพอให้รอครบสองรอบเต็ม (15 นาที × 2) ไม่งั้นจะ pause เพราะงบหมด แทนที่จะรอจริง
        budget: { maxDurationMs: 60 * 60_000, maxRequests: 20, maxProducts: 5000 },
      },
      {
        adapter: rateLimited,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          const checkpoint = await store.readCheckpoint('run-hb-long')
          timeline.push({ at: clock, leaseExpiresAt: checkpoint?.leaseExpiresAt ?? null })
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )

    expect(report.stopReason).toBe('rate_limited')

    // การรอถูกซอยจริง ไม่ใช่ sleep ก้อนเดียว 15 นาที
    expect(timeline.length).toBeGreaterThan(2 * Math.floor((RETRY_AFTER_SECONDS * 1000) / store.leaseTtlMs))

    // แกนหลักของการพิสูจน์: ณ ทุกจุดเวลาที่นาฬิกาเดินไปถึง lease ต้องยังไม่หมดอายุ
    for (const point of timeline) {
      if (point.leaseExpiresAt === null) {
        throw new Error(`checkpoint หายไปที่เวลา ${point.at} — lease ต้องคงอยู่ตลอด run`)
      }
      expect(point.leaseExpiresAt).toBeGreaterThanOrEqual(point.at)
    }

    // และช่องว่างระหว่างสองจุดเวลาที่ติดกันต้องไม่เกิน TTL — ถ้าเกิน แปลว่ามีหน้าต่างที่ lease ตายได้
    for (let i = 1; i < timeline.length; i += 1) {
      const previous = timeline[i - 1]
      const current = timeline[i]
      if (previous === undefined || current === undefined) continue
      expect(current.at - previous.at).toBeLessThanOrEqual(store.leaseTtlMs)
    }
  })
})

describe('maxPages — ผู้ใช้จำกัดจำนวนหน้าเอง เพื่อลดจำนวน request ไป TikTok', () => {
  it('หยุดพอดีที่หน้าที่ขอ ไม่ข้ามไปหน้าถัดไป — ได้ page_limit_reached พร้อมข้อมูลบางส่วนที่ถูกต้อง', async () => {
    const report = await start(catalogPages(18, 6), { maxPages: 2 })
    expect(report.stopReason).toBe('page_limit_reached')
    expect(report.scanCoverage).toBe('partial')
    expect(report.state).toBe('ready_partial')
    // หน้า 1-2 เท่านั้น (12 รายการ) ไม่ใช่ทั้ง 18 — ต้องไม่ข้ามไปหน้าที่ 3 แล้วค่อยหยุด
    expect(report.counters.uniqueValidProducts).toBe(12)
    expect(report.productIds).toEqual(expectedIds(18).slice(0, 12))
  })

  it('maxPages=1 หยุดหลังหน้าแรกหน้าเดียว', async () => {
    const report = await start(catalogPages(18, 6), { maxPages: 1 })
    expect(report.stopReason).toBe('page_limit_reached')
    expect(report.counters.uniqueValidProducts).toBe(6)
  })

  it('maxPages เท่ากับจำนวนหน้าที่มีข้อมูลจริงพอดี แต่ยังไม่ถึงหน้าว่างสุดท้าย — ยังคือ page_limit_reached ไม่ใช่ endpoint_end จริง', async () => {
    // catalogPages(18,6) ต้องมีหน้าว่างที่ offset=18 มายืนยันจบจริง (ดูเทสต์ "นับ request รวมหน้าว่าง
    // หน้าสุดท้ายด้วย" ด้านบน) — maxPages=3 (หน้าสุดท้ายที่ "มี" ข้อมูล) จึงยังไม่เคยเห็นหน้าว่างนั้นเลย
    // ต้องรายงานตามความจริงว่าหยุดเพราะ user จำกัดเอง ไม่ใช่เพราะรู้ว่าจบจริงแล้ว
    const report = await start(catalogPages(18, 6), { maxPages: 3 })
    expect(report.stopReason).toBe('page_limit_reached')
    expect(report.scanCoverage).toBe('partial')
    expect(report.counters.uniqueValidProducts).toBe(18)
  })

  it('maxPages มากพอจนรวมหน้าว่างสุดท้ายด้วย — endpoint_end ชนะ ไม่ใช่ page_limit_reached (เหตุผลที่แม่นยำกว่าต้องมาก่อน)', async () => {
    const report = await start(catalogPages(18, 6), { maxPages: 10 })
    expect(report.stopReason).toBe('endpoint_end')
    expect(report.scanCoverage).toBe('reached_endpoint_end')
    expect(report.state).toBe('ready_complete')
  })

  it('maxPages: null เท่ากับไม่จำกัด (เหมือนไม่ส่ง field มาเลย)', async () => {
    const report = await start(catalogPages(18, 6), { maxPages: null })
    expect(report.stopReason).toBe('endpoint_end')
  })
})

describe('PG11 — retry ที่ runner จริงต้องจำกัดจำนวนครั้งต่อ offset (R09)', () => {
  it('5xx ที่ offset เดิมตลอด ต้อง retry ไม่เกิน maxAttemptsPerOffset แล้ว giveup ไม่ใช่วนไม่จบ', async () => {
    const calls: number[] = []
    const stuckAdapter: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        calls.push(req.offset)
        return Promise.resolve({ httpStatus: 500, headers: {}, bodyText: '{}' })
      },
    }
    const report = await runImport(
      {
        runId: 'run-1',
        sourceRef: 'local-profile-01',
        pageSize: 6,
        signal: new AbortController().signal,
        budget: { maxDurationMs: 600_000, maxRequests: 20, maxProducts: 5000 },
      },
      {
        adapter: stuckAdapter,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          sleepLog.push(ms)
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )

    // ต้องหยุดที่ 1 (initial) + maxAttemptsPerOffset (retry) ไม่ใช่ยิงจนชน request budget (20)
    expect(calls).toHaveLength(RETRY_POLICY.maxAttemptsPerOffset + 1)
    expect(calls.every((offset) => offset === 0)).toBe(true)
  })

  it('stop reason ต้องสะท้อนสาเหตุจริง (transient) ไม่ใช่ rate_limited เสมอ', async () => {
    const stuckAdapter: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: () => Promise.resolve({ httpStatus: 500, headers: {}, bodyText: '{}' }),
    }
    const report = await runImport(
      {
        runId: 'run-1',
        sourceRef: 'local-profile-01',
        pageSize: 6,
        signal: new AbortController().signal,
        budget: { maxDurationMs: 600_000, maxRequests: 20, maxProducts: 5000 },
      },
      {
        adapter: stuckAdapter,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )
    expect(report.stopReason).toBe('transport_error')
    expect(report.state).toBe('failed')
  })

  it('offset ที่ขยับแล้วรีเซ็ตตัวนับ retry — ล้ม 1 ครั้งที่หน้าแรกแล้วสำเร็จหน้าที่สองได้', async () => {
    const server = createCatalogServer({ total: 6 })
    let callsAtOffset0 = 0
    const flaky: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        if (req.offset === 0) {
          callsAtOffset0 += 1
          if (callsAtOffset0 === 1) {
            return Promise.resolve({ httpStatus: 500, headers: {}, bodyText: '{}' })
          }
        }
        return Promise.resolve({
          httpStatus: 200,
          headers: { 'content-type': 'application/json' },
          bodyText: server.page(req.offset, req.count),
        })
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      {
        adapter: flaky,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )
    expect(report.state).toBe('ready_complete')
    expect(report.counters.uniqueValidProducts).toBe(6)
  })

  it('network error (adapter throw) ก็ retry ตาม policy เดียวกัน ไม่ fail ทันทีโดยไม่ retry', async () => {
    const calls: number[] = []
    const throwing: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        calls.push(req.offset)
        return Promise.reject(new TypeError('network down'))
      },
    }
    const report = await runImport(
      {
        runId: 'run-1',
        sourceRef: 'local-profile-01',
        pageSize: 6,
        signal: new AbortController().signal,
        budget: { maxDurationMs: 600_000, maxRequests: 20, maxProducts: 5000 },
      },
      {
        adapter: throwing,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )
    expect(calls).toHaveLength(RETRY_POLICY.maxAttemptsPerOffset + 1)
    expect(report.stopReason).toBe('transport_error')
  })
})

describe('resumeAfterMs — งบเวลาไม่พอสำหรับ Retry-After (§9.4)', () => {
  it('เมื่อ pause เพราะงบเวลาไม่พอ ต้องส่งเวลาที่เริ่มใหม่ได้ออกมาใน report', async () => {
    const rateLimited: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: () =>
        Promise.resolve({ httpStatus: 429, headers: { 'retry-after': '120' }, bodyText: '{}' }),
    }
    const report = await runImport(
      {
        runId: 'run-1',
        sourceRef: 'local-profile-01',
        pageSize: 6,
        signal: new AbortController().signal,
        budget: { maxDurationMs: 30_000, maxRequests: 20, maxProducts: 5000 },
      },
      {
        adapter: rateLimited,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )
    expect(report.stopReason).toBe('rate_limited')
    expect(report.resumeAfterMs).toBe(120_000)
  })

  it('run ปกติที่ไม่ได้ pause ต้องมี resumeAfterMs เป็น null', async () => {
    const report = await start(catalogPages(18, 6))
    expect(report.resumeAfterMs).toBeNull()
  })
})

describe('pagination_stalled ต้องไม่ false-positive บนหน้าที่ทุกแถวเสีย (ไม่ใช่ซ้ำ)', () => {
  it('หน้าที่ raw rows ทั้งหมดเป็น invalid (ไม่ใช่ duplicate) ต้องเดินหน้าต่อ ไม่ใช่ pagination_stalled', async () => {
    const garbagePage = JSON.stringify({
      code: 0,
      message: 'success',
      data: {
        products: [
          { product_id: '', title: 'เสีย 1', format_available_price: '฿1.00' },
          { product_id: 'abc', title: 'เสีย 2', format_available_price: '฿1.00' },
        ],
      },
    })
    const emptyPage = '{"code":0,"message":"success","data":{"products":[]}}'
    const report = await start([{ bodyText: garbagePage }, { bodyText: emptyPage }])
    expect(report.stopReason).not.toBe('pagination_stalled')
    expect(report.state).toBe('ready_complete')
    expect(report.counters.invalidRows).toBe(2)
    expect(report.counters.uniqueValidProducts).toBe(0)
  })
})

describe('PG16 — ไม่มีสินค้าเลยแต่ envelope ถูกต้อง (R05)', () => {
  it('เป็น endpoint-end ที่ 0 แถว ไม่ใช่ความล้มเหลวของการล็อกอิน', async () => {
    const report = await start(catalogPages(0, 6))
    expect(report.state).toBe('ready_complete')
    expect(report.scanCoverage).toBe('reached_endpoint_end')
    expect(report.counters.uniqueValidProducts).toBe(0)
    expect(report.stopReason).toBe('endpoint_end')
  })
})

describe('PG06 — server คืนหน้าเดิมตลอด (R05)', () => {
  it('หยุดด้วย pagination_stalled เป็น partial ไม่วนไม่จบและไม่อ้างว่าครบ', async () => {
    const server = createCatalogServer({ total: 100 })
    const stuck = Array.from({ length: 20 }, () => ({ bodyText: server.page(0, 6) }))
    const report = await start(stuck)
    expect(report.state).toBe('ready_partial')
    expect(report.scanCoverage).toBe('partial')
    expect(report.stopReason).toBe('pagination_stalled')
    expect(report.counters.uniqueValidProducts).toBe(6)
  })
})

describe('PG08 — auth error กลางทาง (R09)', () => {
  it('หยุดด้วย auth_required และเก็บข้อมูลที่ได้มาก่อนหน้าเป็น partial', async () => {
    const pages = catalogPages(12, 6).slice(0, 1)
    pages.push({ httpStatus: 401, bodyText: '{}' })
    const report = await start(pages)
    expect(report.state).toBe('auth_required')
    expect(report.scanCoverage).toBe('partial')
    expect(report.counters.uniqueValidProducts).toBe(6)
    expect(await store.countProducts('run-1')).toBe(6)
  })

  it('ไม่มีการลด page size เพื่อพยายามผ่าน', async () => {
    const pages = catalogPages(12, 6).slice(0, 1)
    pages.push({ httpStatus: 403, bodyText: '{}' })
    const report = await start(pages)
    // §10 ไม่มี state ชื่อ access_denied — เป็นเหตุผลการหยุด ส่วน state คือ failed
    // และไม่ใช่ auth_required เพราะ 403 ไม่ใช่ปัญหาการล็อกอิน
    expect(report.stopReason).toBe('access_denied')
    expect(report.state).toBe('failed')
    expect(report.pageSizeReductions).toBe(0)
  })
})

describe('challenge_required — HTML login/CAPTCHA แทน JSON ต้องหยุด ไม่ตีเป็น schema_changed เฉย ๆ', () => {
  it('หยุดด้วย challenge_required, state เป็น auth_required เหมือน 401 และเก็บของเดิมไว้เป็น partial', async () => {
    const pages = catalogPages(12, 6).slice(0, 1)
    pages.push({
      httpStatus: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      bodyText: '<!doctype html><html>please log in</html>',
    })
    const report = await start(pages)
    expect(report.stopReason).toBe('challenge_required')
    expect(report.state).toBe('auth_required')
    expect(report.scanCoverage).toBe('partial')
    expect(report.counters.uniqueValidProducts).toBe(6)
  })

  it('ไม่มีการลด page size หรือ retry เพื่อพยายามผ่าน challenge', async () => {
    const report = await start([
      { httpStatus: 200, headers: { 'content-type': 'text/html' }, bodyText: '<html></html>' },
    ])
    expect(report.pageSizeReductions).toBe(0)
    expect(report.state).toBe('auth_required')
  })
})

/**
 * error ระดับ transport ที่ live adapter โยนออกมา (ยัง gate ด้วย G0_VERIFIED ที่ resolve.live.ts
 * เสมอ — ที่นี่ทดสอบว่า runner แยกแยะแต่ละ error code ถูกต้อง ผ่าน mock adapter ปลอมที่โยน error
 * เหล่านี้โดยตรง ไม่ต้องมี live adapter จริงหรือ network ใด ๆ)
 */
describe('adapter_redirect_blocked — redirect ที่หลุดจาก contract ต้องหยุดทันที ไม่ retry (spec §9.2 ข้อ 4)', () => {
  it('หยุดด้วย redirect_blocked ทันทีจากครั้งแรก ไม่มีการ retry', async () => {
    const calls: number[] = []
    const adapter: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        calls.push(req.offset)
        return Promise.reject(new FlowAError('adapter_redirect_blocked'))
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      { adapter, store, now: () => clock, sleep: async (ms) => { clock += ms } },
    )
    expect(report.stopReason).toBe('redirect_blocked')
    expect(calls).toHaveLength(1)
  })
})

describe('adapter_invalid_request — บั๊กภายในไม่ใช่ความผิดพลาดชั่วคราว ต้องไม่ retry ซ้ำ ๆ', () => {
  it('หยุดด้วย transport_error ทันที และบันทึกเหตุผลไว้ใน warnings', async () => {
    const calls: number[] = []
    const adapter: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        calls.push(req.offset)
        return Promise.reject(new FlowAError('adapter_invalid_request'))
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      { adapter, store, now: () => clock, sleep: async (ms) => { clock += ms } },
    )
    expect(report.stopReason).toBe('transport_error')
    expect(calls).toHaveLength(1)
    expect(report.warnings).toContain('transport_error:adapter_invalid_request')
  })
})

describe('adapter_body_too_large — จาก transport เอง เข้ากฎเดียวกับ body_too_large ระดับ envelope', () => {
  it('หยุดด้วย body_too_large ทันที ไม่ retry', async () => {
    const adapter: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: () => Promise.reject(new FlowAError('adapter_body_too_large')),
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      { adapter, store, now: () => clock, sleep: async (ms) => { clock += ms } },
    )
    expect(report.stopReason).toBe('body_too_large')
  })
})

describe('permission_required — host permission ยังไม่ได้รับอนุมัติ ต้องหยุดทันที ไม่ retry (UI06)', () => {
  it('หยุดด้วย permission_required ทันทีจากครั้งแรก และ state ตรงกับ JobState ที่ล็อกไว้ (§10)', async () => {
    const calls: number[] = []
    const adapter: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        calls.push(req.offset)
        return Promise.reject(new FlowAError('permission_required'))
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      { adapter, store, now: () => clock, sleep: async (ms) => { clock += ms } },
    )
    expect(report.stopReason).toBe('permission_required')
    expect(report.state).toBe('permission_required')
    expect(calls).toHaveLength(1)
    expect(report.pageSizeReductions).toBe(0)
  })

  it('ถอนสิทธิ์กลางทาง (หน้าแรกสำเร็จมาก่อนแล้ว) ยังเก็บข้อมูลที่ commit แล้วไว้เป็น partial', async () => {
    const firstPage = catalogPages(12, 6)[0]
    if (firstPage === undefined) throw new Error('fixture setup ผิด')
    const adapter: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        if (req.offset === 0) {
          return Promise.resolve({
            httpStatus: firstPage.httpStatus ?? 200,
            headers: firstPage.headers ?? { 'content-type': 'application/json' },
            bodyText: firstPage.bodyText,
          })
        }
        return Promise.reject(new FlowAError('permission_required'))
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      { adapter, store, now: () => clock, sleep: async (ms) => { clock += ms } },
    )
    expect(report.stopReason).toBe('permission_required')
    expect(report.scanCoverage).toBe('partial')
    expect(report.counters.uniqueValidProducts).toBe(6)
  })
})

describe('adapter_network_error/adapter_timeout — ยังเข้ากฎ retry เดียวกับ network error ทั่วไป (§9.4)', () => {
  it('network_error retry ได้ตามปกติแล้วค่อยหยุดเมื่อครบจำนวนครั้ง เหมือน error ที่ไม่มี FlowAError code', async () => {
    let attempts = 0
    const adapter: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: () => {
        attempts += 1
        return Promise.reject(new FlowAError('adapter_network_error'))
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      { adapter, store, now: () => clock, sleep: async (ms) => { clock += ms } },
    )
    expect(report.stopReason).toBe('transport_error')
    // ครั้งแรก (initial) + retry สูงสุด maxAttemptsPerOffset ครั้ง ก่อนยอมแพ้ (เหมือน PG11)
    expect(attempts).toBe(RETRY_POLICY.maxAttemptsPerOffset + 1)
  })

  it('timeout ก็ retry ได้เช่นเดียวกับ network_error ไม่ใช่ fatal', async () => {
    let attempts = 0
    const adapter: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: () => {
        attempts += 1
        return Promise.reject(new FlowAError('adapter_timeout'))
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      { adapter, store, now: () => clock, sleep: async (ms) => { clock += ms } },
    )
    expect(report.stopReason).toBe('transport_error')
    expect(attempts).toBe(RETRY_POLICY.maxAttemptsPerOffset + 1)
  })
})

describe('AT02 — schema เปลี่ยนไม่เท่ากับไม่มีสินค้า', () => {
  it('หยุดด้วย schema_changed เป็น partial และเก็บของเดิมไว้', async () => {
    const pages = catalogPages(12, 6).slice(0, 1)
    pages.push({ bodyText: '{"code":0,"message":"success","data":{"items":[]}}' })
    const report = await start(pages)
    expect(report.stopReason).toBe('schema_changed')
    expect(report.scanCoverage).toBe('partial')
    expect(report.counters.uniqueValidProducts).toBe(6)
  })

  it('หน้าแรกพังตั้งแต่ต้นและไม่มีข้อมูลเลย ถือว่า failed', async () => {
    const report = await start([{ bodyText: '{"code":0,"data":{"items":[]}}' }])
    expect(report.state).toBe('failed')
    expect(report.scanCoverage).toBe('unknown')
  })
})

describe('PG13 — ชนเพดานต้องเป็น partial พร้อมเหตุผลจริง (R05)', () => {
  it('เพดานจำนวน request', async () => {
    const report = await start(catalogPages(600, 6), {
      budget: { maxDurationMs: 600_000, maxRequests: 5, maxProducts: 5000 },
    })
    expect(report.state).toBe('ready_partial')
    expect(report.stopReason).toBe('request_limit_reached')
    expect(report.counters.requests).toBe(5)
  })

  it('เพดานจำนวนสินค้า', async () => {
    const report = await start(catalogPages(600, 6), {
      budget: { maxDurationMs: 600_000, maxRequests: 600, maxProducts: 12 },
    })
    expect(report.stopReason).toBe('product_limit_reached')
    expect(report.counters.uniqueValidProducts).toBe(12)
  })

  it('เพดานเวลา', async () => {
    const report = await start(catalogPages(600, 6), {
      budget: { maxDurationMs: 3000, maxRequests: 600, maxProducts: 5000 },
    })
    expect(report.stopReason).toBe('time_limit_reached')
    expect(report.scanCoverage).toBe('partial')
  })

  it('ไม่มีกรณีใดที่ตัดข้อมูลเงียบ ๆ แล้วอ้างว่าครบ', async () => {
    const report = await start(catalogPages(600, 6), {
      budget: { maxDurationMs: 600_000, maxRequests: 5, maxProducts: 5000 },
    })
    expect(report.scanCoverage).not.toBe('reached_endpoint_end')
  })
})

describe('PG15 — Cancel (R03)', () => {
  it('ยกเลิกระหว่างสแกนแล้วไม่มี request ใหม่ตามมา', async () => {
    const controller = new AbortController()
    const pages = catalogPages(600, 6)
    const adapter = createMockShowcaseAdapter({ pages })
    let requests = 0

    const report = await runImport(
      {
        runId: 'run-1',
        sourceRef: 'local-profile-01',
        pageSize: 6,
        signal: controller.signal,
      },
      {
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
          await Promise.resolve()
        },
        adapter: {
          adapterVersion: adapter.adapterVersion,
          mode: adapter.mode,
          fetchPage: async (request, signal) => {
            requests += 1
            if (requests === 3) controller.abort()
            return await adapter.fetchPage(request, signal)
          },
        },
      },
    )

    expect(report.state).toBe('cancelled')
    expect(requests).toBe(3)
    expect(report.counters.requests).toBe(3)
  })

  it('export ที่ได้ถูกระบุว่าเป็น partial', async () => {
    const controller = new AbortController()
    controller.abort()
    const report = await start(catalogPages(18, 6), { signal: controller.signal })
    expect(report.state).toBe('cancelled')
    expect(report.scanCoverage).not.toBe('reached_endpoint_end')
  })
})

describe('LC01 — หนึ่งงานต่อ profile (R03)', () => {
  it('start ซ้อนถูกปฏิเสธ ไม่เกิด network สองชุด', async () => {
    const first = await store.acquireLease({
      runId: 'other-run',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: clock,
    })
    expect(first.acquired).toBe(true)

    const report = await start(catalogPages(18, 6))
    expect(report.state).toBe('failed')
    expect(report.stopReason).toBe('run_already_active')
    expect(report.counters.requests).toBe(0)
  })
})

describe('LC06 — เริ่มใหม่หลัง browser restart (R10)', () => {
  it('run ที่ lease หมดอายุถูกรายงานว่า interrupted ไม่ใช่ completed', async () => {
    await store.acquireLease({
      runId: 'old-run',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: clock,
    })
    const stale = await store.findStaleRuns(clock + store.leaseTtlMs + 1)
    expect(stale).toEqual(['old-run'])
  })

  it('run ใหม่เริ่มขอ offset 0 จริงจาก adapter และไม่ผสมแถวของ run เก่า', async () => {
    const lease = await store.acquireLease({
      runId: 'old-run',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: clock,
    })
    if (!lease.acquired) throw new Error('lease ต้องได้')
    await store.commitPage({
      runId: 'old-run',
      generation: lease.generation,
      pageIndex: 0,
      products: [],
      nextOffset: 12,
      now: clock,
    })
    clock += store.leaseTtlMs + 1

    const offsets: number[] = []
    const adapter = createMockShowcaseAdapter({ pages: catalogPages(18, 6) })
    const recording: ShowcaseAdapter = {
      ...adapter,
      async fetchPage(req, signal) {
        offsets.push(req.offset)
        return await adapter.fetchPage(req, signal)
      },
    }

    const report = await runImport(
      { runId: 'new-run', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      { adapter: recording, store, now: () => clock, sleep: async () => {} },
    )

    expect(report.state).toBe('ready_complete')
    expect(offsets[0]).toBe(0) // ไม่ resume จาก nextOffset=12 ของ run เก่า
    expect(report.counters.uniqueValidProducts).toBe(18)
  })
})

describe('IT02/IT03 — การผูกกับบัญชี (R14)', () => {
  const withIdentity = (total: number, pageSize: number, identity: string): MockPageScript[] => {
    const server = createCatalogServer({ total })
    const pages: MockPageScript[] = []
    for (let offset = 0; offset <= total; offset += pageSize) {
      const parsed = JSON.parse(server.page(offset, pageSize)) as Record<string, unknown>
      ;(parsed['data'] as Record<string, unknown>)['seller_id'] = identity
      pages.push({ bodyText: JSON.stringify(parsed) })
    }
    return pages
  }

  it('IT02 — identity เปลี่ยนกลาง run ต้องหยุด ไม่ผสมข้อมูลข้ามบัญชี', async () => {
    const pages = [...withIdentity(12, 6, 'acct-A').slice(0, 1), ...withIdentity(12, 6, 'acct-B').slice(1, 2)]
    const report = await start(pages)
    expect(report.state).toBe('failed')
    expect(report.stopReason).toBe('identity_changed')
    expect(report.counters.uniqueValidProducts).toBe(6)
  })

  it('IT03 — response ไม่มี identity ต้องระบุว่า unverified ไม่ใช่อ้างว่ายืนยันแล้ว', async () => {
    const report = await start(catalogPages(18, 6))
    expect(report.sourceIdentityVerified).toBe(false)
    expect(report.observedIdentity).toBeNull()
    expect(report.warnings).toContain('source_identity_unverified')
  })

  it('identity ที่เหมือนกันทุกหน้าไม่ทำให้หยุด แต่ก็ยังไม่ถือว่า verified', async () => {
    const report = await start(withIdentity(18, 6, 'acct-A'))
    expect(report.state).toBe('ready_complete')
    expect(report.observedIdentity).toBe('acct-A')
    // §8.5 — sourceRef ที่ผู้ใช้ตั้งเองไม่ใช่หลักฐานยืนยันบัญชี และ G0 ยังไม่ยืนยัน field นี้
    expect(report.sourceIdentityVerified).toBe(false)
  })
})

describe('quarantined rows สะสมทั้ง run สำหรับแท็บ Rejected (§8.3)', () => {
  it('เก็บ offset + เหตุผล ของแถวที่ถูก quarantine โดยไม่เก็บเนื้อหาแถวดิบ', async () => {
    const pages: MockPageScript[] = [
      {
        bodyText: JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            products: [
              { product_id: '', title: 'เสีย A', format_available_price: '฿1.00' },
              { product_id: catalogId(0), title: 'ดี', format_available_price: '฿1.00', stock_status: 1, review_status: 1 },
              { product_id: 'abc', title: 'เสีย B', format_available_price: '฿1.00' },
            ],
          },
        }),
      },
      { bodyText: '{"code":0,"message":"success","data":{"products":[]}}' },
    ]
    const report = await start(pages)
    expect(report.quarantined).toHaveLength(2)
    expect(report.quarantined[0]).toMatchObject({ offset: 0, indexInPage: 0 })
    expect(report.quarantined[0]?.reasons).toContain('product_id_invalid')
    expect(report.quarantined[1]).toMatchObject({ offset: 0, indexInPage: 2 })
    // ไม่เก็บ title/price ดิบของแถวที่เสีย
    expect(JSON.stringify(report.quarantined)).not.toContain('เสีย')
  })

  it('จำนวน quarantined ตรงกับ counters.invalidRows', async () => {
    const report = await start(catalogPages(18, 6))
    expect(report.quarantined).toHaveLength(report.counters.invalidRows)
  })
})

describe('transport_error — pause เมื่องบเวลาไม่พอสำหรับ backoff (§9.4)', () => {
  it('network error ที่งบเวลาเหลือน้อยกว่า backoff ต้อง pause พร้อม resumeAfterMs ไม่ใช่หยุดเฉย ๆ', async () => {
    const throwing: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: () => Promise.reject(new TypeError('network down')),
    }
    const report = await runImport(
      {
        runId: 'run-1',
        sourceRef: 'local-profile-01',
        pageSize: 6,
        signal: new AbortController().signal,
        // งบเวลาน้อยกว่า backoff ต่ำสุดของ transient (2000ms) แต่ยังไม่ชน time_limit_reached
        // ตอนเริ่ม request แรก (elapsed = 0 < 1500)
        budget: { maxDurationMs: 1500, maxRequests: 20, maxProducts: 5000 },
      },
      {
        adapter: throwing,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )
    expect(report.stopReason).toBe('transport_error')
    expect(report.resumeAfterMs).not.toBeNull()
    expect(report.resumeAfterMs).toBeGreaterThanOrEqual(2000)
  })
})

describe('business_error — ต้องสะท้อนสาเหตุจริง ไม่ใช่ schema_changed หรือ transport_error เหมารวม', () => {
  it('code ที่ไม่ใช่ 0 หยุดด้วย business_error ทันที ไม่ retry', async () => {
    const calls: number[] = []
    const businessError: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        calls.push(req.offset)
        return Promise.resolve({
          httpStatus: 200,
          headers: { 'content-type': 'application/json' },
          bodyText: '{"code":10002,"message":"session invalid","data":{}}',
        })
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      {
        adapter: businessError,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )
    expect(report.stopReason).toBe('business_error')
    expect(report.state).toBe('failed')
    expect(calls).toHaveLength(1)
  })
})

describe('pagination_conflict — next_offset ที่ไม่เดินหน้าขัดกับ endpoint-end (PG14)', () => {
  it('next_offset <= currentOffset ขัดกันเอง ต้องหยุดด้วย pagination_conflict ไม่ใช่เดินหน้าเป็นวงไม่จบ', async () => {
    const conflicting: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: () =>
        Promise.resolve({
          httpStatus: 200,
          headers: { 'content-type': 'application/json' },
          bodyText: JSON.stringify({
            code: 0,
            message: 'success',
            data: {
              products: [
                { product_id: catalogId(0), title: 'สินค้า', format_available_price: '฿1.00', stock_status: 1, review_status: 1 },
              ],
              next_offset: 0,
            },
          }),
        }),
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      {
        adapter: conflicting,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )
    expect(report.stopReason).toBe('pagination_conflict')
  })
})

/**
 * total ที่เปลี่ยน/ขัดแย้งกลางคัน — **ยังไม่เคยพบจากของจริง** สังเคราะห์ขึ้นเพื่อพิสูจน์ fault
 * handling ที่ตั้งใจไว้ (docs/api-observations.md §2.1, ตาม tests/contract/pagination-contract.test.ts
 * ระดับ unit) — ตรงนี้พิสูจน์ระดับ runner เต็มรูปแบบว่า: หยุดจริง ไม่ falsely complete ไม่วนไม่จบ
 * และข้อมูลหน้าที่ commit ไปแล้วก่อนเจอ conflict ยังอยู่ครบ
 */
describe('pagination_conflict — total เปลี่ยนกลางคัน (สังเคราะห์ ยังไม่เคยพบจากของจริง)', () => {
  const pageWithTotal = (offset: number, count: number, total: number): string =>
    JSON.stringify({
      code: 0,
      message: 'success',
      data: {
        products: Array.from({ length: count }, (_, i) => ({
          product_id: catalogId(offset + i),
          title: `สินค้า ${String(offset + i)}`,
          format_available_price: '฿1.00',
          stock_status: 1,
          review_status: 1,
        })),
        total,
      },
    })

  it('total ลดลงกลางคัน (201 → 12) ต้องหยุดด้วย pagination_conflict ไม่ใช่ endpoint_end หรือ error ทั่วไป', async () => {
    const calls: number[] = []
    const shiftingTotal: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        calls.push(req.offset)
        const total = req.offset === 0 ? 201 : 12
        return Promise.resolve({
          httpStatus: 200,
          headers: { 'content-type': 'application/json' },
          bodyText: pageWithTotal(req.offset, 6, total),
        })
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      {
        adapter: shiftingTotal,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )

    expect(report.stopReason).toBe('pagination_conflict')
    // ไม่ falsely complete
    expect(report.state).not.toBe('ready_complete')
    expect(report.scanCoverage).toBe('partial')
    // ไม่วนไม่จบ — เรียกแค่ 2 ครั้ง (หน้าที่ total เปลี่ยนคือหน้าสุดท้ายที่ยิงจริง ไม่ใช่วนต่อไปเรื่อย ๆ)
    expect(calls).toEqual([0, 6])
    // ทั้งสองหน้า (รวม 12 แถว) ถูก commit ไปแล้วก่อนที่ decideAdvance จะพบว่า total ขัดแย้ง —
    // ตัวแถวเองยัง valid อยู่ ความขัดแย้งอยู่ที่ "จะรู้ได้ไงว่าสแกนครบ" ไม่ใช่ที่ตัวข้อมูล จึงไม่ทิ้งข้อมูล
    expect(report.counters.uniqueValidProducts).toBe(12)
    expect(report.productIds).toEqual([
      catalogId(0),
      catalogId(1),
      catalogId(2),
      catalogId(3),
      catalogId(4),
      catalogId(5),
      catalogId(6),
      catalogId(7),
      catalogId(8),
      catalogId(9),
      catalogId(10),
      catalogId(11),
    ])
    // เหตุผลที่แน่ชัดถูกเก็บไว้ให้เห็นได้ ไม่ใช่แค่ "pagination_conflict" เฉย ๆ
    expect(report.warnings).toContain('pagination_conflict:total_changed')
  })

  it('ได้รับแถวมากกว่า total ที่ประกาศไว้ (total_exceeded) ต้องหยุดเป็น conflict เช่นกัน', async () => {
    const calls: number[] = []
    const overTotal: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: (req) => {
        calls.push(req.offset)
        // total บอกว่ามีแค่ 3 แต่หน้าแรกก็ส่งมา 6 แล้ว — เกินตั้งแต่หน้าแรก
        return Promise.resolve({
          httpStatus: 200,
          headers: { 'content-type': 'application/json' },
          bodyText: pageWithTotal(req.offset, 6, 3),
        })
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      {
        adapter: overTotal,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )

    expect(report.stopReason).toBe('pagination_conflict')
    expect(calls).toEqual([0])
    // หน้าเดียวที่ได้มา (เกิน total ก็จริง) ยังถูก commit ไว้ ไม่ทิ้งข้อมูล
    expect(report.counters.uniqueValidProducts).toBe(6)
    expect(report.warnings).toContain('pagination_conflict:total_exceeded')
  })
})

describe('MAX_QUARANTINED_RECORDS — เพดานของรายการที่เก็บ ไม่ใช่เพดานของตัวนับ', () => {
  it('quarantined records ถูกตัดที่เพดาน แต่ counters.invalidRows นับครบทุกแถวเสมอ', async () => {
    const rows = Array.from({ length: MAX_QUARANTINED_RECORDS + 1 }, () => ({
      product_id: '',
      title: 'เสีย',
      format_available_price: '฿1.00',
    }))
    const pages: MockPageScript[] = [
      {
        bodyText: JSON.stringify({ code: 0, message: 'success', data: { products: rows } }),
      },
      { bodyText: '{"code":0,"message":"success","data":{"products":[]}}' },
    ]
    const report = await start(pages)
    expect(report.quarantined).toHaveLength(MAX_QUARANTINED_RECORDS)
    expect(report.counters.invalidRows).toBe(MAX_QUARANTINED_RECORDS + 1)
  })
})

describe('storage_error / staging_limit_reached — สอง commit failure ต้องแยกสาเหตุกัน ไม่เหมารวม', () => {
  it('staging เกินเพดานที่ตั้งไว้ต้องหยุดด้วย staging_limit_reached', async () => {
    const tinyStore = await openCheckpointStore('flow-a-runner-tiny-staging', { maxStagingBytes: 10 })
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      {
        adapter: createMockShowcaseAdapter({ pages: catalogPages(6, 6) }),
        store: tinyStore,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )
    expect(report.stopReason).toBe('staging_limit_reached')
  })

  it('commit ที่ล้มเหตุอื่น (เช่น lease ถูก release ไปแล้วจากที่อื่นระหว่าง request บิน) ต้องหยุดด้วย storage_error ไม่ใช่ staging_limit_reached', async () => {
    const server = createCatalogServer({ total: 6 })
    // ตัว store ล็อกหนึ่ง run ต่อ profile ทั้ง browser (ไม่ใช่ต่อ sourceRef) จึงจำลอง "run อื่นแซง
    // generation" ด้วยการ acquire ตรง ๆ ไม่ได้ — จำลอง response ที่มาช้าหลัง release แทน (LC05):
    // release lease ของ run-1 เองระหว่างที่ fetchPage กำลังบิน ก่อนที่ commitPage จะมาถึง
    const overtaking: ShowcaseAdapter = {
      adapterVersion: 'mock-v0',
      mode: 'mock',
      fetchPage: async (req) => {
        await store.releaseLease('run-1', 1)
        return {
          httpStatus: 200,
          headers: { 'content-type': 'application/json' },
          bodyText: server.page(req.offset, req.count),
        }
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: new AbortController().signal },
      {
        adapter: overtaking,
        store,
        now: () => clock,
        sleep: async (ms, signal) => {
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        },
      },
    )
    expect(report.stopReason).toBe('storage_error')
    // products ที่ normalize แล้วอยู่ใน accumulator (in-memory) ตั้งแต่ก่อน commit ล้ม
    // จึงยังเป็น ready_partial ไม่ใช่ failed — สอดคล้องกับ STATE_BY_REASON ที่ไม่ผูก storage_error ไว้ตายตัว
    expect(report.state).toBe('ready_partial')
  })
})

describe('cancel ระหว่างประมวลผลหน้าแต่ก่อน sleep ท้ายลูป', () => {
  it('signal ที่ abort ระหว่าง commit (หลังหน้าสำเร็จ ก่อน sleep) ยังจบเป็น cancelled ไม่ยิง request ต่อ', async () => {
    const controller = new AbortController()
    const pages = catalogPages(18, 6)
    const adapter = createMockShowcaseAdapter({ pages })
    let commitCalls = 0
    const wrappedStore: CheckpointStore = {
      ...store,
      commitPage: async (input) => {
        const result = await store.commitPage(input)
        commitCalls += 1
        controller.abort()
        return result
      },
    }
    const report = await runImport(
      { runId: 'run-1', sourceRef: 'local-profile-01', pageSize: 6, signal: controller.signal },
      {
        adapter,
        store: wrappedStore,
        now: () => clock,
        sleep: async (ms, signal) => {
          sleepLog.push(ms)
          clock += ms
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
          await Promise.resolve()
        },
      },
    )
    expect(commitCalls).toBe(1)
    expect(report.state).toBe('cancelled')
    expect(report.counters.uniqueValidProducts).toBe(6)
  })
})

describe('dataQuality สะท้อนสภาพจริง', () => {
  it('มี warning ทุกแถวเพราะ enum ยังไม่ยืนยัน', async () => {
    const report = await start(catalogPages(18, 6))
    expect(report.dataQuality).toBe('warnings')
  })

  it('มีแถวถูก quarantine ต้องรายงาน rejected_rows', async () => {
    const pages: MockPageScript[] = [
      {
        bodyText: JSON.stringify({
          code: 0,
          message: 'success',
          data: { products: [{ product_id: '', title: 'เสีย' }] },
        }),
      },
      { bodyText: '{"code":0,"message":"success","data":{"products":[]}}' },
    ]
    const report = await start(pages)
    expect(report.dataQuality).toBe('rejected_rows')
    expect(report.counters.invalidRows).toBe(1)
  })
})
