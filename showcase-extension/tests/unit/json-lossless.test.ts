import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  LossyNumber,
  LosslessJsonUnsupportedError,
  hasLosslessJsonSupport,
  parseJsonLossless,
} from '../../extension/src/domain/json-lossless.js'

const fx12 = readFileSync('tests/fixtures/synthetic/fx12-large-ids.json', 'utf8')

interface Envelope {
  data: { products: { product_id: unknown; title: string }[] }
}

describe('UT02 — lossless JSON parsing (V03/R06)', () => {
  it('runtime นี้รองรับ source-text reviver', () => {
    expect(hasLosslessJsonSupport()).toBe(true)
  })

  it('เลขที่ไม่ปลอดภัยกลายเป็น LossyNumber ที่เก็บตัวอักษรต้นฉบับครบทุกหลัก', () => {
    const env = parseJsonLossless(fx12) as Envelope
    const unquoted = env.data.products[1]?.product_id
    expect(unquoted).toBeInstanceOf(LossyNumber)
    expect((unquoted as LossyNumber).source).toBe('1736749159048840633')
  })

  it('ห้ามคืนค่าที่ถูกปัดแล้ว — พิสูจน์ว่า JSON.parse ธรรมดาทำพัง', () => {
    const naive = (JSON.parse(fx12) as Envelope).data.products[1]?.product_id
    expect(String(naive)).toBe('1736749159048840700')
    expect(String(naive)).not.toBe('1736749159048840633')

    const env = parseJsonLossless(fx12) as Envelope
    expect(String(env.data.products[1]?.product_id)).toBe('1736749159048840633')
  })

  it('MAX_SAFE_INTEGER + 2 ก็ต้องรักษาค่าไว้ได้', () => {
    const env = parseJsonLossless(fx12) as Envelope
    expect(String(env.data.products[2]?.product_id)).toBe('9007199254740993')
  })

  it('เลขที่ปลอดภัยยังเป็น number ธรรมดา ไม่ห่อโดยไม่จำเป็น', () => {
    const env = parseJsonLossless(fx12) as Envelope
    expect(env.data.products[3]?.product_id).toBe(4242)
  })

  it('string ที่เป็น ID อยู่แล้วไม่ถูกแตะต้อง', () => {
    const env = parseJsonLossless(fx12) as Envelope
    expect(env.data.products[0]?.product_id).toBe('1736749159048840633')
  })

  it('ข้อความและโครงสร้างอื่นยังเหมือน JSON.parse ปกติ', () => {
    const env = parseJsonLossless(fx12) as Envelope
    expect(env.data.products).toHaveLength(4)
    expect(env.data.products[0]?.title).toBe('ID เป็น string ยาว 19 หลัก')
  })

  it('JSON ที่พังต้องโยน parse error ไม่ใช่คืนค่าว่าง', () => {
    expect(() => parseJsonLossless('{"a":')).toThrow()
    expect(() => parseJsonLossless('<!doctype html><html>login</html>')).toThrow()
  })

  it('LossyNumber แปลงเป็นข้อความได้ตรงและกันการนำไปคำนวณโดยบังเอิญ', () => {
    const n = new LossyNumber('1736749159048840633')
    expect(String(n)).toBe('1736749159048840633')
    expect(n.toJSON()).toBe('1736749159048840633')
    expect(Number.isNaN(Number(n))).toBe(true)
  })
})

describe('UT02b — fallback เมื่อ runtime ไม่รองรับ source-text reviver', () => {
  const originalParse = JSON.parse

  afterEach(() => {
    JSON.parse = originalParse
  })

  /**
   * จำลอง engine รุ่นเก่าที่ JSON.parse ไม่ส่ง third-arg context ให้ reviver เลย
   * (source-text reviver เป็นฟีเจอร์ที่ยังไม่ใช่มาตรฐานในทุก engine — V03 ต้องตรวจจับกรณีนี้แล้วปฏิเสธ
   * แทนที่จะเดินหน้าต่อแบบเงียบ ๆ แล้วเสี่ยงสูญเสีย precision ของ Product ID)
   */
  const withoutContextSupport = (): void => {
    JSON.parse = ((text: string, reviver?: (key: string, value: unknown) => unknown) => {
      const value: unknown = originalParse(text)
      if (reviver === undefined) return value
      const walk = (holder: unknown, key: string): unknown => {
        const v = (holder as Record<string, unknown>)[key]
        if (v !== null && typeof v === 'object') {
          for (const k of Object.keys(v as Record<string, unknown>)) {
            const revived = walk(v, k)
            if (revived === undefined) delete (v as Record<string, unknown>)[k]
            else (v as Record<string, unknown>)[k] = revived
          }
        }
        // จงใจเรียก reviver โดยไม่ส่ง third-arg context — จำลอง engine ที่ยังไม่รองรับ
        return reviver.call(holder, key, v)
      }
      return walk({ '': value }, '')
    }) as typeof JSON.parse
  }

  it('hasLosslessJsonSupport คืน false เมื่อ reviver ไม่เคยได้รับ context', () => {
    withoutContextSupport()
    expect(hasLosslessJsonSupport()).toBe(false)
  })

  it('parseJsonLossless ต้อง throw LosslessJsonUnsupportedError แทนการเดินหน้าแบบเสี่ยงสูญเสีย precision', () => {
    withoutContextSupport()
    expect(() => parseJsonLossless('{"id":1736749159048840633}')).toThrow(
      LosslessJsonUnsupportedError,
    )
  })

  it('LosslessJsonUnsupportedError มีชื่อ error และข้อความที่อธิบายสาเหตุ', () => {
    const err = new LosslessJsonUnsupportedError()
    expect(err.name).toBe('LosslessJsonUnsupportedError')
    expect(err).toBeInstanceOf(Error)
    expect(err.message.length).toBeGreaterThan(0)
  })
})
