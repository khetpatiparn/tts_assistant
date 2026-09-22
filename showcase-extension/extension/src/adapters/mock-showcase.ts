import { FlowAError } from '../domain/errors.js'
import { ADAPTER_VERSION_MOCK } from '../domain/version.js'
import type { ShowcaseAdapter, ShowcasePageRequest, ShowcaseRawPage } from './types.js'

export interface MockPageScript {
  readonly bodyText: string
  readonly httpStatus?: number
  readonly headers?: Readonly<Record<string, string>>
}

export interface MockShowcaseOptions {
  readonly pages?: readonly MockPageScript[]
}

/**
 * แคตตาล็อกตัวอย่างสำหรับ demo/manual test เท่านั้น — ข้อมูลสังเคราะห์ล้วน ไม่ใช่สินค้าจริง
 * มีหลายหน้าและมีความหลากหลาย (ราคาแบบมีคอมมา/ช่วงราคา, title ยาว, ไม่มีรูป/ร้าน) เพื่อให้เห็น
 * preview/pagination/selection ทำงานจริงตอนกด "เริ่มสแกน" ในเบราว์เซอร์ ไม่ใช่แค่สินค้าเดียว
 *
 * ID ตัวแรก '1736749159048840633' คงไว้ตามเดิมเพราะมี unit test อ้างอิงค่านี้อยู่
 */
const DEMO_TITLES = [
  'เซรั่มบำรุงผิวหน้า สูตรอ่อนโยน ขนาด 30 มล.',
  'ครีมกันแดด SPF50+ PA++++ เนื้อบางเบา ไม่เหนียวเหนอะหนะ',
  'มาส์กหน้าแผ่น สูตรเพิ่มความชุ่มชื้น แพ็ค 10 ชิ้น',
  'โฟมล้างหน้า สำหรับผิวแพ้ง่าย pH 5.5 ขนาด 150 มล.',
  'โทนเนอร์ปรับสภาพผิว 200 มล. สูตรไม่มีแอลกอฮอล์ อ่อนโยนต่อผิวบอบบาง',
  'อายครีม ลดริ้วรอยรอบดวงตา เนื้อครีมเข้มข้น 15 มล.',
  'ลิปบาล์มให้ความชุ่มชื้น กลิ่นวานิลลา',
  'เซตดูแลผิวหน้าครบชุด 5 ชิ้น สำหรับผิวผสม',
]

const DEMO_SHOPS = ['ร้านทดสอบสังเคราะห์ A', 'ร้านทดสอบสังเคราะห์ B', null]
const DEMO_PRICES = ['฿153.71', '฿1,299.00', '฿99.00 - ฿249.00', '฿459.00', '฿55.00']

// ชื่อ field ตรงนี้ต้องตรงกับ observed evidence จริง (tests/fixtures/observed/PROVENANCE.md)
// ไม่ใช่ชื่อสมมติเดิม — ไม่งั้น demo ใน dashboard จะโชว์ราคา/สต็อก/ร้าน/รูปเป็นค่าว่างหมด
const demoProduct = (index: number): Record<string, unknown> => {
  const shopName = DEMO_SHOPS[index % DEMO_SHOPS.length]
  return {
    product_id: index === 0 ? '1736749159048840633' : String(1736749159048840633n + BigInt(index)),
    title: DEMO_TITLES[index % DEMO_TITLES.length],
    format_available_price: DEMO_PRICES[index % DEMO_PRICES.length],
    stock_num: index % 5 === 0 ? 0 : index * 3,
    stock_status: 1,
    review_status: 1,
    can_added: index % 7 !== 0,
    // host `.ibyteimg.test` (TLD สงวนสำหรับทดสอบตาม RFC 2606) ตั้งใจไม่อยู่ใน APPROVED_IMAGE_HOSTS
    // เพื่อพิสูจน์ว่า host ที่ไม่ผ่านจริง ๆ ถูกปฏิเสธเงียบ ๆ (ไม่ error) — ห้ามใช้ host จริงของ TikTok
    // (แม้แค่ path ปลอม) เพราะ <img src> ในเบราว์เซอร์จริงตอน E2E จะพยายาม fetch จริง ละเมิด R15/PK04
    // (เคยลองแล้วจริง — network-isolation.spec.ts จับได้ทันทีว่ามี request หลุดออกไปยัง .ibyteimg.com)
    // ฟีเจอร์ "ดูรูปทั้งหมด" จึงทดสอบผ่าน unit test ของ preview.ts ที่ยัด imageUrls ปลอมตรง ๆ แทน
    // ไม่ผ่านแคตตาล็อก mock นี้ ซึ่งต้องคงสัญญา "ไม่แตะเครือข่ายจริงแม้แต่ path เดียว" ไว้เสมอ
    cover:
      index % 3 === 0
        ? null
        : { url_list: [`https://p16-oec-sg.ibyteimg.test/synthetic/demo-${String(index)}.jpeg`] },
    seller_info: shopName === null ? null : { shop_name: shopName },
  }
}

const DEMO_PAGE_SIZE = 6
const DEMO_TOTAL_PRODUCTS = 20

/**
 * V03 — บางแถวต้องมาเป็นเลขไม่ใส่ quotes เพื่อให้ lossless path ถูกใช้งานจริงทั้งใน unit และ E2E
 * ดัชนีอ้างอิงตำแหน่งภายในหน้า (page-relative) ไม่ใช่ index รวมของทั้งแคตตาล็อก
 */
const BARE_ID_INDICES: ReadonlySet<number> = new Set([1, 2])

const withBareIds = (text: string, ids: readonly string[]): string => {
  let out = text
  for (const index of BARE_ID_INDICES) {
    const id = ids[index]
    if (id === undefined) continue
    out = out.replace(`"product_id":"${id}"`, `"product_id":${id}`)
  }
  return out
}

const demoPage = (offset: number): string => {
  const products = Array.from(
    { length: Math.max(0, Math.min(DEMO_PAGE_SIZE, DEMO_TOTAL_PRODUCTS - offset)) },
    (_, i) => demoProduct(offset + i),
  )
  const text = JSON.stringify({
    code: 0,
    message: 'success',
    data: { products },
  })
  const ids = products.map((p) => p['product_id'] as string)
  return withBareIds(text, ids)
}

const DEFAULT_PAGES: readonly MockPageScript[] = [
  ...Array.from({ length: Math.ceil(DEMO_TOTAL_PRODUCTS / DEMO_PAGE_SIZE) }, (_, page) => ({
    bodyText: demoPage(page * DEMO_PAGE_SIZE),
  })),
  { bodyText: demoPage(DEMO_TOTAL_PRODUCTS) },
]

/**
 * Adapter สังเคราะห์ที่ไม่แตะ network เลย — เป็น injected transport ไม่ใช่ fetch interceptor
 * (spec §13.1) เพื่อไม่ให้ชนกับ network deny-by-default guard ของ R15
 */
export function createMockShowcaseAdapter(options: MockShowcaseOptions = {}): ShowcaseAdapter {
  const pages = options.pages ?? DEFAULT_PAGES
  let cursor = 0

  return {
    adapterVersion: ADAPTER_VERSION_MOCK,
    mode: 'mock',
    fetchPage(_request: ShowcasePageRequest, signal: AbortSignal): Promise<ShowcaseRawPage> {
      if (signal.aborted) return Promise.reject(new FlowAError('aborted'))

      const page = pages[cursor]
      if (page === undefined) return Promise.reject(new FlowAError('mock_script_exhausted'))
      cursor += 1

      return Promise.resolve({
        httpStatus: page.httpStatus ?? 200,
        headers: page.headers ?? { 'content-type': 'application/json' },
        bodyText: page.bodyText,
      })
    },
  }
}
