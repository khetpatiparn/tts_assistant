/**
 * Contract tests กับ response จริงที่เก็บจากบัญชีของเจ้าของโปรเจกต์ (2026-09-20)
 *
 * ต่างจากรอบก่อน ไฟล์ fixture ที่ใช้ที่นี่เป็น **full capture** ทั้ง 3 หน้า —
 * เก็บลงไฟล์โดยตรงผ่าน DevTools (ไม่ผ่านแชต จึงไม่โดนตัดที่ 50,000 ตัวอักษร)
 * อ่าน `tests/fixtures/observed/PROVENANCE.md` ก่อนแก้ไขหรือเพิ่ม assertion ใด ๆ
 *
 * เพราะเป็น full capture แล้ว จำนวนสินค้าในไฟล์ = จำนวนที่ server ส่งมาจริงของหน้านั้น
 * จึงใช้พิสูจน์เงื่อนไขจบของ pagination ได้ในไฟล์นี้ (ดูท้ายไฟล์) — ต่างจากรอบก่อนที่ต้องพึ่ง
 * fixture สังเคราะห์ล้วนใน pagination-contract.test.ts (ยังคงไว้เพื่อทดสอบ total ที่เปลี่ยน/ขัดแย้ง
 * ซึ่งไม่เคยพบจากของจริง)
 *
 * ไม่มี network ใด ๆ ในไฟล์นี้ — อ่านจากดิสก์อย่างเดียว
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { validatePage } from '../../extension/src/domain/page.js'
import { parseJsonLossless } from '../../extension/src/domain/json-lossless.js'
import { readPaginationMetadata, decideAdvance } from '../../extension/src/core/pagination.js'
import type { NormalizeContext } from '../../extension/src/domain/product.js'
import type { ShowcaseRawPage } from '../../extension/src/adapters/types.js'

const OBSERVED = 'tests/fixtures/observed'
const PAGE_1 = readFileSync(`${OBSERVED}/2026-09-20-page1-offset0-full6products.json`, 'utf8')
const PAGE_2 = readFileSync(`${OBSERVED}/2026-09-20-page2-offset6-full6products.json`, 'utf8')
const PAGE_34 = readFileSync(`${OBSERVED}/2026-09-20-page34-offset198-full3products.json`, 'utf8')
const ALL_PAGES = [PAGE_1, PAGE_2, PAGE_34]

const CTX: NormalizeContext = {
  sourceRef: 'local-profile-01',
  sourceIdentityVerified: false,
  observedAt: '2026-09-20T06:13:53Z',
}

const page = (bodyText: string): ShowcaseRawPage => ({
  httpStatus: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  bodyText,
})

/** อ่าน products ดิบออกมาเพื่อยืนยันสิ่งที่ *อยู่ใน response จริง* ก่อนผ่าน normalizer */
const rawProducts = (bodyText: string): Record<string, unknown>[] => {
  const parsed = parseJsonLossless(bodyText) as Record<string, unknown>
  const data = parsed['data'] as Record<string, unknown>
  return data['products'] as Record<string, unknown>[]
}

describe('Contract — envelope ของ response จริงผ่าน validator ได้', () => {
  it('ทั้งสามหน้าผ่าน envelope และได้ products ออกมาครบตามที่ server ส่งจริง', () => {
    const expected = [6, 6, 3]
    for (const [i, body] of ALL_PAGES.entries()) {
      const result = validatePage(page(body), CTX)
      if (result.outcome !== 'ok') throw new Error(`envelope ไม่ผ่าน: ${result.outcome}`)
      expect(result.products).toHaveLength(expected[i] as number)
    }
  })

  it('body จริงทั้งสามหน้า parse ผ่าน lossless parser ได้โดยไม่ throw', () => {
    for (const body of ALL_PAGES) expect(() => parseJsonLossless(body)).not.toThrow()
  })
})

describe('Contract — Product ID จาก response จริงต้องตรงทุกหลัก', () => {
  it('หน้า 1: ID ทั้งหกตัวออกมาเป็น string ตรงกับที่ server ส่งมา', () => {
    const result = validatePage(page(PAGE_1), CTX)
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.products.map((p) => p.productId)).toEqual([
      '1736476547228075452',
      '1736762921600452118',
      '1736523512318298068',
      '1737035303586858857',
      '1736250395495728550',
      '1736749159048840633',
    ])
  })

  it('หน้า 2: ID ทั้งหกตัวไม่ซ้ำกับหน้า 1 เลยสักตัว', () => {
    const result = validatePage(page(PAGE_2), CTX)
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    const ids = result.products.map((p) => p.productId)
    expect(ids).toEqual([
      '1736141205259257672',
      '1735661139711723379',
      '1736421432659969897',
      '1736635855749351215',
      '1736640577630930735',
      '1735687546222904848',
    ])
    const page1Result = validatePage(page(PAGE_1), CTX)
    if (page1Result.outcome !== 'ok') throw new Error(page1Result.outcome)
    const page1Ids = new Set(page1Result.products.map((p) => p.productId))
    for (const id of ids) expect(page1Ids.has(id)).toBe(false)
  })

  it('หน้า 34: ทั้งสามตัวตรงทุกหลัก และไม่ซ้ำกับหน้า 1/2', () => {
    const result = validatePage(page(PAGE_34), CTX)
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    const ids = result.products.map((p) => p.productId)
    expect(ids).toEqual([
      '1732246042498991343',
      '1736686332743353868',
      '1735801266111940034',
    ])
    const priorIds = new Set([...rawProducts(PAGE_1), ...rawProducts(PAGE_2)].map((r) => r['product_id']))
    for (const id of ids) expect(priorIds.has(id)).toBe(false)
  })

  it('ID ใน response จริงมาเป็น string ที่มี quote ครอบ ไม่ใช่เลขเปล่า ทั้งสามหน้า', () => {
    for (const body of ALL_PAGES) {
      for (const raw of rawProducts(body)) {
        expect(typeof raw['product_id']).toBe('string')
      }
    }
    // ถ้าเป็นเลขเปล่า ข้อความนี้จะปรากฏใน body — ยืนยันว่าไม่ใช่ (fixture เก็บมาแบบ pretty-printed
    // จึงมีช่องว่างหลัง colon เสมอ ต่างจาก fixture partial รอบก่อนที่เป็น compact)
    expect(PAGE_1).toMatch(/"product_id":\s*"1736476547228075452"/)
  })
})

describe('Contract — enum ที่ยังไม่ยืนยันต้องคง unknown (V06)', () => {
  it('response จริงมี stock_status ทั้ง 1 และ 2 · review_status ทั้ง 1 และ 4 (ครบทั้ง 15 สินค้าที่เก็บได้)', () => {
    const observed = ALL_PAGES.flatMap(rawProducts)
    expect(observed).toHaveLength(15)
    expect(new Set(observed.map((r) => r['stock_status']))).toEqual(new Set([1, 2]))
    expect(new Set(observed.map((r) => r['review_status']))).toEqual(new Set([1, 4]))
  })

  it('ทุกแถวของทั้งสามหน้าได้ eligibility = unknown เพราะยังไม่มี mapping ที่ยืนยัน', () => {
    for (const body of ALL_PAGES) {
      const result = validatePage(page(body), CTX)
      if (result.outcome !== 'ok') throw new Error(result.outcome)
      for (const product of result.products) {
        expect(product.eligibility).toBe('unknown')
        expect(product.validationWarnings).toContain('status_semantics_unverified')
      }
    }
  })

  it('เก็บ raw enum ไว้ตามเดิม ไม่แปลงค่า', () => {
    const result = validatePage(page(PAGE_34), CTX)
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.products[0]?.stockStatusRaw).toBe(2)
    expect(result.products[0]?.reviewStatusRaw).toBe(1)
    expect(result.products[1]?.stockStatusRaw).toBe(1)
    expect(result.products[1]?.reviewStatusRaw).toBe(4)
    expect(result.products[2]?.stockStatusRaw).toBe(1)
    expect(result.products[2]?.reviewStatusRaw).toBe(4)
  })
})

describe('Contract — can_added=true ไม่ยกระดับเป็น candidate โดยตัวมันเอง', () => {
  it('ทุกแถวที่สังเกตได้ทั้ง 15 ตัวมี can_added=true แต่ไม่มีแถวใดเป็น candidate', () => {
    for (const body of ALL_PAGES) {
      for (const raw of rawProducts(body)) expect(raw['can_added']).toBe(true)

      const result = validatePage(page(body), CTX)
      if (result.outcome !== 'ok') throw new Error(result.outcome)
      for (const product of result.products) {
        expect(product.canAddRaw).toBe(true)
        expect(product.eligibility).not.toBe('candidate')
      }
    }
  })

  it('ทั้งสองสินค้าที่ UI บอกว่า "Unavailable" ก็ยังส่ง can_added=true มาด้วย', () => {
    const [, deletedBySeller, noLongerAffiliate] = rawProducts(PAGE_34)
    for (const p of [deletedBySeller, noLongerAffiliate]) {
      expect(p?.['can_added']).toBe(true)
      expect((p?.['status_popup'] as Record<string, unknown>)['title']).toBe('Product not available')
    }
  })
})

describe('Contract — hasStatusPopup ต้องแยกสินค้าตายแล้วออกได้จริงจากข้อมูลจริง (§2.3)', () => {
  it('หน้า 34: out-of-stock เป็น false ส่วนสองตัวที่ Unavailable เป็น true', () => {
    const result = validatePage(page(PAGE_34), CTX)
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.products[0]?.hasStatusPopup).toBe(false)
    expect(result.products[1]?.hasStatusPopup).toBe(true)
    expect(result.products[2]?.hasStatusPopup).toBe(true)
  })

  it('หน้า 1/2 (สินค้าปกติทั้งหมด) ไม่มีตัวไหนเป็น true เลย', () => {
    for (const body of [PAGE_1, PAGE_2]) {
      const result = validatePage(page(body), CTX)
      if (result.outcome !== 'ok') throw new Error(result.outcome)
      for (const product of result.products) expect(product.hasStatusPopup).toBe(false)
    }
  })

  it('categoryLabel อ่านได้จริงทุกแถวที่สังเกตได้ทั้ง 15 ตัว', () => {
    for (const body of ALL_PAGES) {
      const result = validatePage(page(body), CTX)
      if (result.outcome !== 'ok') throw new Error(result.outcome)
      for (const product of result.products) {
        expect(product.categoryLabel).not.toBeNull()
        expect(product.categoryLabel?.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('Contract — missing / null / 0 ต้องไม่ถูกยุบรวมกัน (V05)', () => {
  it('หน้าสุดท้ายมีครบทั้งสามกรณีในหน้าเดียว: stock_num=0, ไม่มี field เลย, และค่าสูงมาก', () => {
    const [outOfStock, deletedBySeller, noLongerAffiliate] = rawProducts(PAGE_34)
    expect('stock_num' in (outOfStock as object)).toBe(true)
    expect(outOfStock?.['stock_num']).toBe(0)
    // ผู้ขายลบสินค้า: ไม่มี field นี้เลย แม้ UI จะแสดงเลข 0 ให้ผู้ใช้เห็น
    expect('stock_num' in (deletedBySeller as object)).toBe(false)
    // ไม่ใช่ affiliate แล้ว: stock_num ยังอยู่และสูงมาก แต่ UI ก็ยังขึ้น Unavailable เหมือนกัน
    expect(noLongerAffiliate?.['stock_num']).toBe(599992)
  })

  it('fixture เก็บความต่างนี้ไว้จริง ไม่ถูก normalize ตอน sanitize', () => {
    // fixture เก็บมาแบบ pretty-printed จึงมีช่องว่างหลัง colon เสมอ
    expect(PAGE_34).toMatch(/"stock_num":\s*0/)
    const deletedSegment = PAGE_34.slice(PAGE_34.indexOf('"1736686332743353868"'))
    const nextProductStart = deletedSegment.indexOf('"1735801266111940034"')
    expect(deletedSegment.slice(0, nextProductStart)).not.toContain('"stock_num"')
  })
})

describe('Contract — affiliate_info ไม่มีรูปร่างที่การันตีได้', () => {
  it('หน้าสุดท้ายมีครบสามรูปร่างในหน้าเดียว: 5 key, 7 key, และเหลือ key เดียว', () => {
    const [outOfStock, deletedBySeller, noLongerAffiliate] = rawProducts(PAGE_34)
    const a = Object.keys(outOfStock?.['affiliate_info'] as object)
    const b = Object.keys(deletedBySeller?.['affiliate_info'] as object)
    const c = Object.keys(noLongerAffiliate?.['affiliate_info'] as object)
    expect(a).toHaveLength(5)
    expect(b).toHaveLength(7)
    expect(c).toEqual(['est_commission_expense'])
    // สองตัวนี้ขาดไปในแถวแรก — normalizer ห้ามสมมติว่ามีเสมอ
    expect(a).not.toContain('included_reward_commission_rate')
    expect(a).not.toContain('reward_order_type')
  })

  it('รูปร่างที่ยุบเหลือ field เดียว มีค่าเป็นขีด ไม่ใช่ตัวเลข — ห้าม parse เป็นราคา', () => {
    const noLongerAffiliate = rawProducts(PAGE_34)[2]
    const aff = noLongerAffiliate?.['affiliate_info'] as Record<string, unknown>
    expect(aff['est_commission_expense']).toBe('-')
  })
})

describe('Contract — labels[] ไม่มีรูปร่างที่การันตีได้', () => {
  it('พบทั้ง label ที่ text เป็น empty string และ label ที่ไม่มี text/icon เลย', () => {
    const outOfStock = rawProducts(PAGE_34)[0]
    const labels = outOfStock?.['labels'] as Record<string, unknown>[]
    expect(labels[0]?.['text']).toBe('')
    expect('icon' in (labels[0] as object)).toBe(true)
    expect('text' in (labels[1] as object)).toBe(false)
    expect('icon' in (labels[1] as object)).toBe(false)
  })

  it('พบ label ซ้ำกันสองรายการติดกันในสินค้าเดียว (ข้อความส่วนลดตัวเลขไม่คงที่ ห้ามผูก assertion กับตัวเลข)', () => {
    const deletedBySeller = rawProducts(PAGE_34)[1]
    const labels = deletedBySeller?.['labels'] as Record<string, unknown>[]
    expect(labels).toHaveLength(3)
    expect(labels[0]?.['text']).toBe(labels[1]?.['text'])
    expect(labels[0]?.['type']).toBe(25)
    expect(labels[2]).toEqual({ theme: 0, type: 34 })
  })
})

describe('Contract — seller_id เป็นตัวตนของร้าน ไม่ใช่บัญชีผู้ใช้ และไม่จำเป็นต้องไม่ซ้ำกัน (V12a)', () => {
  it('ร้านเดียวกันลงสินค้าได้หลายชิ้น — seller_id ซ้ำกันได้ภายในหน้าเดียวกัน', () => {
    // หน้า 2 มีสินค้าสองชิ้นจากร้านเดียวกันจริง (ยืนยันจากข้อมูลก่อน sanitize)
    const products = rawProducts(PAGE_2)
    const sellerIds = products.map((r) => (r['seller_info'] as Record<string, unknown>)['seller_id'])
    const shopNames = products.map((r) => (r['seller_info'] as Record<string, unknown>)['shop_name'])
    expect(new Set(sellerIds).size).toBeLessThan(sellerIds.length)
    // สองสินค้าที่ seller_id ตรงกัน ต้อง shop_name ตรงกันด้วย (สอดคล้องภายในตัวเอง)
    const bySeller = new Map<unknown, unknown[]>()
    sellerIds.forEach((sid, i) => {
      const list = bySeller.get(sid) ?? []
      list.push(shopNames[i])
      bySeller.set(sid, list)
    })
    for (const names of bySeller.values()) expect(new Set(names).size).toBe(1)
  })

  it('ทุกแถวถูก mark ว่า source identity ยังไม่ถูกยืนยัน', () => {
    for (const body of ALL_PAGES) {
      const result = validatePage(page(body), CTX)
      if (result.outcome !== 'ok') throw new Error(result.outcome)
      for (const product of result.products) expect(product.sourceIdentityVerified).toBe(false)
    }
  })
})

/**
 * ช่องว่างนี้ **ปิดแล้ว** — normalizer เคยเขียนจากข้อสันนิษฐานใน spec §3.1
 * ("id, title, price, image, stock, shop, canAdd" ที่อ่านมาจาก source ของ Triple Bot)
 * ซึ่งไม่ตรงกับชื่อ field ของ response จริง ตอนนี้แก้ mapping ให้ตรงกับ observed evidence แล้ว
 * (docs/api-observations.md §2.1 ช่องว่างที่ 2, แก้ใน extension/src/domain/product.ts)
 *
 * เทสต์ชุดนี้ยืนยันว่า mapping ที่แก้ถูกต้องจริง โดยเทียบค่าที่ normalizer คืนกับค่าดิบในไฟล์ตรง ๆ
 * ไม่ hardcode ค่าคาดหวังไว้ล่วงหน้า เพื่อไม่ให้เทสต์เขียนตามคำตอบที่ต้องการ
 */
describe('Contract — mapping field ตรงกับ observed evidence แล้ว (ช่องว่างเดิมปิดแล้ว)', () => {
  it('response จริงไม่มี field ชื่อ price/stock/image/shop_name/commission_rate ที่ระดับบนสุด (ทั้งสามหน้า) — ยังคงจริงตามเดิม', () => {
    for (const body of ALL_PAGES) {
      for (const raw of rawProducts(body)) {
        for (const assumed of ['price', 'stock', 'image', 'shop_name', 'commission_rate']) {
          expect(assumed in (raw as object)).toBe(false)
        }
      }
    }
  })

  it('ของจริงอยู่คนละชื่อ/คนละชั้น', () => {
    const first = rawProducts(PAGE_1)[0]
    expect(first?.['format_available_price']).toBe('฿128.71')
    expect(first?.['stock_num']).toBe(2653)
    expect((first?.['seller_info'] as Record<string, unknown>)['shop_name']).toBe('redacted_shop_01')
    expect((first?.['affiliate_info'] as Record<string, unknown>)['commission_rate']).toBe(1100)
    expect(Array.isArray(first?.['images'])).toBe(true)
  })

  it('priceDisplay/stockQuantity/shopName/commissionRate ตรงกับค่าดิบทุกแถวจริงทั้ง 15 ตัว (ไม่ hardcode)', () => {
    for (const body of ALL_PAGES) {
      const result = validatePage(page(body), CTX)
      if (result.outcome !== 'ok') throw new Error(result.outcome)
      const raws = rawProducts(body)

      result.products.forEach((product, i) => {
        const raw = raws[i] as Record<string, unknown>

        expect(product.priceDisplay).toBe(raw['format_available_price'])

        if ('stock_num' in raw) expect(product.stockQuantity).toBe(raw['stock_num'])
        else expect(product.stockQuantity).toBeNull()

        const sellerInfo = raw['seller_info'] as Record<string, unknown>
        expect(product.shopName).toBe(sellerInfo['shop_name'])

        const affiliateInfo = raw['affiliate_info'] as Record<string, unknown>
        if ('commission_rate' in affiliateInfo) {
          expect(product.commissionRate).toBe(affiliateInfo['commission_rate'])
        } else {
          expect(product.commissionRate).toBeNull()
        }
      })
    }
  })

  const APPROVED_IMAGE_HOSTS_UNDER_TEST = [
    'p16-oec-sg.ibyteimg.com',
    'p19-oec-sg.ibyteimg.com',
    'p16-oec-va.ibyteimg.com',
    'p19-oec-va.ibyteimg.com',
  ]

  it('imageUrls มีรูปจริงครบทุกแถว (2026-09-20 §10) — allowlist มี 4 host ที่สังเกตได้จริงแล้ว', () => {
    // APPROVED_IMAGE_HOSTS เปิดทั้ง 4 host แล้ว (V08) — สินค้าจริงทั้ง 15 ชิ้นในไฟล์ observed ทั้ง
    // 3 หน้าใช้ host กลุ่มนี้ใน images[] ครบทุกชิ้น (ยืนยันแล้วด้วยการนับ host จริงก่อนเขียน
    // assertion นี้) จึงไม่มีแถวไหนควรได้ array ว่างเลย — บาง product ผสม host -sg กับ -va
    // ในลิสต์รูปเดียวกันจริง ไม่ใช่แยกกันเป๊ะตามภูมิภาค
    for (const body of ALL_PAGES) {
      const result = validatePage(page(body), CTX)
      if (result.outcome !== 'ok') throw new Error(result.outcome)
      for (const product of result.products) {
        expect(product.imageUrls.length, product.productId).toBeGreaterThan(0)
        for (const url of product.imageUrls) {
          const parsed = new URL(url)
          expect(APPROVED_IMAGE_HOSTS_UNDER_TEST, url).toContain(parsed.hostname)
          expect(parsed.protocol).toBe('https:')
          expect(parsed.search, 'ต้องไม่มี query string หลุดออกมา (อาจมี token)').toBe('')
        }
        // ไม่มี host แปลกปลอมเข้ามาปนเลย ไม่ใช่แค่ "ไม่ว่าง" เฉย ๆ
        expect(product.validationWarnings, product.productId).not.toContain('image_url_rejected')
      }
    }
  })

  it('field ที่ normalizer อ่านจริงแล้วไม่เข้า schemaInventory อีกต่อไป (V10)', () => {
    const result = validatePage(page(PAGE_1), CTX)
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    for (const known of ['format_available_price', 'stock_num', 'seller_info', 'affiliate_info', 'cover', 'category_info']) {
      expect(result.schemaInventory).not.toContain(known)
    }
    // field ที่ยังไม่ได้ใช้จริง (แม้จะเป็น nested container ที่รู้จักบางส่วน) ยังต้องเข้า inventory เหมือนเดิม
    for (const unused of ['labels', 'is_hide', 'source', 'images']) {
      expect(result.schemaInventory).toContain(unused)
    }
  })
})

describe('Contract — pagination metadata ของ response จริง', () => {
  it('readPaginationMetadata ได้ total อย่างเดียว ส่วน hasMore/nextOffset เป็น null', () => {
    const parsed = parseJsonLossless(PAGE_1) as Record<string, unknown>
    const meta = readPaginationMetadata(parsed['data'])
    expect(meta.total).toBe(201)
    expect(meta.hasMore).toBeNull()
    expect(meta.nextOffset).toBeNull()
  })

  it('total เท่ากันทั้งสามหน้า', () => {
    const t = (body: string): number | null =>
      readPaginationMetadata((parseJsonLossless(body) as Record<string, unknown>)['data']).total
    expect(t(PAGE_1)).toBe(201)
    expect(t(PAGE_2)).toBe(201)
    expect(t(PAGE_34)).toBe(201)
  })

  it('decideAdvance เดินด้วย offset + จำนวนแถวดิบ เพราะไม่มี hasMore/nextOffset ให้ใช้', () => {
    const parsed = parseJsonLossless(PAGE_1) as Record<string, unknown>
    const meta = readPaginationMetadata(parsed['data'])
    const rawRowCount = rawProducts(PAGE_1).length // = 6, จำนวนจริงที่ server ส่งมาของหน้านี้
    expect(decideAdvance({ currentOffset: 0, rawRowCount, metadata: meta })).toEqual({
      kind: 'continue',
      nextOffset: 6,
    })
  })

  /**
   * ก่อนหน้านี้หน้า 34 เป็น partial capture (ขาด 1 สินค้า) จึงพิสูจน์เงื่อนไขจบไม่ได้จากของจริง
   * ต้องพึ่ง fixture สังเคราะห์แทน ตอนนี้มี full capture แล้ว — เงื่อนไขจบพิสูจน์ได้จากของจริงโดยตรง
   */
  it('หน้าสุดท้ายของจริง: offset + จำนวนสินค้าที่ได้จริง = total พอดี (198 + 3 = 201)', () => {
    const offset = 198
    const rawRowCount = rawProducts(PAGE_34).length
    expect(rawRowCount).toBe(3)
    const parsed = parseJsonLossless(PAGE_34) as Record<string, unknown>
    const meta = readPaginationMetadata(parsed['data'])
    expect(offset + rawRowCount).toBe(meta.total)
  })

  /**
   * ช่องว่างนี้ **ปิดแล้ว** — decideAdvance อ่าน total แล้ว (extension/src/core/pagination.ts)
   * ป้อนหน้าสุดท้ายของจริง (full capture) เข้าไปตรง ๆ ต้องได้ endpoint_end ไม่ใช่ continue อีกต่อไป
   */
  it('decideAdvance รู้ว่าหน้าสุดท้ายของจริงคือจุดจบแล้ว เพราะอ่าน total', () => {
    const offset = 198
    const rawRowCount = rawProducts(PAGE_34).length
    const parsed = parseJsonLossless(PAGE_34) as Record<string, unknown>
    const meta = readPaginationMetadata(parsed['data'])
    expect(decideAdvance({ currentOffset: offset, rawRowCount, metadata: meta })).toEqual({
      kind: 'endpoint_end',
    })
  })

  it('หน้า 1 และหน้า 2 (ยังไม่ถึง total) ยังเดินต่อตามปกติ ไม่จบก่อนเวลา', () => {
    for (const body of [PAGE_1, PAGE_2]) {
      const offset = body === PAGE_1 ? 0 : 6
      const rawRowCount = rawProducts(body).length
      const parsed = parseJsonLossless(body) as Record<string, unknown>
      const meta = readPaginationMetadata(parsed['data'])
      expect(decideAdvance({ currentOffset: offset, rawRowCount, metadata: meta })).toEqual({
        kind: 'continue',
        nextOffset: offset + rawRowCount,
      })
    }
  })
})
