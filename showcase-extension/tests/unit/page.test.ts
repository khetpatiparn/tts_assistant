import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { validatePage } from '../../extension/src/domain/page.js'
import type { NormalizeContext } from '../../extension/src/domain/product.js'
import type { ShowcaseRawPage } from '../../extension/src/adapters/types.js'

const read = (name: string): string => readFileSync(`tests/fixtures/synthetic/${name}`, 'utf8')

const CTX: NormalizeContext = {
  sourceRef: 'local-profile-01',
  sourceIdentityVerified: false,
  observedAt: '2026-09-19T10:00:00Z',
}

const page = (bodyText: string, extra?: Partial<ShowcaseRawPage>): ShowcaseRawPage => ({
  httpStatus: 200,
  headers: { 'content-type': 'application/json' },
  bodyText,
  ...extra,
})

describe('UT10 — แถวเสียแทรกในหน้าที่ดี (R06)', () => {
  const result = validatePage(page(read('fx07-optional-and-price.json')), CTX)

  it('แถวที่ใช้ได้ยังอยู่ครบ ไม่หายไปเพราะเพื่อนบ้านเสีย', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.products).toHaveLength(6)
    expect(result.products.map((p) => p.productId)).toEqual([
      '9100000000000000001',
      '9100000000000000002',
      '9100000000000000003',
      '9100000000000000004',
      '9100000000000000005',
      '9100000000000000006',
    ])
  })

  it('counters ตรงตามสมการ §9.5 ของระดับหน้า', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    const { receivedRows, invalidRows, validRows } = result.counters
    expect(receivedRows).toBe(9)
    expect(invalidRows).toBe(3)
    expect(validRows).toBe(6)
    expect(invalidRows + validRows).toBe(receivedRows)
  })

  it('แถวที่ถูก quarantine ยังถูกเก็บไว้ให้ตรวจ พร้อมตำแหน่งดิบในหน้า', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.quarantined.map((q) => q.index)).toEqual([6, 7, 8])
    expect(result.quarantined[0]?.reasons).toContain('product_id_invalid')
  })

  it('offset ต้องเลื่อนตามจำนวนแถวดิบ ไม่ใช่จำนวนแถวที่ใช้ได้ (PG04 groundwork)', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.counters.receivedRows).toBe(9)
    expect(result.counters.receivedRows).not.toBe(result.products.length)
  })
})

describe('V10 — field ที่ไม่รู้จักเข้า inventory แต่ไม่ถูก export', () => {
  const result = validatePage(page(read('fx10-hostile.json')), CTX)

  it('บันทึกเฉพาะ "ชื่อ" field ที่ไม่รู้จัก ไม่บันทึกค่า', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.schemaInventory).toContain('seller')
  })

  it('field ที่รู้จักอยู่แล้วไม่ถูกรายงานเป็นของใหม่', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    for (const known of ['product_id', 'title', 'price', 'stock', 'stock_status', 'review_status']) {
      expect(result.schemaInventory).not.toContain(known)
    }
  })

  it('inventory มีขอบเขต ไม่โตตามข้อมูลที่ฝั่งตรงข้ามส่งมา', () => {
    const many = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`unknown_field_${String(i)}`, i]),
    )
    const body = JSON.stringify({
      code: 0,
      message: 'success',
      data: { products: [{ product_id: '1', title: 'x', ...many }] },
    })
    const r = validatePage(page(body), CTX)
    if (r.outcome !== 'ok') throw new Error(r.outcome)
    expect(r.schemaInventory.length).toBeLessThanOrEqual(64)
  })
})

describe('UT12 — secret canaries ต้องไม่หลุดออกจากขอบเขตนี้ (R11)', () => {
  const CANARIES = [
    'CANARY_SESSION_7e44a0',
    'CANARY_BEARER_be31f9',
    'CANARY_TOKEN_2f8a1c',
    'CANARY_SIG_91bd',
    'CANARY_COOKIE_aa11bb',
    'CANARY_ERRMSG_cc22dd',
  ]

  it('canary ใน nested body ไม่ปรากฏในผลลัพธ์ทั้งก้อน', () => {
    const result = validatePage(page(read('fx10-hostile.json')), CTX)
    const serialized = JSON.stringify(result)
    for (const canary of CANARIES) expect(serialized, canary).not.toContain(canary)
  })

  it('canary ใน header ไม่ปรากฏในผลลัพธ์', () => {
    const result = validatePage(
      page(read('fx01-first-page.json'), {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'sessionid=CANARY_COOKIE_aa11bb; HttpOnly',
          authorization: 'Bearer CANARY_BEARER_be31f9',
        },
      }),
      CTX,
    )
    const serialized = JSON.stringify(result)
    for (const canary of CANARIES) expect(serialized, canary).not.toContain(canary)
  })

  it('canary ใน business error message ไม่ปรากฏในผลลัพธ์', () => {
    const body = JSON.stringify({ code: 10002, message: 'denied CANARY_ERRMSG_cc22dd', data: null })
    const result = validatePage(page(body), CTX)
    expect(result.outcome).toBe('business_error')
    const serialized = JSON.stringify(result)
    for (const canary of CANARIES) expect(serialized, canary).not.toContain(canary)
  })

  it('ผลลัพธ์ไม่พก bodyText ดิบหรือ headers ติดไปด้วย', () => {
    const result = validatePage(page(read('fx01-first-page.json')), CTX)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('bodyText')
    expect(serialized).not.toContain('headers')
    expect(serialized).not.toContain('content-type')
  })
})

describe('การส่งต่อผลของ envelope', () => {
  it('หน้าที่ schema เปลี่ยนไม่ถูกรายงานเป็นหน้าว่าง', () => {
    const result = validatePage(page(read('fx09-schema-drift.json')), CTX)
    expect(result.outcome).toBe('schema_changed')
    expect(result).not.toHaveProperty('products')
  })

  it('หน้าว่างที่ envelope ถูกต้องให้ counters เป็นศูนย์ทั้งหมด', () => {
    const result = validatePage(page(read('fx03-empty-page.json')), CTX)
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.counters).toEqual({ receivedRows: 0, invalidRows: 0, validRows: 0 })
    expect(result.products).toEqual([])
  })

  it('warning ถูกนับรวมเป็นสรุปของหน้า', () => {
    const result = validatePage(page(read('fx06-statuses.json')), CTX)
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.warningTally['status_semantics_unverified']).toBe(6)
    expect(result.warningTally['can_add_false_conflicts']).toBe(1)
  })
})
