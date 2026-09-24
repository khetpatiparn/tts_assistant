import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateEnvelope } from '../../extension/src/domain/envelope.js'
import { normalizeProduct } from '../../extension/src/domain/product.js'
import type { NormalizeContext, RowResult } from '../../extension/src/domain/product.js'
import type { ShowcaseRawPage } from '../../extension/src/adapters/types.js'

const read = (name: string): string => readFileSync(`tests/fixtures/synthetic/${name}`, 'utf8')

const CTX: NormalizeContext = {
  sourceRef: 'local-profile-01',
  sourceIdentityVerified: false,
  observedAt: '2026-09-19T10:00:00Z',
}

const rowsOf = (fixture: string): readonly unknown[] => {
  const page: ShowcaseRawPage = {
    httpStatus: 200,
    headers: { 'content-type': 'application/json' },
    bodyText: read(fixture),
  }
  const env = validateEnvelope(page)
  if (env.outcome !== 'ok') throw new Error(`fixture ${fixture} ไม่ใช่ envelope ที่ถูกต้อง`)
  return env.rows
}

const normalizeAll = (fixture: string): RowResult[] =>
  rowsOf(fixture).map((row) => normalizeProduct(row, CTX))

const accepted = (r: RowResult) => {
  if (r.status !== 'accepted') throw new Error(`คาดว่าแถวจะผ่าน แต่ได้ ${r.status}`)
  return r.product
}

describe('UT01 — ID precision (V02/V03/R06)', () => {
  it('ID string 19 หลักออกมาตรงทุกหลัก', () => {
    const products = normalizeAll('fx01-first-page.json').map(accepted)
    expect(products[0]?.productId).toBe('1736749159048840633')
    expect(products.map((p) => p.productId)).toEqual([
      '1736749159048840633',
      '1736749159048840634',
      '1736749159048840635',
      '1736749159048840636',
      '1736749159048840637',
      '1736749159048840638',
    ])
  })

  it('ID ที่มาเป็นตัวเลขไม่ใส่ quotes ก็ต้องไม่สูญเสียหลัก', () => {
    const results = normalizeAll('fx12-large-ids.json')
    expect(results.map((r) => (r.status === 'accepted' ? r.product.productId : r.status))).toEqual([
      '1736749159048840633',
      '1736749159048840633',
      '9007199254740993',
      '4242',
    ])
  })

  it('productId เป็น string เสมอ ไม่ใช่ number', () => {
    for (const p of normalizeAll('fx12-large-ids.json').map(accepted)) {
      expect(typeof p.productId).toBe('string')
    }
  })
})

describe('V02/V04 — quarantine แถวที่ ID หรือ title ใช้ไม่ได้', () => {
  const results = normalizeAll('fx07-optional-and-price.json')

  it('product_id ว่าง, ไม่ใช่เลขฐานสิบ และ title ว่างหลัง trim ถูก quarantine', () => {
    expect(results[6]?.status).toBe('quarantined')
    expect(results[7]?.status).toBe('quarantined')
    expect(results[8]?.status).toBe('quarantined')
  })

  it('quarantine บอกเหตุผลเป็นรหัส และไม่เดา ID ให้', () => {
    const emptyId = results[6]
    const blankTitle = results[7]
    const nonDecimalId = results[8]
    if (
      emptyId?.status !== 'quarantined' ||
      blankTitle?.status !== 'quarantined' ||
      nonDecimalId?.status !== 'quarantined'
    ) {
      throw new Error('ไม่ได้ quarantine')
    }
    expect(emptyId.reasons).toContain('product_id_invalid')
    expect(blankTitle.reasons).toContain('title_invalid')
    expect(nonDecimalId.reasons).toContain('product_id_invalid')
    expect(JSON.stringify(emptyId)).not.toContain('"productId"')
  })

  it('title ยาวเกิน 2,000 ตัวอักษรถูก quarantine', () => {
    const row = { product_id: '9300000000000000001', title: 'ก'.repeat(2001), format_available_price: '฿1.00' }
    const result = normalizeProduct(row, CTX)
    expect(result.status).toBe('quarantined')
  })

  it('product_id ยาวเกิน 128 ตัวอักษรถูก quarantine', () => {
    const row = { product_id: '1'.repeat(129), title: 'ปกติ', format_available_price: '฿1.00' }
    expect(normalizeProduct(row, CTX).status).toBe('quarantined')
  })

  it('แถวที่ไม่ใช่ object ถูก quarantine ไม่ทำให้ทั้งหน้าพัง', () => {
    for (const bad of [null, 42, 'x', []]) {
      expect(normalizeProduct(bad, CTX).status).toBe('quarantined')
    }
  })

  it('product_id ที่ไม่ใช่ string/LossyNumber/number เลย (เช่น boolean) ถูก quarantine', () => {
    const row = { product_id: true, title: 'ปกติ', format_available_price: '฿1.00' }
    const result = normalizeProduct(row, CTX)
    expect(result.status).toBe('quarantined')
    if (result.status !== 'quarantined') return
    expect(result.reasons).toContain('product_id_invalid')
  })

  it('product_id เป็น number ที่ไม่ใช่ safe integer (เช่นเลขทศนิยม) ถูก quarantine ไม่ปัดค่าให้', () => {
    const row = { product_id: 1.5, title: 'ปกติ', format_available_price: '฿1.00' }
    const result = normalizeProduct(row, CTX)
    expect(result.status).toBe('quarantined')
    if (result.status !== 'quarantined') return
    expect(result.reasons).toContain('product_id_invalid')
  })

  it('title ที่ไม่ใช่ string เลย (เช่น number หรือ null) ถูก quarantine เป็น title_invalid', () => {
    for (const title of [12345, null]) {
      const row = { product_id: '9600000000000000001', title, format_available_price: '฿1.00' }
      const result = normalizeProduct(row, CTX)
      expect(result.status, String(title)).toBe('quarantined')
      if (result.status !== 'quarantined') continue
      expect(result.reasons, String(title)).toContain('title_invalid')
    }
  })
})

describe('UT07 — stock: 0 ต่างจากไม่ทราบ (V05/R07)', () => {
  const products = normalizeAll('fx06-statuses.json').map(accepted)

  it('stock=0 เก็บเป็น 0 ไม่ใช่ null', () => {
    expect(products[4]?.stockQuantity).toBe(0)
  })

  it('stock=null เก็บเป็น null ไม่ใช่ 0', () => {
    expect(products[5]?.stockQuantity).toBeNull()
  })

  it('stock ที่ผิดกฎกลายเป็น null พร้อม warning ไม่ตัดสินค้าทิ้ง', () => {
    const results = normalizeAll('fx07-optional-and-price.json')
    const negative = accepted(results[4] as RowResult)
    const text = accepted(results[5] as RowResult)
    expect(negative.stockQuantity).toBeNull()
    expect(negative.validationWarnings).toContain('stock_invalid')
    expect(text.stockQuantity).toBeNull()
    expect(text.validationWarnings).toContain('stock_invalid')
  })
})

describe('UT05/V09 — optional fields ที่หายไปต้องเป็น null ไม่ใช่ 0 หรือข้อความเดา', () => {
  const products = normalizeAll('fx07-optional-and-price.json').map((r) =>
    r.status === 'accepted' ? r.product : null,
  )

  it('image/shop/commission ที่หายไปเป็น null/array ว่างทั้งหมด', () => {
    const p = products[2]
    expect(p?.imageUrls).toEqual([])
    expect(p?.shopName).toBeNull()
    expect(p?.commissionRate).toBeNull()
  })

  it('field ที่ส่งมาเป็น null ก็ยังเป็น null/array ว่าง ไม่กลายเป็น 0', () => {
    const p = products[3]
    expect(p?.imageUrls).toEqual([])
    expect(p?.shopName).toBeNull()
    expect(p?.commissionRate).toBeNull()
    expect(p?.commissionRate).not.toBe(0)
  })
})

describe('UT08/V07 — ราคา', () => {
  const products = normalizeAll('fx07-optional-and-price.json').map((r) =>
    r.status === 'accepted' ? r.product : null,
  )

  it('priceDisplay คงข้อความเดิมไว้ทุกตัวอักษร', () => {
    expect(products[0]?.priceDisplay).toBe('฿1,299.00')
    expect(products[1]?.priceDisplay).toBe('฿99.00 - ฿249.00')
  })

  it('ยังไม่แปลงเป็น decimal เพราะ G0 ยังไม่ยืนยันรูปแบบราคา/สกุลเงิน', () => {
    expect(products[0]?.priceAmountDecimal).toBeNull()
    expect(products[0]?.currency).toBeNull()
    expect(products[0]?.validationWarnings).toContain('price_amount_unverified')
  })

  it('ช่วงราคาได้ warning แยกต่างหาก', () => {
    expect(products[1]?.validationWarnings).toContain('price_is_range')
  })
})

describe('UT06/UT11 — สถานะและ eligibility (V06/R07, §8.3)', () => {
  const products = normalizeAll('fx06-statuses.json').map(accepted)

  it('เก็บ enum ดิบไว้ทุกค่า ไม่คัดทิ้ง', () => {
    expect(products.map((p) => p.stockStatusRaw)).toEqual([1, 77, 1, 1, 1, 1])
    expect(products.map((p) => p.reviewStatusRaw)).toEqual([1, 1, null, 1, 1, 1])
  })

  it('ค่า enum ที่ไม่เคยพบและ field ที่หายไปไม่ทำให้แถวหาย', () => {
    expect(products).toHaveLength(6)
    expect(products[1]?.stockStatusRaw).toBe(77)
    expect(products[2]?.reviewStatusRaw).toBeNull()
  })

  it('G0 ยังไม่ผ่าน จึงยังไม่มี enum ใดถูกยืนยัน — eligibility ต้องเป็น unknown ทั้งหมด', () => {
    expect(products.map((p) => p.eligibility)).toEqual(Array<string>(6).fill('unknown'))
    for (const p of products) {
      expect(p.validationWarnings).toContain('status_semantics_unverified')
    }
  })

  it('UT11 — can_added=false ได้ warning และไม่ถูกยกระดับเป็น candidate', () => {
    const p = products[3]
    expect(p?.canAddRaw).toBe(false)
    expect(p?.eligibility).toBe('unknown')
    expect(p?.validationWarnings).toContain('can_add_false_conflicts')
  })

  it('can_added=true ไม่ลบล้างสถานะอื่นให้กลายเป็น candidate', () => {
    expect(products[1]?.canAddRaw).toBe(true)
    expect(products[1]?.eligibility).toBe('unknown')
  })

  it('canAddRaw ที่ไม่มีใน response เป็น null ไม่ใช่ false', () => {
    const p = normalizeProduct(
      { product_id: '9400000000000000001', title: 'ไม่มี can_added', format_available_price: '฿1.00' },
      CTX,
    )
    expect(accepted(p).canAddRaw).toBeNull()
  })

  it('eligibilityBasis ระบุเวอร์ชันกฎที่ใช้ตัดสิน', () => {
    expect(products[0]?.eligibilityBasis).toBe('adapter-rule-v1-unverified')
  })
})

describe('categoryLabel / hasStatusPopup (docs/api-observations.md §2, §2.3)', () => {
  it('category_info.name ถูกอ่านเข้า categoryLabel', () => {
    const p = normalizeProduct(
      {
        product_id: '9400000000000000002',
        title: 'มีหมวดหมู่',
        format_available_price: '฿1.00',
        category_info: { name: 'เครื่องครัว' },
      },
      CTX,
    )
    expect(accepted(p).categoryLabel).toBe('เครื่องครัว')
  })

  it('ไม่มี category_info เลย -> categoryLabel เป็น null ไม่ใช่ข้อความว่าง', () => {
    const p = normalizeProduct(
      { product_id: '9400000000000000003', title: 'ไม่มีหมวดหมู่', format_available_price: '฿1.00' },
      CTX,
    )
    expect(accepted(p).categoryLabel).toBeNull()
  })

  it('มี status_popup -> hasStatusPopup true ไม่ว่า reason_code จะเป็นอะไร', () => {
    const p = normalizeProduct(
      {
        product_id: '9400000000000000004',
        title: 'สินค้าที่ผู้ขายลบไปแล้ว',
        format_available_price: '฿1.00',
        status_popup: { title: 'Product not available', content: '', button: '', reason_code: 11 },
      },
      CTX,
    )
    expect(accepted(p).hasStatusPopup).toBe(true)
  })

  it('ไม่มี status_popup -> hasStatusPopup false', () => {
    const p = normalizeProduct(
      { product_id: '9400000000000000005', title: 'สินค้าปกติ', format_available_price: '฿1.00' },
      CTX,
    )
    expect(accepted(p).hasStatusPopup).toBe(false)
  })
})

describe('V08 — URL ต้องปลอดภัยและอยู่ใน allowlist', () => {
  const products = normalizeAll('fx10-hostile.json').map(accepted)

  it('javascript:, data: และ http: ถูกปฏิเสธเป็น array ว่าง พร้อม warning', () => {
    for (const index of [2, 3, 4]) {
      expect(products[index]?.imageUrls, String(index)).toEqual([])
      expect(products[index]?.validationWarnings, String(index)).toContain('image_url_rejected')
    }
  })

  it('URL https ที่ host ยังไม่อยู่ใน allowlist ก็เป็น array ว่าง — allowlist จดเฉพาะ host ที่เคยเห็นจริง', () => {
    expect(products[5]?.imageUrls).toEqual([])
  })

  it('รูปที่ไม่ใช่ string เลย, เป็น string ว่าง, หรือ parse ด้วย new URL() ไม่ได้ ถูกปฏิเสธพร้อม warning เหมือนกัน', () => {
    for (const image of [12345, '', 'not a url']) {
      const row = {
        product_id: '9700000000000000001',
        title: 'ปกติ',
        format_available_price: '฿1.00',
        cover: { url_list: [image] },
      }
      const result = normalizeProduct(row, CTX)
      expect(result.status, String(image)).toBe('accepted')
      if (result.status !== 'accepted') continue
      expect(result.product.imageUrls, String(image)).toEqual([])
      expect(result.product.validationWarnings, String(image)).toContain('image_url_rejected')
    }
  })

  it('token ใน URL ไม่หลุดออกมาใน normalized product', () => {
    const serialized = JSON.stringify(products)
    for (const canary of ['CANARY_TOKEN_2f8a1c', 'CANARY_SIG_91bd']) {
      expect(serialized).not.toContain(canary)
    }
  })
})

describe('imageUrls — ดึงหลายรูปจาก images[] (observed 2026-09-20 §10)', () => {
  const APPROVED = 'p16-oec-sg.ibyteimg.com'
  const baseRow = (extra: Record<string, unknown>): Record<string, unknown> => ({
    product_id: '9800000000000000001',
    title: 'สินค้าทดสอบรูป',
    format_available_price: '฿1.00',
    ...extra,
  })

  const normalizeOne = (extra: Record<string, unknown>) => {
    const result = normalizeProduct(baseRow(extra), CTX)
    if (result.status !== 'accepted') throw new Error(result.status)
    return result.product
  }

  it('images[] หลายรูปที่ผ่าน allowlist ถูกเก็บครบทุกรูป ไม่ใช่แค่รูปแรก', () => {
    const product = normalizeOne({
      images: [
        { url_list: [`https://${APPROVED}/a.jpeg`] },
        { url_list: [`https://${APPROVED}/b.jpeg`] },
        { url_list: [`https://${APPROVED}/c.jpeg`] },
      ],
    })
    expect(product.imageUrls).toEqual([
      `https://${APPROVED}/a.jpeg`,
      `https://${APPROVED}/b.jpeg`,
      `https://${APPROVED}/c.jpeg`,
    ])
  })

  it('images[] ที่มีทั้งรูปผ่านและไม่ผ่าน allowlist — เก็บเฉพาะที่ผ่าน พร้อม warning เดียว (ไม่ใช่หนึ่งอันต่อรูป)', () => {
    const product = normalizeOne({
      images: [
        { url_list: [`https://${APPROVED}/a.jpeg`] },
        { url_list: ['https://cdn.unapproved.test/b.jpeg'] },
        { url_list: [`https://${APPROVED}/c.jpeg`] },
      ],
    })
    expect(product.imageUrls).toEqual([`https://${APPROVED}/a.jpeg`, `https://${APPROVED}/c.jpeg`])
    expect(product.validationWarnings.filter((w) => w === 'image_url_rejected')).toHaveLength(1)
  })

  it('ไม่มี images[] เลย — fallback ไปที่ cover เดี่ยว ๆ เหมือนพฤติกรรมเดิม', () => {
    const product = normalizeOne({ cover: { url_list: [`https://${APPROVED}/only-cover.jpeg`] } })
    expect(product.imageUrls).toEqual([`https://${APPROVED}/only-cover.jpeg`])
  })

  it('images[] เป็น array ว่าง — fallback ไปที่ cover เหมือนกัน ไม่ใช่ถือว่า "มี images แต่ว่าง" แล้วจบเลย', () => {
    const product = normalizeOne({
      images: [],
      cover: { url_list: [`https://${APPROVED}/only-cover.jpeg`] },
    })
    expect(product.imageUrls).toEqual([`https://${APPROVED}/only-cover.jpeg`])
  })

  it('ไม่มีทั้ง images[] และ cover — imageUrls เป็น array ว่าง ไม่มี warning (ไม่ใช่ error ที่ไม่มีข้อมูลเลย)', () => {
    const product = normalizeOne({})
    expect(product.imageUrls).toEqual([])
    expect(product.validationWarnings).not.toContain('image_url_rejected')
  })

  it('query string ของแต่ละรูปถูกตัดทิ้งเหมือนเดิม (อาจมี token)', () => {
    const product = normalizeOne({
      images: [{ url_list: [`https://${APPROVED}/a.jpeg?x-tt-token=CANARY_ABC`] }],
    })
    expect(product.imageUrls).toEqual([`https://${APPROVED}/a.jpeg`])
    expect(JSON.stringify(product)).not.toContain('CANARY_ABC')
  })
})

describe('UT09 data path — ข้อความอันตรายถูกเก็บเป็นข้อความ ไม่ถูกตีความ', () => {
  const products = normalizeAll('fx10-hostile.json').map(accepted)

  it('title ที่เป็น HTML ถูกเก็บครบตัวอักษรโดยไม่แปลงหรือถอด', () => {
    expect(products[0]?.title).toBe('<img src=x onerror="globalThis.__pwned=1"> ครีมทดสอบ')
    expect((globalThis as Record<string, unknown>)['__pwned']).toBeUndefined()
  })

  it('ข้อความหน้าตาเหมือน SQL ถูกเก็บเป็นข้อความธรรมดา', () => {
    expect(products[1]?.title).toBe("'; DROP TABLE warehouse_products; --")
  })
})

describe('V10/R11 — ไม่ส่งออก field ที่ไม่ได้อยู่ใน allowlist', () => {
  it('nested object ที่ไม่รู้จักไม่ติดมากับ normalized product', () => {
    const products = normalizeAll('fx10-hostile.json').map(accepted)
    const serialized = JSON.stringify(products)
    for (const canary of ['CANARY_SESSION_7e44a0', 'CANARY_BEARER_be31f9', 'seller']) {
      expect(serialized).not.toContain(canary)
    }
  })

  it('key ของ normalized product ตรงกับ schema §8.1 เป๊ะ', () => {
    const p = accepted(normalizeAll('fx01-first-page.json')[0] as RowResult)
    expect(Object.keys(p).sort()).toEqual(
      [
        'canAddRaw',
        'categoryLabel',
        'commissionRate',
        'currency',
        'eligibility',
        'eligibilityBasis',
        'hasStatusPopup',
        'imageUrls',
        'observedAt',
        'priceAmountDecimal',
        'priceDisplay',
        'productId',
        'reviewStatusRaw',
        'schemaVersion',
        'shopName',
        'sourceIdentityVerified',
        'sourceRef',
        'stockQuantity',
        'stockStatusRaw',
        'title',
        'validationWarnings',
      ].sort(),
    )
  })

  it('V12 — ทุกแถวผูกกับ sourceRef ของ run และ identity ยังไม่ verified', () => {
    for (const p of normalizeAll('fx01-first-page.json').map(accepted)) {
      expect(p.sourceRef).toBe('local-profile-01')
      expect(p.sourceIdentityVerified).toBe(false)
      expect(p.schemaVersion).toBe(1)
      expect(p.observedAt).toBe('2026-09-19T10:00:00Z')
    }
  })
})
