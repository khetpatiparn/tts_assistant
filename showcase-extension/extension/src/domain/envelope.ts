import type { ShowcaseRawPage } from '../adapters/types.js'
import { parseJsonLossless } from './json-lossless.js'

/** V14 — ขีดจำกัดของเราเอง ไม่ใช่ข้อจำกัดของ upstream ปรับได้แต่ต้องมี hard bound เสมอ */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024

export type EnvelopeOutcome =
  | 'ok'
  | 'auth_required'
  | 'access_denied'
  | 'rate_limited'
  | 'server_error'
  | 'unexpected_status'
  | 'business_error'
  | 'schema_changed'
  | 'challenge_required'
  | 'body_too_large'

export type EnvelopeResult =
  | { readonly outcome: 'ok'; readonly rows: readonly unknown[] }
  | { readonly outcome: 'business_error'; readonly code: number }
  | { readonly outcome: Exclude<EnvelopeOutcome, 'ok' | 'business_error'>; readonly httpStatus: number }

export type EnvelopeFailure = Exclude<EnvelopeResult, { outcome: 'ok' }>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const byteLength = (text: string): number => new TextEncoder().encode(text).length

/**
 * V01 — ตรวจ envelope ก่อนแตะ products
 *
 * กฎสำคัญที่มาจาก spec §3.2: ไม่ตี missing `data.products` เป็น array ว่าง
 * array ว่างนับเป็น endpoint-end ได้เฉพาะเมื่อ envelope ถูกต้องทั้งหมดเท่านั้น (§9.2 ข้อ 6)
 * และไม่ใช้ error ทุกชนิดเป็นเหตุลด page size — แต่ละสาเหตุถูกแยกตามหลักฐานที่มีจริง
 */
export function validateEnvelope(page: ShowcaseRawPage): EnvelopeResult {
  const { httpStatus } = page

  if (httpStatus === 401) return { outcome: 'auth_required', httpStatus }
  if (httpStatus === 403) return { outcome: 'access_denied', httpStatus }
  if (httpStatus === 429) return { outcome: 'rate_limited', httpStatus }
  if (httpStatus >= 500) return { outcome: 'server_error', httpStatus }
  if (httpStatus < 200 || httpStatus > 299) return { outcome: 'unexpected_status', httpStatus }

  if (byteLength(page.bodyText) > MAX_PAGE_BYTES) return { outcome: 'body_too_large', httpStatus }

  const contentType = page.headers['content-type'] ?? ''
  const normalizedContentType = contentType.toLowerCase()
  // §9.3 — HTML แทน JSON คือลายเซ็นของหน้า login/CAPTCHA ที่สอดแทรกเข้ามาแทน API จริง
  // (spec FX09) แยกจาก schema_changed ทั่วไปเพื่อให้ stop reason ชัดว่าเป็น challenge ไม่ใช่ API เปลี่ยนรูปแบบ
  if (normalizedContentType.includes('html')) return { outcome: 'challenge_required', httpStatus }
  if (!normalizedContentType.includes('json')) return { outcome: 'schema_changed', httpStatus }

  let parsed: unknown
  try {
    parsed = parseJsonLossless(page.bodyText)
  } catch {
    return { outcome: 'schema_changed', httpStatus }
  }

  if (!isRecord(parsed)) return { outcome: 'schema_changed', httpStatus }

  const code = parsed['code']
  if (typeof code !== 'number') return { outcome: 'schema_changed', httpStatus }
  // ไม่ส่ง message ของ upstream ต่อ — อาจมีข้อมูลที่ไม่ควรออกจากขอบเขตนี้ (R11)
  if (code !== 0) return { outcome: 'business_error', code }

  const data = parsed['data']
  if (!isRecord(data)) return { outcome: 'schema_changed', httpStatus }

  const products = data['products']
  if (!Array.isArray(products)) return { outcome: 'schema_changed', httpStatus }

  return { outcome: 'ok', rows: products }
}
