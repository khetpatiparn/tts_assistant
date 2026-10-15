import { LossyNumber } from './json-lossless.js'
import { SCHEMA_VERSION } from './version.js'

export type Eligibility = 'candidate' | 'unavailable' | 'out_of_stock' | 'unknown'

export type ValidationWarning =
  | 'can_add_false_conflicts'
  | 'image_url_rejected'
  | 'price_amount_unverified'
  | 'price_is_range'
  | 'status_semantics_unverified'
  | 'stock_invalid'

export type QuarantineReason =
  | 'row_not_object'
  | 'product_id_invalid'
  | 'title_invalid'

/** Schema ตาม spec §8.1 — key ชุดนี้คือ allowlist ของการ export (V10) */
export interface NormalizedProduct {
  readonly schemaVersion: number
  readonly sourceRef: string
  readonly sourceIdentityVerified: boolean
  readonly productId: string
  readonly title: string
  readonly priceDisplay: string | null
  readonly priceAmountDecimal: string | null
  readonly currency: string | null
  readonly stockQuantity: number | null
  readonly stockStatusRaw: number | string | null
  readonly reviewStatusRaw: number | string | null
  readonly canAddRaw: boolean | null
  /**
   * observed: `affiliate_info.commission_rate` เป็นตัวเลข (เช่น 1100) — raw passthrough ในหน่วย
   * หนึ่งในร้อยของเปอร์เซ็นต์ (1200 = 12%) ยืนยัน 14/14 ชิ้นกับ commission_expense จริงแล้ว
   * (ดู lib/showcase-import.ts ใน repo Angle) · extension เองไม่แปลงหน่วย ส่งค่าดิบออกไป
   */
  readonly commissionRate: number | string | null
  readonly eligibility: Eligibility
  readonly eligibilityBasis: string
  /** observed: `category_info.name` (docs/api-observations.md §2) — `null` เมื่อไม่มี field นี้ */
  readonly categoryLabel: string | null
  /**
   * observed (docs/api-observations.md §2.3) — object นี้ปรากฏเฉพาะสินค้าที่ TikTok เองขึ้นว่า
   * "Unavailable" เท่านั้น (2/2 ที่สังเกตได้ ไม่ปรากฏในรายการอื่นเลย) มี `reason_code` ที่อ่านออก
   * ความหมายตรงตัว (11 = ผู้ขายลบสินค้า, 14 = ไม่ใช่สินค้า affiliate แล้ว) — **แค่การมีอยู่ของ
   * object นี้คือสัญญาณที่ปลอดภัยพอจะใช้ตัดสินใจได้จริง** ต่างจาก stock_status/review_status
   * ที่ยังเป็น enum ไม่ทราบความหมาย (ดู resolveEligibility — เก็บแค่ boolean ไม่เก็บทั้ง object
   * เพราะ eligibility ของ M1 ยังไม่ต้องการ reason_code แค่ต้องรู้ว่า "ตายแน่ๆ" หรือไม่)
   */
  readonly hasStatusPopup: boolean
  /**
   * observed 2026-09-20 (docs/api-observations.md §10) — สินค้าจริงมีหลายรูปใน `images[]`
   * (7–9 รูปที่เคยสังเกต, มุมกล้องต่างกัน) เก็บทุกรูปที่ผ่าน allowlist ไว้ ไม่ใช่แค่รูปเดียว
   * array ว่างแปลว่าไม่มีรูปใดผ่าน allowlist เลย ไม่ใช่ error
   */
  readonly imageUrls: readonly string[]
  readonly shopName: string | null
  readonly observedAt: string
  readonly validationWarnings: readonly ValidationWarning[]
}

export type RowResult =
  | { readonly status: 'accepted'; readonly product: NormalizedProduct }
  | { readonly status: 'quarantined'; readonly reasons: readonly QuarantineReason[] }

export interface NormalizeContext {
  readonly sourceRef: string
  readonly sourceIdentityVerified: boolean
  readonly observedAt: string
}

/** ค่าความยาวเป็นข้อกำหนดทดลองของเรา ไม่ใช่ข้อจำกัดของ upstream (spec §8.2) */
const MAX_PRODUCT_ID_LENGTH = 128
const MAX_TITLE_LENGTH = 2000

/**
 * V06/§8.3 — ยังไม่มี enum ใดถูกยืนยันเพราะ G0 ไม่ผ่าน
 * ตราบใดที่ชุดนี้ว่าง eligibility ของทุกแถวต้องเป็น unknown
 * การเติมค่าที่นี่โดยไม่มีหลักฐานคือการสร้างข้อเท็จจริงที่ spec §3.2 ห้ามไว้
 */
const VERIFIED_STOCK_STATUS: ReadonlyMap<number | string, Eligibility> = new Map()
const VERIFIED_REVIEW_STATUS: ReadonlyMap<number | string, Eligibility> = new Map()

/**
 * V08 — 4 host นี้เจอจริงจาก observed fixture 2026-09-20 (tests/fixtures/observed/,
 * docs/api-observations.md §10) — จดเฉพาะที่เคยเห็นจริงเท่านั้น ไม่เดา pattern กว้างกว่านั้น
 * (เช่น `*.ibyteimg.com`) แม้จะดูเป็นไปได้ก็ตาม ถ้า TikTok ใช้ CDN node อื่นที่ไม่เคยเห็น
 * (เช่น p17/p20) รูปจากที่นั่นจะถูกปฏิเสธเงียบ ๆ (ไม่ error แค่ imageUrls สั้นกว่าที่ควร)
 * เพิ่ม host ใหม่ได้ทันทีที่มีหลักฐานสังเกตจริง
 *
 * `-sg` กับ `-va` เป็นคนละภูมิภาค (Singapore/Virginia) แต่เจอทั้งคู่ผสมกันใน `images[]` ของสินค้า
 * เดียวกันจริง (ไม่ใช่แค่ sg อย่างเดียว) — บางรูปในลิสต์เดียวกันมาจาก va ก็มี จึงต้องเปิดทั้ง 4
 */
const APPROVED_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  'p16-oec-sg.ibyteimg.com',
  'p19-oec-sg.ibyteimg.com',
  'p16-oec-va.ibyteimg.com',
  'p19-oec-va.ibyteimg.com',
])

const ELIGIBILITY_BASIS_UNVERIFIED = 'adapter-rule-v1-unverified'
const ELIGIBILITY_BASIS_VERIFIED = 'adapter-rule-v1'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** อ่าน field ลูกจาก object ลูก โดยไม่ throw ถ้าตัวกลางหายไปหรือไม่ใช่ object (เช่น seller_info เป็น null) */
const dig = (raw: Record<string, unknown>, parentKey: string, childKey: string): unknown => {
  const parent = raw[parentKey]
  if (!isRecord(parent)) return undefined
  return parent[childKey]
}

/**
 * observed (tests/fixtures/observed/PROVENANCE.md) — ไม่มี field ชื่อ `image` ที่ระดับบนสุด
 * รูปอยู่ที่ `<entry>.url_list[0]` (array ของ URL คนละ CDN mirror ของรูปเดียวกัน) เลือกตัวแรก
 * เป็นตัวแทนของแต่ละ entry — ปล่อยให้ normalizeImageUrl ตัดสินใจเรื่อง host/scheme ต่อ
 * ใช้ได้ทั้งกับ `cover` (object เดี่ยว) และแต่ละสมาชิกของ `images[]` (shape เดียวกัน)
 */
const coverImageCandidate = (cover: unknown): unknown => {
  if (!isRecord(cover)) return undefined
  const urlList = cover['url_list']
  if (!Array.isArray(urlList) || urlList.length === 0) return undefined
  return urlList[0]
}

/**
 * observed 2026-09-20 (docs/api-observations.md §10) — สินค้าจริงมี `images[]` (หลายรูป มุมกล้อง
 * ต่างกัน) โดย `images[0]` ตรงกับ `cover` เป๊ะทุกสินค้าที่เคยสังเกต (เทียบแล้วทั้ง 6 ชิ้นในไฟล์ตัวอย่าง)
 * จึงดึงจาก `images[]` เป็นหลักเพราะได้ครบกว่า ไม่ต้องดึง `cover` ซ้ำ — fallback ไปที่ `cover` เดี่ยว ๆ
 * เมื่อ `images` หายไปหรือว่าง (ยังไม่เคยเจอเคสนี้จริง แต่ไม่มีหลักฐานว่าจะไม่เกิดขึ้น จึงกันไว้)
 */
const imageCandidates = (raw: Record<string, unknown>): readonly unknown[] => {
  const images = raw['images']
  if (Array.isArray(images) && images.length > 0) {
    return images
      .map((entry) => coverImageCandidate(entry))
      .filter((candidate) => candidate !== undefined)
  }
  const fallback = coverImageCandidate(raw['cover'])
  return fallback === undefined ? [] : [fallback]
}

/** V02/V03 — ID ต้องเป็นเลขฐานสิบและคงทุกหลัก ห้ามผ่าน Number ที่ปัดค่าได้ */
const canonicalProductId = (raw: unknown): string | null => {
  let text: string
  if (typeof raw === 'string') text = raw
  else if (raw instanceof LossyNumber) text = raw.source
  else if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) return null
    text = String(raw)
  } else return null

  if (text.length === 0 || text.length > MAX_PRODUCT_ID_LENGTH) return null
  if (!/^\d+$/.test(text)) return null
  return text
}

const normalizeTitle = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || raw.length > MAX_TITLE_LENGTH) return null
  return raw
}

/** V05 — 0 คือศูนย์จริง, null คือไม่ทราบ, ค่าที่ผิดกฎกลายเป็นไม่ทราบพร้อม warning */
const normalizeStock = (raw: unknown): { value: number | null; invalid: boolean } => {
  if (raw === undefined || raw === null) return { value: null, invalid: false }
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) {
    return { value: raw, invalid: false }
  }
  return { value: null, invalid: true }
}

const rawEnum = (raw: unknown): number | string | null =>
  typeof raw === 'number' || typeof raw === 'string' ? raw : null

const optionalString = (raw: unknown): string | null => (typeof raw === 'string' ? raw : null)

/** V08 — https เท่านั้น, host ต้องอยู่ใน allowlist, และ URL ไม่ถูกส่งต่อพร้อม query ที่อาจมี token */
const normalizeImageUrl = (raw: unknown): { value: string | null; rejected: boolean } => {
  if (raw === undefined || raw === null) return { value: null, rejected: false }
  if (typeof raw !== 'string' || raw.length === 0) return { value: null, rejected: true }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { value: null, rejected: true }
  }

  if (url.protocol !== 'https:') return { value: null, rejected: true }
  if (!APPROVED_IMAGE_HOSTS.has(url.hostname)) return { value: null, rejected: true }

  // ตัด query/fragment ทิ้งเสมอ: signed URL ใส่ token ไว้ตรงนั้น (spec §8.4)
  return { value: `${url.origin}${url.pathname}`, rejected: false }
}

/** V07 — เก็บข้อความราคาไว้ตรงตัว ไม่สร้างข้อเท็จจริงทางราคาจากการ parse ข้อความที่ยังไม่ยืนยันรูปแบบ */
const PRICE_RANGE = /[-–~]|\bto\b|ถึง/u

const resolveEligibility = (
  stockStatusRaw: number | string | null,
  reviewStatusRaw: number | string | null,
): { eligibility: Eligibility; basis: string; unverified: boolean } => {
  const stockVerdict = stockStatusRaw === null ? undefined : VERIFIED_STOCK_STATUS.get(stockStatusRaw)
  const reviewVerdict =
    reviewStatusRaw === null ? undefined : VERIFIED_REVIEW_STATUS.get(reviewStatusRaw)

  if (stockVerdict === undefined || reviewVerdict === undefined) {
    return { eligibility: 'unknown', basis: ELIGIBILITY_BASIS_UNVERIFIED, unverified: true }
  }
  if (stockVerdict !== 'candidate') {
    return { eligibility: stockVerdict, basis: ELIGIBILITY_BASIS_VERIFIED, unverified: false }
  }
  return { eligibility: reviewVerdict, basis: ELIGIBILITY_BASIS_VERIFIED, unverified: false }
}

export function normalizeProduct(raw: unknown, ctx: NormalizeContext): RowResult {
  if (!isRecord(raw)) return { status: 'quarantined', reasons: ['row_not_object'] }

  const reasons: QuarantineReason[] = []
  const productId = canonicalProductId(raw['product_id'])
  if (productId === null) reasons.push('product_id_invalid')
  const title = normalizeTitle(raw['title'])
  if (title === null) reasons.push('title_invalid')
  if (productId === null || title === null) return { status: 'quarantined', reasons }

  const warnings: ValidationWarning[] = []

  // mapping ตาม observed evidence (docs/api-observations.md §2.1 ช่องว่างที่ 2) —
  // ชื่อ field เดิม (price/stock/image/shop_name/commission_rate) ไม่มีอยู่จริงที่ระดับบนสุด
  const stock = normalizeStock(raw['stock_num'])
  if (stock.invalid) warnings.push('stock_invalid')

  // เก็บทุกรูปที่ผ่าน allowlist ไม่ใช่แค่รูปเดียว — candidate ที่หายไปเงียบ ๆ (undefined) ไม่ใช่
  // ความผิดพลาด แต่ candidate ที่มีจริงแล้วโดนปฏิเสธ (host ไม่ผ่าน/scheme ผิด/parse ไม่ได้) ต้องมี
  // warning เดียวพอต่อสินค้าหนึ่งชิ้น ไม่ใช่หนึ่ง warning ต่อรูป
  const imageUrls: string[] = []
  let imageRejected = false
  for (const candidate of imageCandidates(raw)) {
    const result = normalizeImageUrl(candidate)
    if (result.rejected) imageRejected = true
    else if (result.value !== null) imageUrls.push(result.value)
  }
  if (imageRejected) warnings.push('image_url_rejected')

  const priceDisplay = optionalString(raw['format_available_price'])
  if (priceDisplay !== null) {
    warnings.push('price_amount_unverified')
    if (PRICE_RANGE.test(priceDisplay)) warnings.push('price_is_range')
  }

  const stockStatusRaw = rawEnum(raw['stock_status'])
  const reviewStatusRaw = rawEnum(raw['review_status'])
  const verdict = resolveEligibility(stockStatusRaw, reviewStatusRaw)
  if (verdict.unverified) warnings.push('status_semantics_unverified')

  const canAddRaw = typeof raw['can_added'] === 'boolean' ? raw['can_added'] : null
  // §8.3: can_added=false ขัดกับการเสนอว่าใช้งานได้ ให้เป็น unknown พร้อม warning
  // และ can_added=true ห้ามลบล้างสถานะอื่น จึงไม่ยกระดับ eligibility ที่นี่เลย
  if (canAddRaw === false) warnings.push('can_add_false_conflicts')
  const eligibility: Eligibility = canAddRaw === false ? 'unknown' : verdict.eligibility

  const categoryLabel = optionalString(dig(raw, 'category_info', 'name'))
  const hasStatusPopup = isRecord(raw['status_popup'])

  return {
    status: 'accepted',
    product: {
      schemaVersion: SCHEMA_VERSION,
      sourceRef: ctx.sourceRef,
      sourceIdentityVerified: ctx.sourceIdentityVerified,
      productId,
      title,
      priceDisplay,
      priceAmountDecimal: null,
      currency: null,
      stockQuantity: stock.value,
      stockStatusRaw,
      reviewStatusRaw,
      canAddRaw,
      commissionRate: rawEnum(dig(raw, 'affiliate_info', 'commission_rate')),
      eligibility,
      eligibilityBasis: verdict.basis,
      categoryLabel,
      hasStatusPopup,
      imageUrls,
      shopName: optionalString(dig(raw, 'seller_info', 'shop_name')),
      observedAt: ctx.observedAt,
      validationWarnings: warnings,
    },
  }
}
