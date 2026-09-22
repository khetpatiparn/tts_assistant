/**
 * V03 — รักษาความแม่นยำของตัวเลขที่ JSON.parse ปกติทำหาย
 *
 * Product ID ที่ upstream ส่งมาแบบไม่ใส่ quotes อาจเกิน Number.MAX_SAFE_INTEGER
 * `JSON.parse('{"id":1736749159048840633}').id` คืน 1736749159048840700 — ผิดไปสี่หลักท้าย
 * และ `String(number)` กู้คืนไม่ได้เพราะค่าถูกปัดไปตั้งแต่ตอน parse แล้ว
 *
 * ทางแก้คือ source-text reviver ของ JSON.parse ซึ่งให้ข้อความต้นฉบับของ primitive แต่ละตัว
 * ค่าที่แปลงกลับเป็นข้อความแล้วไม่ตรงต้นฉบับ จะถูกห่อด้วย LossyNumber ที่ถือตัวอักษรครบทุกหลัก
 */

/** ตัวเลขที่ค่า double แทนไม่ได้ครบ — เก็บไว้เป็นข้อความเท่านั้น */
export class LossyNumber {
  readonly source: string

  constructor(source: string) {
    this.source = source
  }

  toString(): string {
    return this.source
  }

  toJSON(): string {
    return this.source
  }

  /** ตั้งใจให้เป็น NaN เพื่อไม่ให้ค่านี้ถูกนำไปคำนวณโดยไม่ตั้งใจแล้วได้ผลผิดเงียบ ๆ */
  valueOf(): number {
    return Number.NaN
  }
}

interface ReviverContext {
  readonly source?: string
}

type SourceReviver = (this: unknown, key: string, value: unknown, context?: ReviverContext) => unknown

export function hasLosslessJsonSupport(): boolean {
  let sawSource = false
  const reviver: SourceReviver = (_key, value, context) => {
    if (context?.source !== undefined) sawSource = true
    return value
  }
  JSON.parse('1', reviver as (key: string, value: unknown) => unknown)
  return sawSource
}

export class LosslessJsonUnsupportedError extends Error {
  constructor() {
    super('runtime ไม่รองรับ JSON.parse source-text reviver — รักษา precision ของ Product ID ไม่ได้')
    this.name = 'LosslessJsonUnsupportedError'
  }
}

export function parseJsonLossless(text: string): unknown {
  if (!hasLosslessJsonSupport()) throw new LosslessJsonUnsupportedError()

  const reviver: SourceReviver = (_key, value, context) => {
    if (typeof value !== 'number') return value
    const source = context?.source
    if (source === undefined || source === String(value)) return value
    return new LossyNumber(source)
  }

  return JSON.parse(text, reviver as (key: string, value: unknown) => unknown)
}
