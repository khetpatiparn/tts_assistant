import type { NormalizedProduct } from '../domain/product.js'
import { G0_VERIFIED } from '../domain/version.js'

export interface PaginationMetadata {
  readonly hasMore: boolean | null
  readonly nextOffset: number | null
  readonly total: number | null
}

export interface AdvanceInput {
  readonly currentOffset: number
  readonly rawRowCount: number
  readonly metadata: PaginationMetadata | null
  /**
   * `total` ที่เคยเห็นจากหน้าก่อนหน้าใน run เดียวกัน (`null` = ยังไม่เคยเห็นมาก่อนในรอบนี้)
   * ใช้ตรวจว่า contract เปลี่ยนกลางคันหรือไม่ — ผู้เรียก (เช่น runner) เป็นฝ่ายเก็บค่านี้ไว้
   * เอง เพราะ decideAdvance เป็น pure function ไม่มี state ข้าม call
   */
  readonly previousTotal?: number | null
}

export type AdvanceConflict =
  | 'empty_page_but_has_more'
  | 'empty_page_but_total_not_reached'
  | 'next_offset_not_advancing'
  | 'next_offset_invalid'
  | 'total_changed'
  | 'total_disappeared'
  | 'total_exceeded'

export type AdvanceDecision =
  | { readonly kind: 'continue'; readonly nextOffset: number }
  | { readonly kind: 'endpoint_end' }
  | { readonly kind: 'conflict'; readonly reason: AdvanceConflict }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * อ่าน metadata เท่าที่มีจริง ไม่เติมค่าเริ่มต้นที่แต่งขึ้น
 *
 * ชื่อ field ที่อ่านตรงนี้ยังเป็นข้อสันนิษฐาน (spec §3.1) ค่าที่อ่านได้จึงใช้เพื่อ
 * "ตรวจความขัดแย้ง" เท่านั้น ไม่ใช้เป็นแหล่งความจริงในการเลื่อน offset จนกว่า G0 จะยืนยัน
 */
export function readPaginationMetadata(data: unknown): PaginationMetadata {
  if (!isRecord(data)) return { hasMore: null, nextOffset: null, total: null }

  const hasMore = typeof data['has_more'] === 'boolean' ? data['has_more'] : null
  const rawNext = data['next_offset']
  const nextOffset = typeof rawNext === 'number' && Number.isSafeInteger(rawNext) ? rawNext : null
  const rawTotal = data['total']
  const total = typeof rawTotal === 'number' && Number.isSafeInteger(rawTotal) ? rawTotal : null

  return { hasMore, nextOffset, total }
}

/**
 * ตัดสินใจว่าจะไปหน้าถัดไปหรือจบ
 *
 * §9.2 ข้อ 9 — ถ้า contract เป็น offset ของแถว ให้ใช้ `offset += rawList.length`
 * ไม่ใช่จำนวน unique/active/valid และห้ามใช้ `count` ที่ขอไป เพราะ server อาจคืนน้อยกว่า (PG03/PG04)
 *
 * `data.total` ใช้ตัดสินจุดจบได้แล้ว (ยืนยันจาก observed full capture — docs/api-observations.md §2.1)
 * ส่วน `next_offset` ของ upstream ยังใช้ได้ก็ต่อเมื่อ G0 ยืนยัน contract แล้วเท่านั้น เพราะไม่เคยพบว่า
 * field นี้มีอยู่จริงเลยสักครั้ง — ตอนนี้ใช้เพื่อตรวจความขัดแย้งอย่างเดียว (PG14)
 *
 * §9.3 หลักการอนุรักษนิยม: เมื่อ `total` ขัดแย้งกับตัวเองข้ามหน้า หรือขัดแย้งกับจำนวนแถวที่ได้รับ
 * ให้ตอบเป็น `conflict` เสมอ ไม่เดาว่าฝั่งไหนถูก ไม่แก้ total เอง และไม่ทำให้ run ดูเหมือน complete
 * เคสเหล่านี้ยังไม่เคยพบจาก TikTok จริง (ดู tests/contract/pagination-contract.test.ts — synthetic ล้วน)
 * แต่ spec ห้ามข้าม fault handling เพียงเพราะยังไม่เคยสังเกตเห็น
 */
export function decideAdvance(input: AdvanceInput): AdvanceDecision {
  const { currentOffset, rawRowCount, metadata } = input
  const previousTotal = input.previousTotal ?? null
  const total = metadata?.total ?? null

  // ตรวจว่า contract ของ total เองขัดแย้งก่อนตัดสินใจอื่นใด — ถ้าเรื่องเล่าข้ามหน้าไม่ตรงกัน
  // ห้ามเดาต่อว่าฝั่งไหนถูก ไม่ว่าหน้านี้จะมีแถวหรือไม่ก็ตาม
  if (previousTotal !== null) {
    if (total === null) return { kind: 'conflict', reason: 'total_disappeared' }
    if (total !== previousTotal) return { kind: 'conflict', reason: 'total_changed' }
  }

  if (rawRowCount === 0) {
    // §9.3 — หน้าว่างที่ envelope ถูกต้องคือ endpoint-end
    // แต่ถ้า metadata ยืนยันว่ายังมีต่อ (has_more หรือ total ที่ยังไปไม่ถึง) แปลว่าเรื่องเล่าขัดกัน
    if (metadata?.hasMore === true) return { kind: 'conflict', reason: 'empty_page_but_has_more' }
    if (total !== null && currentOffset < total) {
      return { kind: 'conflict', reason: 'empty_page_but_total_not_reached' }
    }
    return { kind: 'endpoint_end' }
  }

  if (metadata?.hasMore === false) return { kind: 'endpoint_end' }

  /**
   * ยืนยันจาก full capture ทั้ง 3 หน้าจริงแล้วว่า `offset + products.length === data.total`
   * คือจุดจบ (198 + 3 = 201 พอดีที่หน้าสุดท้าย) — total มีอยู่จริงทุกหน้าที่สังเกตได้ ต่างจาก
   * next_offset/has_more ด้านล่างซึ่งไม่เคยพบว่ามีอยู่จริงเลย จึงไม่ต้องรอ G0_VERIFIED
   *
   * เกินพอดี (`>`) ไม่ใช่ "จบแบบเดียวกับถึงพอดี" — เป็นสัญญาณว่าจำนวนที่ได้รับกับ total ที่ประกาศ
   * ไม่สอดคล้องกัน (เช่น total เก่า/ผิด หรือมีการนับซ้ำ) ต้อง flag แยกเป็น conflict ไม่ใช่เดาว่า "จบแล้ว"
   */
  if (total !== null) {
    const reachedOrPast = currentOffset + rawRowCount
    if (reachedOrPast > total) return { kind: 'conflict', reason: 'total_exceeded' }
    if (reachedOrPast === total) return { kind: 'endpoint_end' }
  }

  if (metadata?.nextOffset !== null && metadata?.nextOffset !== undefined) {
    if (metadata.nextOffset < 0) return { kind: 'conflict', reason: 'next_offset_invalid' }
    if (metadata.nextOffset <= currentOffset) {
      return { kind: 'conflict', reason: 'next_offset_not_advancing' }
    }
    if (G0_VERIFIED) return { kind: 'continue', nextOffset: metadata.nextOffset }
  }

  return { kind: 'continue', nextOffset: currentOffset + rawRowCount }
}

export interface AccumulatorOptions {
  /** V13 — เพดานจำนวนสินค้าต่อ run; ถึงเพดานต้องรายงาน ไม่ตัดเงียบ */
  readonly maxProducts?: number
}

export interface PageAddResult {
  readonly newIds: number
  readonly duplicateIds: number
  readonly changedIds: number
  readonly acceptedIds: number
  readonly droppedByLimit: number
  readonly limitReached: boolean
}

export interface ProductAccumulator {
  addPage(products: readonly NormalizedProduct[]): PageAddResult
  readonly uniqueValidProducts: number
  readonly duplicateValidRows: number
  readonly receivedValidRows: number
  readonly changedWithinRun: boolean
  productIds(): string[]
  changedProductIds(): string[]
  snapshot(): NormalizedProduct[]
}

export const DEFAULT_MAX_PRODUCTS = 5000

/** เทียบเฉพาะ field ที่บ่งบอกว่า "ข้อมูลสินค้าเปลี่ยน" ไม่รวม observedAt ที่ต่างกันทุกหน้าอยู่แล้ว */
const productFingerprint = (p: NormalizedProduct): string =>
  JSON.stringify([
    p.title,
    p.priceDisplay,
    p.stockQuantity,
    p.stockStatusRaw,
    p.reviewStatusRaw,
    p.canAddRaw,
    p.eligibility,
    p.imageUrls,
    p.shopName,
    p.commissionRate,
  ])

/**
 * รวมสินค้าจากหลายหน้าเข้าด้วยกัน
 *
 * §9.2 ข้อ 7 — ถ้า ID เดิมมีค่าต่างกัน ใช้ข้อมูล valid ที่พบล่าสุด บันทึก changedWithinRun
 * และไม่เพิ่ม unique count; แถวที่ invalid ถูก quarantine ตั้งแต่ชั้น page จึงไม่มีทางมาถึงที่นี่
 * และทับข้อมูลดีที่มีอยู่ได้
 */
export function createProductAccumulator(options: AccumulatorOptions = {}): ProductAccumulator {
  const maxProducts = options.maxProducts ?? DEFAULT_MAX_PRODUCTS
  const byId = new Map<string, NormalizedProduct>()
  const order: string[] = []
  const changed = new Set<string>()
  let duplicateValidRows = 0
  let receivedValidRows = 0

  return {
    addPage(products: readonly NormalizedProduct[]): PageAddResult {
      let newIds = 0
      let duplicateIds = 0
      let changedIds = 0
      let droppedByLimit = 0

      for (const product of products) {
        receivedValidRows += 1
        const existing = byId.get(product.productId)

        if (existing === undefined) {
          if (byId.size >= maxProducts) {
            droppedByLimit += 1
            continue
          }
          byId.set(product.productId, product)
          order.push(product.productId)
          newIds += 1
          continue
        }

        duplicateIds += 1
        duplicateValidRows += 1
        if (productFingerprint(existing) !== productFingerprint(product)) {
          byId.set(product.productId, product)
          changed.add(product.productId)
          changedIds += 1
        }
      }

      return {
        newIds,
        duplicateIds,
        changedIds,
        acceptedIds: newIds,
        droppedByLimit,
        limitReached: droppedByLimit > 0 || byId.size >= maxProducts,
      }
    },

    get uniqueValidProducts(): number {
      return byId.size
    },
    get duplicateValidRows(): number {
      return duplicateValidRows
    },
    get receivedValidRows(): number {
      return receivedValidRows
    },
    get changedWithinRun(): boolean {
      return changed.size > 0
    },
    productIds(): string[] {
      return [...order]
    },
    changedProductIds(): string[] {
      return [...changed]
    },
    snapshot(): NormalizedProduct[] {
      return order.map((id) => byId.get(id)).filter((p): p is NormalizedProduct => p !== undefined)
    },
  }
}
