import type { ShowcaseRawPage } from '../adapters/types.js'
import { validateEnvelope } from './envelope.js'
import type { EnvelopeFailure } from './envelope.js'
import { normalizeProduct } from './product.js'
import type {
  NormalizeContext,
  NormalizedProduct,
  QuarantineReason,
  ValidationWarning,
} from './product.js'

/**
 * field ที่ normalizer รู้จักแล้ว — ที่เหลือถือเป็นของใหม่และเข้า inventory (V10)
 *
 * ชื่อ field ตรงนี้อ้างอิงจาก observed evidence จริง (tests/fixtures/observed/PROVENANCE.md)
 * ไม่ใช่ชื่อสมมติจาก Triple Bot อีกต่อไป — `seller_info`/`affiliate_info`/`cover` เป็น object ลูก
 * ที่ normalizeProduct เจาะเข้าไปอ่านบาง field ข้างใน ไม่ใช่ทั้ง object; field ลูกที่ยังไม่ได้ใช้
 * (เช่น `category_info`, `labels`, `is_hide`, `images`) ยังคงเข้า inventory ตามปกติ เพราะ
 * normalizer ไม่ได้อ่านมันจริง ๆ
 */
const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  'product_id',
  'title',
  'format_available_price',
  'stock_num',
  'stock_status',
  'review_status',
  'can_added',
  'cover',
  'seller_info',
  'affiliate_info',
  'category_info',
  'status_popup',
])

/** inventory มีขอบเขตเพราะจำนวน key เป็นสิ่งที่ฝั่งตรงข้ามควบคุมได้ */
const MAX_INVENTORY_ENTRIES = 64
const MAX_FIELD_NAME_LENGTH = 64

export interface PageCounters {
  readonly receivedRows: number
  readonly invalidRows: number
  readonly validRows: number
}

export interface QuarantinedRow {
  /** ตำแหน่งในแถวดิบของหน้า เพื่อให้ไล่กลับไปดูได้โดยไม่ต้องเก็บ body ไว้ */
  readonly index: number
  readonly reasons: readonly QuarantineReason[]
}

export type PageResult =
  | {
      readonly outcome: 'ok'
      readonly counters: PageCounters
      readonly products: readonly NormalizedProduct[]
      readonly quarantined: readonly QuarantinedRow[]
      readonly schemaInventory: readonly string[]
      readonly warningTally: Readonly<Partial<Record<ValidationWarning, number>>>
    }
  | EnvelopeFailure

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * แปลงหนึ่งหน้าดิบเป็นผลที่ตรวจแล้ว
 *
 * ผลลัพธ์ตั้งใจไม่พก bodyText, headers หรือข้อความ error ของ upstream ติดไปเลย
 * เพราะโครงสร้างนี้คือสิ่งที่จะไหลต่อไปยัง UI, log และ diagnostic bundle (UT12/R11)
 * ส่วน inventory เก็บเฉพาะ "ชื่อ" field ที่ไม่รู้จัก ไม่เก็บค่า เพราะค่าอาจเป็น secret
 */
export function validatePage(rawPage: ShowcaseRawPage, ctx: NormalizeContext): PageResult {
  const envelope = validateEnvelope(rawPage)
  if (envelope.outcome !== 'ok') return envelope

  const products: NormalizedProduct[] = []
  const quarantined: QuarantinedRow[] = []
  const inventory = new Set<string>()
  const warningTally: Partial<Record<ValidationWarning, number>> = {}

  envelope.rows.forEach((row, index) => {
    if (isRecord(row)) {
      for (const key of Object.keys(row)) {
        if (KNOWN_FIELDS.has(key)) continue
        if (inventory.size >= MAX_INVENTORY_ENTRIES) break
        inventory.add(key.slice(0, MAX_FIELD_NAME_LENGTH))
      }
    }

    const result = normalizeProduct(row, ctx)
    if (result.status === 'quarantined') {
      quarantined.push({ index, reasons: result.reasons })
      return
    }
    products.push(result.product)
    for (const warning of result.product.validationWarnings) {
      warningTally[warning] = (warningTally[warning] ?? 0) + 1
    }
  })

  return {
    outcome: 'ok',
    counters: {
      receivedRows: envelope.rows.length,
      invalidRows: quarantined.length,
      validRows: products.length,
    },
    products,
    quarantined,
    schemaInventory: [...inventory].sort(),
    warningTally,
  }
}
