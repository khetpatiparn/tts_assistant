import { describe, it, expect } from 'vitest'
import {
  createProductAccumulator,
  decideAdvance,
  readPaginationMetadata,
} from '../../extension/src/core/pagination.js'
import { validatePage } from '../../extension/src/domain/page.js'
import type { NormalizeContext } from '../../extension/src/domain/product.js'
import {
  catalogId,
  createCatalogServer,
  expectedIds,
  overlappingPage,
} from '../helpers/synthetic-catalog.js'

const CTX: NormalizeContext = {
  sourceRef: 'local-profile-01',
  sourceIdentityVerified: false,
  observedAt: '2026-09-19T10:00:00Z',
}

const productsOf = (bodyText: string) => {
  const result = validatePage(
    { httpStatus: 200, headers: { 'content-type': 'application/json' }, bodyText },
    CTX,
  )
  if (result.outcome !== 'ok') throw new Error(result.outcome)
  return result
}

/** เดินทั้ง run บน catalog สังเคราะห์ ใช้กฎ advance จริงของระบบ */
const scan = (total: number, requestedCount: number, serverCap?: number) => {
  const server = createCatalogServer(
    serverCap === undefined ? { total } : { total, serverCap },
  )
  const acc = createProductAccumulator()
  let offset = 0
  let dataPages = 0
  let ended = false

  for (let guard = 0; guard < 500 && !ended; guard += 1) {
    const page = productsOf(server.page(offset, requestedCount))
    if (page.counters.receivedRows > 0) dataPages += 1
    acc.addPage(page.products)

    const decision = decideAdvance({
      currentOffset: offset,
      rawRowCount: page.counters.receivedRows,
      metadata: null,
    })
    if (decision.kind === 'endpoint_end') ended = true
    else if (decision.kind === 'continue') offset = decision.nextOffset
    else throw new Error(`unexpected ${decision.kind}`)
  }

  return { server, acc, dataPages, offsets: server.requestLog.map((r) => r.offset) }
}

describe('PG01 — 198 รายการ count=6 ไม่มี end metadata (R04)', () => {
  const run = scan(198, 6)

  it('offsets เดินทีละ 6 จนถึง 198', () => {
    expect(run.offsets[0]).toBe(0)
    expect(run.offsets[1]).toBe(6)
    expect(run.offsets.at(-2)).toBe(192)
    expect(run.offsets.at(-1)).toBe(198)
  })

  it('มี 33 หน้าที่มีข้อมูล และอีก 1 request ที่ได้หน้าว่าง', () => {
    expect(run.dataPages).toBe(33)
    expect(run.server.requestLog).toHaveLength(34)
  })

  it('ได้ ID ครบ 198 ตัวตรงกับที่คาดไว้ทุกตัว', () => {
    expect(run.acc.uniqueValidProducts).toBe(198)
    expect(run.acc.productIds()).toEqual(expectedIds(198))
  })
})

describe('PG18 — data.total ตัดจบได้โดยไม่ต้องรอ request หน้าว่าง (ไม่อยู่ในสเปกเดิม, เพิ่มหลัง G0 evidence)', () => {
  /**
   * ต่างจาก PG01 ตรงที่หน้านี้ส่ง data.total มาด้วยทุกหน้า (ตามที่สังเกตได้จริงจากของจริง)
   * decideAdvance ควรจบทันทีที่ offset+rawRowCount ถึง total โดยไม่ต้องยิง request เพิ่มเพื่อยืนยัน
   * ด้วยหน้าว่าง — ประหยัดไป 1 request เทียบกับ PG01 ที่ metadata เป็น null
   */
  const server = createCatalogServer({ total: 198, metadata: 'total' })
  const acc = createProductAccumulator()
  let offset = 0
  let ended = false

  for (let guard = 0; guard < 500 && !ended; guard += 1) {
    const bodyText = server.page(offset, 6)
    const page = productsOf(bodyText)
    acc.addPage(page.products)

    const parsed = JSON.parse(bodyText) as { data: unknown }
    const metadata = readPaginationMetadata(parsed.data)
    const decision = decideAdvance({ currentOffset: offset, rawRowCount: page.counters.receivedRows, metadata })
    if (decision.kind === 'endpoint_end') ended = true
    else if (decision.kind === 'continue') offset = decision.nextOffset
    else throw new Error(`unexpected ${decision.kind}`)
  }

  it('จบที่ request ที่ 33 (หน้าสุดท้ายที่มีข้อมูล) ไม่ใช่ 34 — ไม่มี request หน้าว่างเพิ่ม', () => {
    expect(server.requestLog).toHaveLength(33)
    expect(server.requestLog.at(-1)).toEqual({ offset: 192, count: 6 })
  })

  it('ยังได้ ID ครบ 198 ตัวเหมือนเดิมทุกตัว ไม่ตกหล่นจากการจบเร็วขึ้น', () => {
    expect(acc.uniqueValidProducts).toBe(198)
    expect(acc.productIds()).toEqual(expectedIds(198))
  })

  it('การใช้ total ไม่ทำให้ next_offset ของ upstream ถูกไว้ใจไปด้วย — ยัง gate ด้วย G0_VERIFIED เหมือนเดิม', () => {
    // ป้อน currentOffset ที่ total ยังไปไม่ถึง พร้อม next_offset ปลอม ๆ — ต้องไม่เดินตาม next_offset
    const decision = decideAdvance({
      currentOffset: 0,
      rawRowCount: 6,
      metadata: { hasMore: null, nextOffset: 999, total: 198 },
    })
    expect(decision).toEqual({ kind: 'continue', nextOffset: 6 })
  })
})

describe('PG02 — 198 รายการ count=50 (R04)', () => {
  const run = scan(198, 50)

  it('offsets เป็น 0, 50, 100, 150, 198', () => {
    expect(run.offsets).toEqual([0, 50, 100, 150, 198])
  })

  it('มี 4 หน้าที่มีข้อมูล และอีก 1 request ที่ได้หน้าว่าง', () => {
    expect(run.dataPages).toBe(4)
    expect(run.server.requestLog).toHaveLength(5)
  })

  it('ID set ตรง 100%', () => {
    expect(run.acc.productIds()).toEqual(expectedIds(198))
  })
})

describe('PG03 — ขอ 50 แต่ server คืน 6 (R04)', () => {
  const run = scan(18, 50, 6)

  it('offset เดินตามจำนวนที่ได้รับจริง ไม่ใช่จำนวนที่ขอ', () => {
    expect(run.offsets).toEqual([0, 6, 12, 18])
  })

  it('ไม่มีสินค้าถูกข้าม', () => {
    expect(run.acc.productIds()).toEqual(expectedIds(18))
  })
})

describe('PG04 — offset เดินตามแถวดิบ ไม่ใช่แถวที่ใช้ได้ (R04)', () => {
  it('หน้าที่มี 6 แถวดิบแต่ valid แค่ 2 ยังต้องเดิน offset 6', () => {
    const body = JSON.stringify({
      code: 0,
      message: 'success',
      data: {
        products: [
          { product_id: catalogId(0), title: 'ดี 1', format_available_price: '฿1.00' },
          { product_id: '', title: 'ID ว่าง', format_available_price: '฿1.00' },
          { product_id: catalogId(2), title: '   ', format_available_price: '฿1.00' },
          { product_id: 'abc', title: 'ID ไม่ใช่เลข', format_available_price: '฿1.00' },
          { product_id: catalogId(4), title: 'ดี 2', format_available_price: '฿1.00' },
          null,
        ],
      },
    })
    const page = productsOf(body)
    expect(page.counters.receivedRows).toBe(6)
    expect(page.counters.validRows).toBe(2)

    const decision = decideAdvance({ currentOffset: 0, rawRowCount: 6, metadata: null })
    expect(decision).toEqual({ kind: 'continue', nextOffset: 6 })
  })
})

describe('PG05 — หน้าที่ ID คาบเกี่ยวกัน (R05)', () => {
  const acc = createProductAccumulator()

  it('dedup ถูกต้องและแยกนับ raw กับ unique', () => {
    const first = acc.addPage(productsOf(overlappingPage(0, 6)).products)
    expect(first.newIds).toBe(6)
    expect(first.duplicateIds).toBe(0)

    // หน้าถัดไปเริ่มที่ index 4 จึงซ้ำกับหน้าแรก 2 ตัว
    const second = acc.addPage(productsOf(overlappingPage(4, 6)).products)
    expect(second.newIds).toBe(4)
    expect(second.duplicateIds).toBe(2)

    expect(acc.uniqueValidProducts).toBe(10)
    expect(acc.duplicateValidRows).toBe(2)
    expect(acc.receivedValidRows).toBe(12)
  })

  it('สมการ counters ของ §9.5 เป็นจริง', () => {
    expect(acc.receivedValidRows).toBe(acc.duplicateValidRows + acc.uniqueValidProducts)
  })

  it('หน้าที่ซ้ำทั้งหน้าไม่เพิ่ม unique เลย', () => {
    const fresh = createProductAccumulator()
    fresh.addPage(productsOf(overlappingPage(0, 6)).products)
    const repeat = fresh.addPage(productsOf(overlappingPage(0, 6)).products)
    expect(repeat.newIds).toBe(0)
    expect(fresh.uniqueValidProducts).toBe(6)
  })
})

describe('PG06 — server คืนหน้าเดิมตลอด (R05)', () => {
  it('ตรวจได้ว่าไม่มี ID ใหม่ เพื่อให้ runner หยุดแทนที่จะวนไม่จบ', () => {
    const acc = createProductAccumulator()
    acc.addPage(productsOf(overlappingPage(0, 6)).products)
    for (let i = 0; i < 5; i += 1) {
      const result = acc.addPage(productsOf(overlappingPage(0, 6)).products)
      expect(result.newIds).toBe(0)
      expect(result.duplicateIds).toBe(6)
    }
    expect(acc.uniqueValidProducts).toBe(6)
  })
})

describe('PG07 — หน้าสั้นแต่ยังมีต่อ (R05)', () => {
  it('หน้าที่สั้นกว่า count ที่ขอ ไม่ใช่เหตุผลให้หยุด', () => {
    const decision = decideAdvance({ currentOffset: 0, rawRowCount: 3, metadata: null })
    expect(decision).toEqual({ kind: 'continue', nextOffset: 3 })
  })

  it('หยุดเมื่อได้หน้าว่างจริงเท่านั้น', () => {
    const decision = decideAdvance({ currentOffset: 18, rawRowCount: 0, metadata: null })
    expect(decision).toEqual({ kind: 'endpoint_end' })
  })

  it('has_more=true พร้อมหน้าสั้นก็ยังเดินต่อ', () => {
    const decision = decideAdvance({
      currentOffset: 0,
      rawRowCount: 3,
      metadata: { hasMore: true, nextOffset: null, total: null },
    })
    expect(decision).toEqual({ kind: 'continue', nextOffset: 3 })
  })
})

describe('PG14 — metadata ขัดแย้งกัน (R05)', () => {
  it('has_more=true แต่หน้าว่าง เป็นความขัดแย้ง ไม่ใช่ endpoint-end', () => {
    const decision = decideAdvance({
      currentOffset: 18,
      rawRowCount: 0,
      metadata: { hasMore: true, nextOffset: null, total: null },
    })
    expect(decision).toEqual({ kind: 'conflict', reason: 'empty_page_but_has_more' })
  })

  it('next_offset ที่ถอยหลังหรือไม่ขยับเป็นความขัดแย้ง', () => {
    for (const nextOffset of [0, 6, -1]) {
      const decision = decideAdvance({
        currentOffset: 6,
        rawRowCount: 6,
        metadata: { hasMore: true, nextOffset, total: null },
      })
      expect(decision.kind, String(nextOffset)).toBe('conflict')
    }
  })

  it('has_more=false ที่หน้ามีข้อมูลยังถือเป็น endpoint-end ได้', () => {
    const decision = decideAdvance({
      currentOffset: 0,
      rawRowCount: 6,
      metadata: { hasMore: false, nextOffset: null, total: null },
    })
    expect(decision).toEqual({ kind: 'endpoint_end' })
  })
})

describe('G0 gate — next_offset ของ upstream ยังไม่ถูกใช้ตัดสินใจ', () => {
  it('ใช้ offset += rawRowCount เสมอ เพราะ M0 ยังไม่ยืนยัน contract', () => {
    const decision = decideAdvance({
      currentOffset: 0,
      rawRowCount: 6,
      metadata: { hasMore: true, nextOffset: 999, total: null },
    })
    expect(decision).toEqual({ kind: 'continue', nextOffset: 6 })
  })
})

describe('readPaginationMetadata — อ่านแบบไม่เดา', () => {
  it('ไม่มี field เลยคืน null ทุกช่อง ไม่ใช่ค่าเริ่มต้นที่แต่งขึ้น', () => {
    expect(readPaginationMetadata({ products: [] })).toEqual({
      hasMore: null,
      nextOffset: null,
      total: null,
    })
  })

  it('อ่าน has_more/next_offset/total เมื่อชนิดถูกต้องเท่านั้น', () => {
    expect(readPaginationMetadata({ has_more: true, next_offset: 12, total: 198 })).toEqual({
      hasMore: true,
      nextOffset: 12,
      total: 198,
    })
    expect(readPaginationMetadata({ has_more: 'yes', next_offset: '12', total: 1.5 })).toEqual({
      hasMore: null,
      nextOffset: null,
      total: null,
    })
  })
})

describe('PG17 — ID เดิมมาสองหน้าแต่ข้อมูลต่างกัน (R07)', () => {
  const rowsWithPrice = (price: string) =>
    productsOf(
      JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          products: [{ product_id: catalogId(0), title: 'สินค้าเดียวกัน', format_available_price: price }],
        },
      }),
    ).products

  it('ใช้ข้อมูล valid ที่พบล่าสุด และไม่เพิ่ม unique count', () => {
    const acc = createProductAccumulator()
    acc.addPage(rowsWithPrice('฿100.00'))
    const second = acc.addPage(rowsWithPrice('฿120.00'))

    expect(second.newIds).toBe(0)
    expect(second.changedIds).toBe(1)
    expect(acc.uniqueValidProducts).toBe(1)
    expect(acc.productIds()).toEqual([catalogId(0)])
    expect(acc.snapshot()[0]?.priceDisplay).toBe('฿120.00')
  })

  it('บันทึก changedWithinRun และ quality warning', () => {
    const acc = createProductAccumulator()
    acc.addPage(rowsWithPrice('฿100.00'))
    acc.addPage(rowsWithPrice('฿120.00'))
    expect(acc.changedWithinRun).toBe(true)
    expect(acc.changedProductIds()).toEqual([catalogId(0)])
  })

  it('ข้อมูลที่เหมือนเดิมทุกประการไม่นับว่าเปลี่ยน', () => {
    const acc = createProductAccumulator()
    acc.addPage(rowsWithPrice('฿100.00'))
    const second = acc.addPage(rowsWithPrice('฿100.00'))
    expect(second.changedIds).toBe(0)
    expect(acc.changedWithinRun).toBe(false)
  })

  it('แถว invalid ของ ID เดิมไม่ทับข้อมูลดีที่มีอยู่ — ถูก quarantine ไปแล้วตั้งแต่ชั้น page', () => {
    const acc = createProductAccumulator()
    acc.addPage(rowsWithPrice('฿100.00'))

    const pageWithInvalid = productsOf(
      JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          products: [{ product_id: catalogId(0), title: '   ', format_available_price: '฿999.00' }],
        },
      }),
    )
    expect(pageWithInvalid.counters.invalidRows).toBe(1)
    acc.addPage(pageWithInvalid.products)

    expect(acc.uniqueValidProducts).toBe(1)
    expect(acc.snapshot()[0]?.priceDisplay).toBe('฿100.00')
    expect(acc.changedWithinRun).toBe(false)
  })
})

describe('V13 — เพดานจำนวนสินค้าต่อ run', () => {
  it('รายงานเมื่อถึงเพดาน โดยไม่ตัดข้อมูลเงียบ ๆ', () => {
    const acc = createProductAccumulator({ maxProducts: 10 })
    const result = acc.addPage(productsOf(overlappingPage(0, 6)).products)
    expect(result.limitReached).toBe(false)

    const second = acc.addPage(productsOf(overlappingPage(6, 6)).products)
    expect(second.limitReached).toBe(true)
    expect(second.acceptedIds).toBe(4)
    expect(second.droppedByLimit).toBe(2)
    expect(acc.uniqueValidProducts).toBe(10)
  })
})
