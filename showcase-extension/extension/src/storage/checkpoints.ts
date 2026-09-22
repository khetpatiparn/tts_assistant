import type { NormalizedProduct } from '../domain/product.js'
import type { RunReport } from '../core/runner.js'

/** §10 — lease หมดอายุแล้วต้องกลายเป็น Interrupted ไม่ใช่ปล่อย spinner ค้างตลอดไป */
export const DEFAULT_LEASE_TTL_MS = 60_000

/** V14b — เพดาน staging ต่อ run */
export const DEFAULT_MAX_STAGING_BYTES = 20 * 1024 * 1024

// D5 — bump จาก 1: เพิ่ม STORE_FINISHED_REPORT เพื่อให้ผลของ run ที่จบแล้วรอดจาก MV3 service worker
// ถูก idle-kill ได้ (ดูเหตุผลเต็มที่คอมเมนต์ของ store นั้นด้านล่าง) DB เดิมที่มีแค่เวอร์ชัน 1 จะได้รับ
// `onupgradeneeded` เพื่อสร้าง store ใหม่นี้เพิ่มโดยไม่กระทบข้อมูลเดิมใน runs/products
const DB_VERSION = 2
const STORE_RUNS = 'runs'
const STORE_PRODUCTS = 'products'
/**
 * D5 — เก็บ `RunReport` ฉบับเต็มของ run ที่ "จบแล้ว" (ไม่ว่าจบเพราะเหตุผลอะไร) แยกจาก STORE_RUNS
 * ซึ่งเก็บแค่ checkpoint ระหว่างวิ่ง (ไม่มี stopReason/scanCoverage/quarantined ฯลฯ ที่คำนวณตอนจบ
 * เท่านั้น) ก่อนหน้านี้ RunReport ถูกเก็บไว้แค่ในตัวแปรใน memory ของ service worker
 * (`registry.currentReport`) — MV3 service worker ถูก Chrome idle-kill ได้ (ปกติหลังไม่มี event
 * ~30 วินาที) เมื่อผู้ใช้สแกนเสร็จแล้วใช้เวลาเลือกสินค้านานกว่านั้นก่อนกด Export ตัวแปรนี้หายไปเงียบ ๆ
 * และ Export ล้มด้วย `no_report` ทั้งที่ผลลัพธ์ยังโชว์อยู่บนจอ — key เป็น `sourceRef` (ไม่ใช่ `runId`)
 * เพราะสถาปัตยกรรมนี้ถือ "หนึ่ง run ต่อ profile" อยู่แล้ว จึงมีอย่างมากหนึ่ง finished report
 * ต่อ sourceRef เสมอ ไม่ต้อง query ย้อนหลังหลาย run
 */
const STORE_FINISHED_REPORT = 'finished_reports'

interface FinishedReportRecord {
  readonly sourceRef: string
  readonly report: RunReport
}

export interface RunCheckpoint {
  readonly runId: string
  readonly sourceRef: string
  readonly adapterVersion: string
  readonly generation: number
  readonly lastCommittedPage: number
  readonly nextOffset: number
  readonly stagedBytes: number
  readonly startedAt: number
  readonly updatedAt: number
  readonly leaseExpiresAt: number
  readonly released: boolean
  /** D1/D2 — เวลาที่ commitPage สำเร็จล่าสุด (epoch ms) null เมื่อยังไม่เคย commit — คนละความหมายกับ updatedAt ที่ heartbeat ก็แตะได้ */
  readonly lastCommitAt: number | null
}

export interface AcquireLeaseInput {
  readonly runId: string
  readonly sourceRef: string
  readonly adapterVersion: string
  readonly now: number
}

export type AcquireLeaseResult =
  | { readonly acquired: true; readonly generation: number }
  | { readonly acquired: false; readonly reason: 'run_already_active'; readonly activeRunId: string }

export interface CommitPageInput {
  readonly runId: string
  readonly generation: number
  readonly pageIndex: number
  readonly products: readonly NormalizedProduct[]
  readonly nextOffset: number
  readonly now: number
}

export type CommitReason = 'stale_generation' | 'storage_error' | 'staging_limit_reached'

export type CommitPageResult =
  | { readonly committed: true; readonly stagedBytes: number }
  | { readonly committed: false; readonly reason: CommitReason }

export interface CheckpointStore {
  readonly leaseTtlMs: number
  readonly maxStagingBytes: number
  acquireLease(input: AcquireLeaseInput): Promise<AcquireLeaseResult>
  releaseLease(runId: string, generation: number): Promise<void>
  heartbeat(runId: string, generation: number, now: number): Promise<void>
  commitPage(input: CommitPageInput): Promise<CommitPageResult>
  readCheckpoint(runId: string): Promise<RunCheckpoint | null>
  countProducts(runId: string): Promise<number>
  readProducts(runId: string): Promise<NormalizedProduct[]>
  findStaleRuns(now: number): Promise<string[]>
  /**
   * §10 — ให้ UI ที่เพิ่งเปิดใหม่หา run ที่ยังไม่ release ของ sourceRef นี้ได้ โดยไม่ต้องรู้ runId
   * ล่วงหน้า อ่าน checkpoint และ productCount ใน transaction เดียว (STORE_RUNS + STORE_PRODUCTS)
   * เพื่อให้ checkpoint.lastCommitAt กับ productCount มาจาก snapshot เวลาเดียวกันเสมอ — ถ้าแยกเป็น
   * สอง transaction (เคยเป็นแบบนั้นมาก่อน: อ่าน checkpoint แล้วค่อยนับ product แยกกันคนละ
   * transaction) คำขอที่มาคาบเกี่ยวกับ commitPage พอดีจะได้ checkpoint เก่ากับ productCount ใหม่
   * ผสมกัน ทำให้ "เวลา commit จริงล่าสุด" ที่รายงานออกไปคลาดเคลื่อนไปเกือบหนึ่งรอบ PAGE_INTERVAL_MS
   * (พบจาก E2E latency.spec.ts §16; มี race test ตรวจ atomicity นี้โดยตรงใน checkpoints.test.ts)
   */
  findActiveRunWithCount(
    sourceRef: string,
  ): Promise<{ readonly checkpoint: RunCheckpoint; readonly productCount: number } | null>
  /**
   * D5 — persist ผลของ run ที่จบแล้วทั้งก้อน เขียนทับของเดิมของ sourceRef เดียวกันเสมอ (ไม่ append)
   * เพื่อไม่ให้มีผลของ run เก่าค้างปนกับ run ใหม่ล่าสุด
   */
  saveFinishedReport(sourceRef: string, report: RunReport): Promise<void>
  readFinishedReport(sourceRef: string): Promise<RunReport | null>
  /** D5 — เรียกตอนเริ่ม run ใหม่ กันผลของ run ก่อนหน้าไม่ให้ถูก export ปนกับ run ที่กำลังวิ่งอยู่ */
  clearFinishedReport(sourceRef: string): Promise<void>
  /** PK05 — ล้างข้อมูลที่ extension เก็บไว้ทั้งหมดใน transaction เดียว */
  clearAll(): Promise<void>
}

export interface CheckpointStoreOptions {
  readonly leaseTtlMs?: number
  readonly maxStagingBytes?: number
}

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = (): void => {
      resolve(req.result)
    }
    req.onerror = (): void => {
      reject(req.error ?? new Error('indexeddb request failed'))
    }
  })

const openDatabase = (name: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    req.onupgradeneeded = (): void => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_RUNS)) db.createObjectStore(STORE_RUNS, { keyPath: 'runId' })
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const products = db.createObjectStore(STORE_PRODUCTS, { keyPath: ['runId', 'productId'] })
        products.createIndex('byRun', 'runId', { unique: false })
      }
      // D5 (เพิ่มใน DB_VERSION 2) — DB เดิมที่เคยเปิดด้วยเวอร์ชัน 1 จะวิ่งเข้า branch นี้พอดี
      // เพราะยังไม่มี store นี้ ข้อมูลเดิมใน runs/products ไม่ถูกแตะเลย
      if (!db.objectStoreNames.contains(STORE_FINISHED_REPORT)) {
        db.createObjectStore(STORE_FINISHED_REPORT, { keyPath: 'sourceRef' })
      }
    }
    req.onsuccess = (): void => {
      resolve(req.result)
    }
    req.onerror = (): void => {
      reject(req.error ?? new Error('indexeddb open failed'))
    }
  })

const byteLengthOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length

export async function openCheckpointStore(
  name: string,
  options: CheckpointStoreOptions = {},
): Promise<CheckpointStore> {
  const db = await openDatabase(name)
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
  const maxStagingBytes = options.maxStagingBytes ?? DEFAULT_MAX_STAGING_BYTES

  const readRun = async (runId: string): Promise<RunCheckpoint | null> => {
    const tx = db.transaction(STORE_RUNS, 'readonly')
    const value = await request<RunCheckpoint | undefined>(tx.objectStore(STORE_RUNS).get(runId))
    return value ?? null
  }

  const allRuns = async (): Promise<RunCheckpoint[]> => {
    const tx = db.transaction(STORE_RUNS, 'readonly')
    return await request<RunCheckpoint[]>(tx.objectStore(STORE_RUNS).getAll())
  }

  return {
    leaseTtlMs,
    maxStagingBytes,

    async acquireLease(input: AcquireLeaseInput): Promise<AcquireLeaseResult> {
      // อ่านและเขียนต้องอยู่ใน transaction เดียวกัน — IndexedDB serialize readwrite
      // transaction ที่แตะ store เดียวกันให้เอง ถ้าแยก read-then-write เป็นสอง transaction
      // สอง acquireLease ที่มาพร้อมกันจะอ่าน snapshot เดียวกันก่อนต่างฝ่ายต่างเขียน
      // แล้วผ่านทั้งคู่พร้อม generation เดียวกัน ซึ่งทำลายทั้ง "หนึ่งงานต่อ profile" และ fencing
      const tx = db.transaction(STORE_RUNS, 'readwrite')
      const store_ = tx.objectStore(STORE_RUNS)
      const runs = await request<RunCheckpoint[]>(store_.getAll())

      // §2.2 — รุ่นแรกหนึ่งงานต่อ browser profile
      const active = runs.find(
        (run) => !run.released && run.leaseExpiresAt > input.now && run.runId !== input.runId,
      )
      if (active !== undefined) {
        return { acquired: false, reason: 'run_already_active', activeRunId: active.runId }
      }

      // generation เดินหน้าอย่างเดียวทั่วทั้ง store เพื่อให้ response ที่ค้างอยู่จาก run ก่อน
      // ไม่มีทางมี generation ที่ยังใช้ได้
      const generation = runs.reduce((max, run) => Math.max(max, run.generation), 0) + 1

      const checkpoint: RunCheckpoint = {
        runId: input.runId,
        sourceRef: input.sourceRef,
        adapterVersion: input.adapterVersion,
        generation,
        lastCommittedPage: -1,
        nextOffset: 0,
        stagedBytes: 0,
        startedAt: input.now,
        updatedAt: input.now,
        leaseExpiresAt: input.now + leaseTtlMs,
        released: false,
        lastCommitAt: null,
      }

      await request(store_.put(checkpoint))
      return { acquired: true, generation }
    },

    async releaseLease(runId: string, generation: number): Promise<void> {
      const existing = await readRun(runId)
      if (existing === null || existing.generation !== generation) return
      const tx = db.transaction(STORE_RUNS, 'readwrite')
      await request(tx.objectStore(STORE_RUNS).put({ ...existing, released: true }))
    },

    async heartbeat(runId: string, generation: number, now: number): Promise<void> {
      const existing = await readRun(runId)
      if (existing === null || existing.generation !== generation || existing.released) return
      const tx = db.transaction(STORE_RUNS, 'readwrite')
      await request(
        tx.objectStore(STORE_RUNS).put({
          ...existing,
          updatedAt: now,
          leaseExpiresAt: now + leaseTtlMs,
        }),
      )
    },

    /**
     * §9.2 ข้อ 8 — แถวและ checkpoint ถูก commit ใน transaction เดียว
     * ถ้าเขียนแถวล้ม checkpoint ต้องไม่เดิน มิฉะนั้นจะเกิดสภาพ "offset เดินแต่ข้อมูลหาย" (LC04)
     *
     * §10 — ตรวจ generation ก่อนเขียนเสมอ เพื่อไม่ให้ response ที่มาช้าหลัง cancel/restart
     * เขียนทับ run ใหม่ (LC05)
     */
    async commitPage(input: CommitPageInput): Promise<CommitPageResult> {
      const runs = await allRuns()
      const existing = runs.find((run) => run.runId === input.runId) ?? null
      if (existing === null || existing.generation !== input.generation || existing.released) {
        return { committed: false, reason: 'stale_generation' }
      }

      // fencing ต้องเทียบกับ generation ปัจจุบันของ profile ไม่ใช่ของ run ตัวเอง
      // มิฉะนั้น response ที่ค้างอยู่จาก run เก่าจะผ่านการตรวจเสมอ เพราะ checkpoint ของมัน
      // ก็ยังถือ generation เดิมอยู่ (LC05)
      const currentGeneration = runs.reduce((max, run) => Math.max(max, run.generation), 0)
      if (input.generation !== currentGeneration) {
        return { committed: false, reason: 'stale_generation' }
      }

      const pageBytes = byteLengthOf(input.products)
      if (existing.stagedBytes + pageBytes > maxStagingBytes) {
        return { committed: false, reason: 'staging_limit_reached' }
      }

      const updated: RunCheckpoint = {
        ...existing,
        lastCommittedPage: input.pageIndex,
        nextOffset: input.nextOffset,
        stagedBytes: existing.stagedBytes + pageBytes,
        updatedAt: input.now,
        leaseExpiresAt: input.now + leaseTtlMs,
        lastCommitAt: input.now,
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([STORE_RUNS, STORE_PRODUCTS], 'readwrite')
          tx.oncomplete = (): void => {
            resolve()
          }
          tx.onerror = (): void => {
            reject(tx.error ?? new Error('transaction failed'))
          }
          tx.onabort = (): void => {
            reject(tx.error ?? new Error('transaction aborted'))
          }

          try {
            const products = tx.objectStore(STORE_PRODUCTS)
            for (const product of input.products) {
              products.put({ runId: input.runId, productId: product.productId, product })
            }
            tx.objectStore(STORE_RUNS).put(updated)
          } catch (error) {
            // put() โยน DataCloneError แบบ synchronous ซึ่งไม่ทำให้ transaction abort เอง
            // ถ้าไม่สั่ง abort แถวที่ queue ไปแล้วก่อนหน้าจะ commit ค้างไว้ กลายเป็นหน้าครึ่ง ๆ (LC04)
            tx.abort()
            reject(error instanceof Error ? error : new Error('page write failed'))
          }
        })
      } catch {
        return { committed: false, reason: 'storage_error' }
      }

      return { committed: true, stagedBytes: updated.stagedBytes }
    },

    readCheckpoint: readRun,

    async countProducts(runId: string): Promise<number> {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly')
      const index = tx.objectStore(STORE_PRODUCTS).index('byRun')
      return await request<number>(index.count(IDBKeyRange.only(runId)))
    },

    async readProducts(runId: string): Promise<NormalizedProduct[]> {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly')
      const index = tx.objectStore(STORE_PRODUCTS).index('byRun')
      const rows = await request<{ product: NormalizedProduct }[]>(
        index.getAll(IDBKeyRange.only(runId)),
      )
      return rows.map((row) => row.product)
    },

    async findStaleRuns(now: number): Promise<string[]> {
      const runs = await allRuns()
      return runs.filter((run) => !run.released && run.leaseExpiresAt <= now).map((run) => run.runId)
    },

    async findActiveRunWithCount(
      sourceRef: string,
    ): Promise<{ readonly checkpoint: RunCheckpoint; readonly productCount: number } | null> {
      // ต้องอ่านทั้งสอง store ใน transaction เดียวกัน (ไม่ใช่เรียก findActiveRun แล้วค่อย
      // countProducts แยกกันคนละ transaction) มิฉะนั้น commitPage ที่แทรกเข้ามาพอดีระหว่างสอง
      // การอ่านจะทำให้ checkpoint เก่าจับคู่กับ productCount ใหม่ — ไม่สอดคล้องกัน
      // (ยืนยันแล้วว่า tests/unit/checkpoints.test.ts จับ race นี้ได้จริง — ลองย้อนกลับไปใช้
      // สอง transaction แยกกันชั่วคราวแล้วรันเทสต์ พังทุกครั้งตามคาด ก่อนคืนกลับมาเป็นแบบนี้)
      const tx = db.transaction([STORE_RUNS, STORE_PRODUCTS], 'readonly')
      const runs = await request<RunCheckpoint[]>(tx.objectStore(STORE_RUNS).getAll())
      const active = runs.filter((run) => !run.released && run.sourceRef === sourceRef)
      if (active.length === 0) return null
      const checkpoint = active.reduce((newest, run) => (run.updatedAt > newest.updatedAt ? run : newest))

      const index = tx.objectStore(STORE_PRODUCTS).index('byRun')
      const productCount = await request<number>(index.count(IDBKeyRange.only(checkpoint.runId)))

      return { checkpoint, productCount }
    },

    async saveFinishedReport(sourceRef: string, report: RunReport): Promise<void> {
      const tx = db.transaction(STORE_FINISHED_REPORT, 'readwrite')
      const record: FinishedReportRecord = { sourceRef, report }
      await request(tx.objectStore(STORE_FINISHED_REPORT).put(record))
    },

    async readFinishedReport(sourceRef: string): Promise<RunReport | null> {
      const tx = db.transaction(STORE_FINISHED_REPORT, 'readonly')
      const record = await request<FinishedReportRecord | undefined>(
        tx.objectStore(STORE_FINISHED_REPORT).get(sourceRef),
      )
      return record?.report ?? null
    },

    async clearFinishedReport(sourceRef: string): Promise<void> {
      const tx = db.transaction(STORE_FINISHED_REPORT, 'readwrite')
      await request(tx.objectStore(STORE_FINISHED_REPORT).delete(sourceRef))
    },

    /**
     * PK05 — ต้องลบทั้งสาม store ใน transaction เดียวกัน (ไม่ใช่หลาย `.clear()` แยก transaction)
     * มิฉะนั้นถ้าล้มกลางทางจะเหลือสภาพครึ่ง ๆ เช่น runs ว่างแต่ products ยังคงอยู่ (หรือกลับกัน)
     */
    async clearAll(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_RUNS, STORE_PRODUCTS, STORE_FINISHED_REPORT], 'readwrite')
        tx.oncomplete = (): void => {
          resolve()
        }
        tx.onerror = (): void => {
          reject(tx.error ?? new Error('clear failed'))
        }
        tx.onabort = (): void => {
          reject(tx.error ?? new Error('clear aborted'))
        }
        tx.objectStore(STORE_RUNS).clear()
        tx.objectStore(STORE_PRODUCTS).clear()
        tx.objectStore(STORE_FINISHED_REPORT).clear()
      })
    },
  }
}
