import { ScannerError } from '../domain/errors.js'
import { ALLOWED_KEYS, ALLOWED_TYPES, type ScannerMessage, type ScannerMessageType } from './schema.js'

export interface MessageSenderInfo {
  readonly id?: string | undefined
  readonly url?: string | undefined
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** จำนวนหน้าต้องเป็นอย่างน้อย 1 — "0 หน้า" ไม่มีความหมาย ต่างจาก offset ที่ 0 คือหน้าแรกที่ถูกต้อง */
const isSafePositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

/** V13 — เพดานเดียวกับจำนวนสินค้าสูงสุดต่อ run กัน payload ใหญ่ผิดปกติ */
const MAX_SELECTED_IDS = 5000

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_SELECTED_IDS &&
  value.every((item) => typeof item === 'string')

/**
 * ตรวจ message จาก popup/dashboard ก่อนถึง handler
 *
 * ไม่มี message type ใดรับ URL, host, path, method หรือ header — §7.1 กำหนดให้ worker
 * hardcode สิ่งเหล่านี้ กฎ key-set equality ด้านล่างจึงปิดช่องนั้นเชิงโครงสร้าง
 * โดยไม่ต้องมี branch ไล่แบน field ทีละตัวให้พลาดได้
 */
export function validateMessage(
  raw: unknown,
  sender: MessageSenderInfo,
  selfId: string,
): ScannerMessage {
  if (!isPlainObject(raw)) throw new ScannerError('msg_malformed')

  if (sender.id !== selfId) throw new ScannerError('msg_forbidden_sender')
  if (sender.url !== undefined && !sender.url.startsWith(`chrome-extension://${selfId}/`)) {
    throw new ScannerError('msg_forbidden_sender')
  }

  const type = raw['type']
  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) throw new ScannerError('msg_unknown_type')

  const allowed = ALLOWED_KEYS[type as ScannerMessageType]
  const actual = Object.keys(raw)
  if (actual.length !== allowed.length || !actual.every((key) => allowed.includes(key))) {
    throw new ScannerError('msg_forbidden_field')
  }

  if (type === 'adapter.probe') {
    const { offset, count } = raw
    if (!isSafeNonNegativeInteger(offset) || !isSafeNonNegativeInteger(count)) {
      throw new ScannerError('msg_malformed')
    }
    return { type, offset, count }
  }

  if (type === 'run.export') {
    const { selectedIds } = raw
    if (!isStringArray(selectedIds)) throw new ScannerError('msg_malformed')
    return { type, selectedIds }
  }

  if (type === 'run.start') {
    const { maxPages, knownProductIds } = raw
    if (maxPages !== null && !isSafePositiveInteger(maxPages)) throw new ScannerError('msg_malformed')
    if (knownProductIds !== null && !isStringArray(knownProductIds)) throw new ScannerError('msg_malformed')
    return { type, maxPages, knownProductIds }
  }

  return {
    type: type as 'app.info' | 'status.get' | 'run.cancel' | 'run.status' | 'data.clear',
  }
}
