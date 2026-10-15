import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { validateMessage } from '../../extension/src/messaging/validate.js'
import { handleMessage } from '../../extension/src/messaging/handle.js'
import type { HandlerContext, RunRegistry } from '../../extension/src/messaging/handle.js'
import { createMockShowcaseAdapter } from '../../extension/src/adapters/mock-showcase.js'
import { openCheckpointStore } from '../../extension/src/storage/checkpoints.js'
import type { CheckpointStore } from '../../extension/src/storage/checkpoints.js'
import type { RunStatusResponse } from '../../extension/src/messaging/schema.js'
import { catalogId, createCatalogServer } from '../helpers/synthetic-catalog.js'

const SELF = 'abcdefghijklmnopabcdefghijklmnop'
const sender = { id: SELF, url: `chrome-extension://${SELF}/dashboard/index.html` }

/**
 * รอจน fire-and-forget run เสร็จจริง — จำนวน microtask/timer tick ของ fake-indexeddb
 * ไม่คงที่โดยเฉพาะตอนรันพร้อมกันหลาย worker จึง poll แทนการนับ tick ตายตัว
 */
const waitForRunCompletion = async (registry: RunRegistry, maxIterations = 200): Promise<void> => {
  for (let i = 0; i < maxIterations && registry.currentReport === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  if (registry.currentReport === null) throw new Error('run ไม่เสร็จภายในเวลาที่รอ')
}

/** คล้าย waitForRunCompletion แต่ใช้กับกรณีที่ IIFE reject — currentReport จะไม่ถูกตั้งค่าเลย */
const waitForControllerReset = async (registry: RunRegistry, maxIterations = 200): Promise<void> => {
  for (let i = 0; i < maxIterations && registry.currentController !== null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  if (registry.currentController !== null) throw new Error('currentController ไม่ถูก reset ภายในเวลาที่รอ')
}

describe('message validation — run.* (R02/R11)', () => {
  it('run.cancel / run.status ไม่มี field อื่นนอกจาก type', () => {
    expect(validateMessage({ type: 'run.cancel' }, sender, SELF)).toEqual({ type: 'run.cancel' })
    expect(validateMessage({ type: 'run.status' }, sender, SELF)).toEqual({ type: 'run.status' })
  })

  it('run.start ต้องมี maxPages เสมอ (ไม่ optional) — null = ไม่จำกัด, จำนวนเต็มบวก = จำกัดจริง', () => {
    expect(validateMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, sender, SELF)).toEqual({
      type: 'run.start',
      maxPages: null,
      knownProductIds: null,
    })
    expect(validateMessage({ type: 'run.start', maxPages: 1, knownProductIds: null }, sender, SELF)).toEqual({
      type: 'run.start',
      maxPages: 1,
      knownProductIds: null,
    })
    expect(validateMessage({ type: 'run.start', maxPages: 34, knownProductIds: null }, sender, SELF)).toEqual({
      type: 'run.start',
      maxPages: 34,
      knownProductIds: null,
    })
  })

  it('run.start ไม่มี maxPages เลยถูกปฏิเสธ — ไม่มี default ที่ซ่อนอยู่ฝั่ง worker', () => {
    expect(() => validateMessage({ type: 'run.start', knownProductIds: null }, sender, SELF)).toThrow(
      /msg_forbidden_field/,
    )
  })

  it('run.start ปฏิเสธ maxPages ที่ไม่ใช่ null หรือจำนวนเต็มบวก', () => {
    for (const bad of [0, -1, 1.5, '2', true, undefined, NaN, Infinity]) {
      expect(
        () => validateMessage({ type: 'run.start', maxPages: bad, knownProductIds: null }, sender, SELF),
        String(bad),
      ).toThrow(/msg_malformed/)
    }
  })

  it('run.start ต้องมี knownProductIds เสมอเหมือน maxPages — null = ปิด auto-stop, array ของ string = เปิด', () => {
    expect(
      validateMessage({ type: 'run.start', maxPages: null, knownProductIds: ['a', 'b'] }, sender, SELF),
    ).toEqual({ type: 'run.start', maxPages: null, knownProductIds: ['a', 'b'] })
  })

  it('run.start ไม่มี knownProductIds เลยก็ถูกปฏิเสธเหมือนไม่มี maxPages', () => {
    expect(() => validateMessage({ type: 'run.start', maxPages: null }, sender, SELF)).toThrow(
      /msg_forbidden_field/,
    )
  })

  it('run.start ปฏิเสธ knownProductIds ที่ไม่ใช่ null หรือ array ของ string', () => {
    for (const bad of ['a', 1, true, [1, 2], [null]]) {
      expect(
        () => validateMessage({ type: 'run.start', maxPages: null, knownProductIds: bad }, sender, SELF),
        JSON.stringify(bad),
      ).toThrow(/msg_malformed/)
    }
  })

  it('run.export ต้องมี selectedIds เป็น array ของ string เท่านั้น', () => {
    expect(validateMessage({ type: 'run.export', selectedIds: ['a', 'b'] }, sender, SELF)).toEqual({
      type: 'run.export',
      selectedIds: ['a', 'b'],
    })
    for (const bad of [{ selectedIds: 'a' }, { selectedIds: [1, 2] }, { selectedIds: null }]) {
      expect(() => validateMessage({ type: 'run.export', ...bad }, sender, SELF)).toThrow(/msg_malformed/)
    }
  })

  it('run.export ยังปฏิเสธ field แปลกปลอมเหมือน type อื่น', () => {
    expect(() =>
      validateMessage({ type: 'run.export', selectedIds: [], url: 'https://evil.test' }, sender, SELF),
    ).toThrow(/msg_forbidden_field/)
  })
})

describe('run.* handlers (LC01/LC02/UI02/UI03)', () => {
  let store: CheckpointStore
  let registry: RunRegistry
  let ctx: HandlerContext
  let clock = Date.parse('2026-09-19T10:00:00Z')

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory()
    store = await openCheckpointStore('flow-a-run-messages')
    registry = { currentController: null, currentReport: null }
    clock = Date.parse('2026-09-19T10:00:00Z')
    const server = createCatalogServer({ total: 6 })
    ctx = {
      adapter: createMockShowcaseAdapter({
        pages: [{ bodyText: server.page(0, 6) }, { bodyText: server.page(6, 6) }],
      }),
      store,
      registry,
      sourceRef: 'local-profile-01',
      now: () => clock,
      sleep: async (ms, signal) => {
        clock += ms
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      },
    }
  })

  it('run.status ตอน idle ไม่มี run เลย', async () => {
    const r = (await handleMessage({ type: 'run.status' }, ctx)) as RunStatusResponse
    expect(r).toMatchObject({ ok: true, phase: 'idle' })
    expect(r.resume?.kind).toBe('no_active_run')
  })

  it('run.start เริ่ม run แบบ fire-and-forget แล้ว run.status เห็นว่ากำลังทำงาน', async () => {
    const started = await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    expect(started).toMatchObject({ ok: true, started: true })

    const status = (await handleMessage({ type: 'run.status' }, ctx)) as RunStatusResponse
    expect(status.phase).toBe('running')
  })

  it('LC01 — run.start ซ้อนขณะยังทำงานอยู่ถูกปฏิเสธ', async () => {
    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    const second = await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    expect(second).toMatchObject({ ok: false, code: 'already_running' })
  })

  it('run จบแล้ว run.status เป็น finished พร้อม report', async () => {
    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    await waitForRunCompletion(registry)

    const status = (await handleMessage({ type: 'run.status' }, ctx)) as RunStatusResponse
    expect(status.phase).toBe('finished')
    expect(status.report?.state).toBe('ready_complete')
    expect(status.report?.productIds).toEqual([catalogId(0), catalogId(1), catalogId(2), catalogId(3), catalogId(4), catalogId(5)])
  })

  it('run.cancel ยกเลิก run ที่กำลังทำงาน', async () => {
    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    const cancelled = await handleMessage({ type: 'run.cancel' }, ctx)
    expect(cancelled).toMatchObject({ ok: true })
    expect(registry.currentController?.signal.aborted).toBe(true)
  })

  it('run.cancel ตอนไม่มีอะไรทำงานอยู่ก็ยัง ok (idempotent)', async () => {
    const result = await handleMessage({ type: 'run.cancel' }, ctx)
    expect(result).toMatchObject({ ok: true })
  })

  it('UI02/UI03 — run.export คืนเฉพาะสินค้าที่เลือกพร้อม metadata จริง', async () => {
    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    await waitForRunCompletion(registry)

    const exported = await handleMessage(
      { type: 'run.export', selectedIds: [catalogId(0), catalogId(2)] },
      ctx,
    )
    expect(exported).toMatchObject({ ok: true })
    if (!('payload' in exported) || exported.payload === undefined) throw new Error('ไม่มี payload')
    expect(exported.payload.selectedProductIds).toEqual([catalogId(0), catalogId(2)])
    expect(exported.payload.scanCoverage).toBe('reached_endpoint_end')
  })

  it('run.export ก่อนมี report ใด ๆ ถูกปฏิเสธ ไม่ใช่คืน export ว่าง', async () => {
    const result = await handleMessage({ type: 'run.export', selectedIds: [] }, ctx)
    expect(result).toMatchObject({ ok: false, code: 'no_report' })
  })

  it('run.export ไม่หลุด body/headers ออกมา (R11)', async () => {
    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    await waitForRunCompletion(registry)
    const exported = await handleMessage(
      { type: 'run.export', selectedIds: [catalogId(0)] },
      ctx,
    )
    const serialized = JSON.stringify(exported).toLowerCase()
    for (const leak of ['bodytext', 'headers', 'cookie', 'authorization']) {
      expect(serialized).not.toContain(leak)
    }
  })

  it('D3 — registry ว่างแต่ lease ยังไม่หมดอายุ ต้องรายงานว่า interrupted ไม่ใช่ running', async () => {
    const lease = await store.acquireLease({
      runId: 'orphan-run',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: 1_000,
    })
    if (!lease.acquired) throw new Error('lease ต้องได้')

    // registry ว่าง = service worker ตัวที่เป็นเจ้าของถูกฆ่าไปแล้ว
    const orphanRegistry: RunRegistry = { currentController: null, currentReport: null }
    const status = await handleMessage(
      { type: 'run.status' },
      {
        adapter: ctx.adapter,
        store,
        sourceRef: 'local-profile-01',
        registry: orphanRegistry,
        now: () => 1_500,
        sleep: async () => {},
      },
    )

    expect(status.ok).toBe(true)
    if (!('phase' in status)) throw new Error('ต้องเป็น run.status response')
    expect(status.phase).toBe('idle')
    expect(status.resume?.kind).toBe('interrupted')
  })

  it('D3 — Start รับช่วง lease ที่กำพร้าได้ ไม่ติด run_already_active', async () => {
    await store.acquireLease({
      runId: 'orphan-run-2',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: 1_000,
    })

    const orphanRegistry: RunRegistry = { currentController: null, currentReport: null }
    const started = await handleMessage(
      { type: 'run.start', maxPages: null, knownProductIds: null },
      {
        adapter: ctx.adapter,
        store,
        sourceRef: 'local-profile-01',
        registry: orphanRegistry,
        now: () => 1_500,
        sleep: async () => {},
      },
    )

    expect(started).toEqual({ ok: true, started: true })

    // handleMessage คืนค่าทันทีแบบ fire-and-forget เสมอ (ok:true) ไม่ว่า lease จะชนกันหรือไม่ —
    // ความขัดแย้งจริงเกิดใน background run ต้องรอดู report เพื่อยืนยันว่าไม่ได้ถูก reject ด้วย
    // run_already_active (ซึ่งจะเกิดถ้า lease กำพร้ายังไม่ถูกปล่อยก่อนเริ่ม run ใหม่)
    await waitForRunCompletion(orphanRegistry)
    expect(orphanRegistry.currentReport?.stopReason).not.toBe('run_already_active')
    expect(orphanRegistry.currentReport?.state).toBe('ready_complete')
  })

  it('LC01 ยังบังคับได้ — Start ซ้ำขณะ registry มี run อยู่ ต้องถูกปฏิเสธ', async () => {
    const blockedRegistry: RunRegistry = { currentController: new AbortController(), currentReport: null }
    const second = await handleMessage(
      { type: 'run.start', maxPages: null, knownProductIds: null },
      {
        adapter: ctx.adapter,
        store,
        sourceRef: 'local-profile-01',
        registry: blockedRegistry,
        now: () => 1_000,
        sleep: async () => {},
      },
    )
    expect(second).toEqual({ ok: false, code: 'already_running' })
  })

  it('LC01 — run.start ที่ dispatch พร้อมกันสองครั้ง (สองแท็บ/double-click) ต้องมีแค่อันเดียวที่ชนะ (fix round 1)', async () => {
    // จำลองสองแท็บ/double-click จริง: ยิงพร้อมกันด้วย Promise.all ไม่ใช่ await ทีละตัว —
    // await ทีละตัวจะไม่มีทางเจอ race นี้เลยเพราะตัวแรกจอง registry เสร็จสมบูรณ์ก่อนตัวที่สองเริ่ม
    const sharedRegistry: RunRegistry = { currentController: null, currentReport: null }
    const raceCtx: HandlerContext = {
      adapter: ctx.adapter,
      store,
      sourceRef: 'local-profile-01',
      registry: sharedRegistry,
      now: () => 3_000,
      sleep: async () => {},
    }

    const [first, second] = await Promise.all([
      handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, raceCtx),
      handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, raceCtx),
    ])

    const results = [first, second]
    const succeeded = results.filter((r) => r.ok === true)
    const rejected = results.filter((r) => r.ok === false)

    // ต้องมีแค่อันเดียวที่ผ่าน guard ไปจอง registry ได้ — ไม่ใช่ทั้งคู่ (ซึ่งจะทำลาย LC01)
    expect(succeeded).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toEqual({ ok: false, code: 'already_running' })

    await waitForRunCompletion(sharedRegistry)
    // ผู้ชนะต้องจบด้วยผลจริงของ run ที่รันจริง ไม่ใช่ report ปลอมที่ถูก run ที่แพ้ (ซึ่งไม่ควรมีอยู่แล้ว)
    // มาทับ currentReport ทีหลัง
    expect(sharedRegistry.currentReport?.stopReason).not.toBe('run_already_active')
    expect(sharedRegistry.currentReport?.state).toBe('ready_complete')
  })

  it('run.start ที่ IIFE ภายในล้มเหลว (unhandled rejection) ต้อง reset currentController ไม่ใช่ค้างตลอดไป', async () => {
    // จำลอง IndexedDB ล้มเหลวจริงที่จุด findActiveRunWithCount ภายใน IIFE ของ run.start — ก่อนแก้ finding นี้
    // การ reject นี้ไม่มีใคร .catch() เลย เป็น unhandled rejection ที่ currentController ไม่ถูกรีเซ็ต ค้างตลอดไป
    const failingStore: CheckpointStore = {
      ...store,
      findActiveRunWithCount: () => Promise.reject(new Error('indexeddb ล้มจำลอง')),
    }
    const failingCtx: HandlerContext = { ...ctx, store: failingStore }

    const started = await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, failingCtx)
    expect(started).toEqual({ ok: true, started: true })
    // claim เป็น synchronous ทันทีก่อน guard ด้านบนนี้ — ต้องเห็นว่าจองไว้แล้วก่อนที่ IIFE จะ reject
    expect(registry.currentController).not.toBeNull()

    await waitForControllerReset(registry)
    expect(registry.currentController).toBeNull()

    // ต้องกู้คืนได้จริง ไม่ใช่แค่ตัวแปรว่างเฉย ๆ — run.start ถัดไปด้วย store ปกติต้องไม่ติด already_running
    const second = await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    expect(second).toEqual({ ok: true, started: true })
    await waitForRunCompletion(registry)
    expect(registry.currentReport?.state).toBe('ready_complete')
  })

  it('run.start ที่ IIFE ภายในล้มเหลว ต้องทำให้ data.clear (ตั้งแต่ Task 6) เรียกต่อได้ ไม่ใช่ถูกบล็อกตลอดไป', async () => {
    const failingStore: CheckpointStore = {
      ...store,
      findActiveRunWithCount: () => Promise.reject(new Error('indexeddb ล้มจำลอง')),
    }
    const failingCtx: HandlerContext = { ...ctx, store: failingStore }

    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, failingCtx)
    await waitForControllerReset(registry)

    // data.clear ปฏิเสธเมื่อ currentController !== null (guard เดียวกับ run.start) — ถ้า reset ไม่ทำงาน
    // ข้อความนี้จะได้ { ok: false, code: 'run_active' } ตลอดไปแม้ไม่มี run จริงวิ่งอยู่เลย
    const cleared = await handleMessage({ type: 'data.clear' }, ctx)
    expect(cleared).toEqual({ ok: true, cleared: true })
  })

  it('PK05 — data.clear ล้างข้อมูลเมื่อไม่มี run ทำงานอยู่', async () => {
    const lease = await store.acquireLease({
      runId: 'run-x',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: 1_000,
    })
    if (!lease.acquired) throw new Error('lease ต้องได้')

    const result = await handleMessage({ type: 'data.clear' }, ctx)

    expect(result).toEqual({ ok: true, cleared: true })
    // หมายเหตุ (Task 3 fix round 1): findActiveRun ถูกลบแล้ว ใช้ findActiveRunWithCount แทน
    expect(await store.findActiveRunWithCount('local-profile-01')).toBeNull()
    expect(registry.currentReport).toBeNull()
  })

  it('PK05 — data.clear ถูกปฏิเสธขณะมี run ทำงานอยู่ เพื่อไม่ให้แถวถูกเขียนกลับ', async () => {
    const blockedRegistry: RunRegistry = { currentController: new AbortController(), currentReport: null }
    const result = await handleMessage(
      { type: 'data.clear' },
      {
        adapter: ctx.adapter,
        store,
        sourceRef: 'local-profile-01',
        registry: blockedRegistry,
        now: () => 2_000,
        sleep: async () => {},
      },
    )
    expect(result).toEqual({ ok: false, code: 'run_active' })
  })
})

describe('D5 — ผลของ run ที่จบแล้วต้องรอดจาก service worker ตาย ไม่ใช่หายไปพร้อม registry', () => {
  let store: CheckpointStore
  let registry: RunRegistry
  let ctx: HandlerContext
  let clock = Date.parse('2026-09-19T10:00:00Z')

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory()
    store = await openCheckpointStore('flow-a-d5')
    registry = { currentController: null, currentReport: null }
    clock = Date.parse('2026-09-19T10:00:00Z')
    const server = createCatalogServer({ total: 6 })
    ctx = {
      adapter: createMockShowcaseAdapter({
        pages: [{ bodyText: server.page(0, 6) }, { bodyText: server.page(6, 6) }],
      }),
      store,
      registry,
      sourceRef: 'local-profile-01',
      now: () => clock,
      sleep: async (ms, signal) => {
        clock += ms
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      },
    }
  })

  /**
   * จำลอง "service worker ถูกฆ่าแล้วปลุกใหม่" — คืน context ที่ผูกกับ registry ว่างเปล่าอันใหม่
   * (คนละก้อนกับ `registry` ของ beforeEach) แต่ store เดิมยังอยู่ เหมือน module-level state ของ
   * background.ts ที่ reset ทุกครั้งที่ service worker ถูกปลุกใหม่ ในขณะที่ IndexedDB ไม่ถูกแตะเลย
   */
  const freshWorkerContext = (): { ctx: HandlerContext; registry: RunRegistry } => {
    const freshRegistry: RunRegistry = { currentController: null, currentReport: null }
    return { ctx: { ...ctx, registry: freshRegistry }, registry: freshRegistry }
  }

  it('run.status หลัง "service worker ตาย" ยัง fallback ไปอ่านผลจาก IndexedDB ได้ ไม่ใช่ idle เฉย ๆ', async () => {
    const started = await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    if (!('started' in started) || !started.started) throw new Error('run.start ต้องเริ่มได้')
    await waitForRunCompletion(registry)
    expect(registry.currentReport?.state).toBe('ready_complete')

    // registry คนละก้อนที่ว่างเปล่าจำลอง service worker ตัวใหม่ที่เพิ่งปลุกขึ้นมา — ผลของ run ก่อนหน้า
    // ต้องยังหาเจอผ่าน store ไม่ใช่หายไปพร้อม currentReport ของ registry เดิมที่ตายไปแล้ว
    const status = (await handleMessage({ type: 'run.status' }, freshWorkerContext().ctx)) as RunStatusResponse
    expect(status.phase).toBe('finished')
    expect(status.report?.state).toBe('ready_complete')
    expect(status.report?.productIds).toEqual([
      catalogId(0), catalogId(1), catalogId(2), catalogId(3), catalogId(4), catalogId(5),
    ])
  })

  it('run.export หลัง "service worker ตาย" ยัง export ได้จริง ไม่ใช่ no_report (บั๊กที่พบจากการใช้งานจริง)', async () => {
    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    await waitForRunCompletion(registry)

    const exported = await handleMessage(
      { type: 'run.export', selectedIds: [catalogId(0), catalogId(2)] },
      freshWorkerContext().ctx,
    )
    expect(exported).toMatchObject({ ok: true })
    if (!('payload' in exported) || exported.payload === undefined) throw new Error('ไม่มี payload')
    expect(exported.payload.selectedProductIds).toEqual([catalogId(0), catalogId(2)])
    expect(exported.payload.resultKind).toBe('full_scan')
  })

  it('run.export ไม่หยิบผลของ run ก่อนหน้าถ้ามี run ใหม่ค้างอยู่จริง (running/interrupted) — ต้อง run_active ไม่ใช่ผลเก่า', async () => {
    // จบ run แรกให้เสร็จสมบูรณ์ก่อน เพื่อมี finished report ของจริงอยู่ใน store
    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    await waitForRunCompletion(registry)
    expect(registry.currentReport?.runId).toBeDefined()

    // จำลองมี run ที่สองค้างอยู่ (lease ยังไม่ release) โดยไม่ผ่าน run.start เพื่อคุมสถานการณ์ให้แน่นอน
    await store.acquireLease({
      runId: 'run-still-going',
      sourceRef: 'local-profile-01',
      adapterVersion: 'mock-v0',
      now: clock,
    })

    const exported = await handleMessage(
      { type: 'run.export', selectedIds: [] },
      freshWorkerContext().ctx,
    )
    expect(exported).toEqual({ ok: false, code: 'run_active' })
  })

  it('run.start ใหม่ล้างผลของ run ก่อนหน้าออกจาก store — export หลังจบ run ใหม่ต้องไม่ใช่ของเก่า', async () => {
    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, ctx)
    await waitForRunCompletion(registry)
    const oldRunId = registry.currentReport?.runId
    expect(oldRunId).toBeDefined()

    // registry ใหม่ (จำลอง service worker คนละตัว) เริ่ม run ใหม่ทับ sourceRef เดียวกัน
    const second = freshWorkerContext()
    await handleMessage({ type: 'run.start', maxPages: null, knownProductIds: null }, second.ctx)
    await waitForRunCompletion(second.registry)

    const newRunId = second.registry.currentReport?.runId
    expect(newRunId).toBeDefined()
    expect(newRunId).not.toBe(oldRunId)

    // ผลที่ persist ไว้ต้องเป็นของ run ใหม่ล่าสุดเท่านั้น ไม่ใช่ของ run แรกที่ควรถูกล้างไปแล้วตอนเริ่ม
    const persisted = await store.readFinishedReport('local-profile-01')
    expect(persisted?.runId).toBe(newRunId)
  })
})
