import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateEnvelope } from '../../extension/src/domain/envelope.js'
import type { ShowcaseRawPage } from '../../extension/src/adapters/types.js'

const read = (name: string): string => readFileSync(`tests/fixtures/synthetic/${name}`, 'utf8')
const fx01 = read('fx01-first-page.json')
const fx03 = read('fx03-empty-page.json')
const fx08 = read('fx08-business-error.json')
const fx09 = read('fx09-schema-drift.json')

const page = (bodyText: string, httpStatus = 200): ShowcaseRawPage => ({
  httpStatus,
  headers: { 'content-type': 'application/json' },
  bodyText,
})

describe('V01 — envelope validation (R05/R06)', () => {
  it('หน้าที่ถูกต้องคืน products เป็น array', () => {
    const result = validateEnvelope(page(fx01))
    expect(result.outcome).toBe('ok')
    if (result.outcome !== 'ok') return
    expect(result.rows).toHaveLength(6)
  })

  it('array ว่างที่ envelope ถูกต้องเท่านั้นจึงนับเป็น endpoint-end ได้', () => {
    const result = validateEnvelope(page(fx03))
    expect(result.outcome).toBe('ok')
    if (result.outcome !== 'ok') return
    expect(result.rows).toEqual([])
  })

  it('UT03 — HTTP 200 แต่ business code ไม่ success ต้องเป็น API error ไม่ใช่ [] หรือ success', () => {
    const result = validateEnvelope(page(fx08))
    expect(result.outcome).toBe('business_error')
    if (result.outcome !== 'business_error') return
    expect(result.code).toBe(10002)
    // message ของ upstream ไม่ถูกนำมาแสดงตรง ๆ เพราะอาจมีข้อมูลที่ไม่ควรหลุด
    expect(JSON.stringify(result)).not.toContain('session invalid')
  })

  it('UT04 — data.products หายไปคือ schema error ไม่ใช่ endpoint-end', () => {
    const result = validateEnvelope(page(fx09))
    expect(result.outcome).toBe('schema_changed')
  })

  it('UT04 — products เป็น null หรือ object ก็เป็น schema error เช่นกัน', () => {
    for (const products of ['null', '{"0":{}}', '"six"', '42']) {
      const body = `{"code":0,"message":"success","data":{"products":${products}}}`
      expect(validateEnvelope(page(body)).outcome, products).toBe('schema_changed')
    }
  })

  it('body ที่ไม่ใช่ JSON เช่นหน้า login ต้องเป็น schema error ไม่ใช่สินค้าหมด', () => {
    const result = validateEnvelope(page('<!doctype html><html>please log in</html>'))
    expect(result.outcome).toBe('schema_changed')
  })

  it('HTTP status ที่ไม่ใช่ 2xx ถูกแยกตามหลักฐาน ไม่เดาว่า page size ใหญ่เกินไป', () => {
    expect(validateEnvelope(page('{}', 401)).outcome).toBe('auth_required')
    expect(validateEnvelope(page('{}', 403)).outcome).toBe('access_denied')
    expect(validateEnvelope(page('{}', 429)).outcome).toBe('rate_limited')
    expect(validateEnvelope(page('{}', 500)).outcome).toBe('server_error')
    expect(validateEnvelope(page('{}', 302)).outcome).toBe('unexpected_status')
  })

  it('content-type เป็น HTML ถูกจับเป็น challenge_required — ลายเซ็นของหน้า login/CAPTCHA แทน API จริง (spec §9.3 FX09)', () => {
    const result = validateEnvelope({
      httpStatus: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      bodyText: '<html></html>',
    })
    expect(result.outcome).toBe('challenge_required')
  })

  it('content-type ที่ไม่ใช่ JSON และไม่ใช่ HTML ถูกจับเป็น schema_changed (ไม่ใช่ challenge)', () => {
    const result = validateEnvelope({
      httpStatus: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      bodyText: 'ok',
    })
    expect(result.outcome).toBe('schema_changed')
  })

  it('V14 — body เกิน 2 MiB ถูกปฏิเสธพร้อมเหตุผล ไม่ใช่ crash', () => {
    const huge = `{"code":0,"message":"success","data":{"products":[],"pad":"${'ก'.repeat(800_000)}"}}`
    const result = validateEnvelope(page(huge))
    expect(result.outcome).toBe('body_too_large')
  })

  it('V14 — วัดเป็น byte ไม่ใช่จำนวนตัวอักษร (ภาษาไทยกิน 3 byte ต่อตัว)', () => {
    // 800,000 ตัวอักษรไทย = 2.4 MiB เกิน limit แม้จำนวนตัวอักษรจะน้อยกว่า 2 ล้าน
    const thai = `{"code":0,"message":"success","data":{"products":[],"pad":"${'ก'.repeat(800_000)}"}}`
    expect(thai.length).toBeLessThan(2 * 1024 * 1024)
    expect(validateEnvelope(page(thai)).outcome).toBe('body_too_large')
  })

  it('response ที่ไม่มี header content-type เลยต้องถูกปฏิเสธเหมือน content-type ที่ไม่ใช่ JSON', () => {
    // headers['content-type'] เป็น undefined (ไม่ใช่ empty string) — ต้องไม่ throw และต้องไม่ผ่านเป็น ok
    const result = validateEnvelope({ httpStatus: 200, headers: {}, bodyText: fx01 })
    expect(result.outcome).toBe('schema_changed')
  })

  it('body ที่เป็น JSON ถูกต้องแต่ top-level ไม่ใช่ object (array/number/null) เป็น schema error', () => {
    for (const body of ['[]', '42', 'null', '"hello"']) {
      expect(validateEnvelope(page(body)).outcome, body).toBe('schema_changed')
    }
  })

  it('code หายไปหรือไม่ใช่ number เป็น schema error ไม่ใช่ business error', () => {
    for (const body of [
      '{"message":"success","data":{"products":[]}}',
      '{"code":"0","message":"success","data":{"products":[]}}',
      '{"code":null,"message":"success","data":{"products":[]}}',
    ]) {
      expect(validateEnvelope(page(body)).outcome, body).toBe('schema_changed')
    }
  })

  it('data หายไปหรือไม่ใช่ record (null/array/primitive) เป็น schema error', () => {
    for (const body of [
      '{"code":0,"message":"success"}',
      '{"code":0,"message":"success","data":null}',
      '{"code":0,"message":"success","data":[]}',
      '{"code":0,"message":"success","data":"x"}',
    ]) {
      expect(validateEnvelope(page(body)).outcome, body).toBe('schema_changed')
    }
  })
})
