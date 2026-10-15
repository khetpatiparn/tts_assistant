import { describe, it, expect } from 'vitest'
import {
  RETRY_POLICY,
  classifyFailure,
  parseRetryAfter,
  planRetry,
} from '../../extension/src/core/retry.js'
import type { EnvelopeFailure } from '../../extension/src/domain/envelope.js'

const NOW = Date.parse('2026-09-19T10:00:00Z')

const envelope = (
  outcome: Exclude<EnvelopeFailure['outcome'], 'business_error'>,
): EnvelopeFailure => ({ outcome, httpStatus: 0 })

describe('PG08 — auth และ challenge ต้องหยุด ไม่ retry ไม่ลด page size (R09)', () => {
  it('401/403/challenge หยุดทันทีและไม่อนุญาตให้ลด count', () => {
    for (const outcome of ['auth_required', 'access_denied', 'challenge_required'] as const) {
      const verdict = classifyFailure(envelope(outcome))
      expect(verdict.action, outcome).toBe('stop')
      expect(verdict.mayReducePageSize, outcome).toBe(false)
      expect(verdict.retryable, outcome).toBe(false)
    }
  })

  it('schema เปลี่ยนหยุดเช่นกัน — ไม่ retry เพราะ retry ไม่ทำให้ schema กลับมา', () => {
    const verdict = classifyFailure(envelope('schema_changed'))
    expect(verdict.action).toBe('stop')
    expect(verdict.retryable).toBe(false)
  })

  it('business error หยุดและไม่ลด count', () => {
    const verdict = classifyFailure({ outcome: 'business_error', code: 10002 })
    expect(verdict.action).toBe('stop')
    expect(verdict.mayReducePageSize).toBe(false)
  })

  it('ไม่มี failure ชนิดใดเลยที่อนุญาตให้ลด page size ตอนนี้', () => {
    const outcomes = [
      'auth_required',
      'access_denied',
      'challenge_required',
      'rate_limited',
      'server_error',
      'unexpected_status',
      'schema_changed',
      'body_too_large',
    ] as const
    for (const outcome of outcomes) {
      expect(classifyFailure(envelope(outcome)).mayReducePageSize, outcome).toBe(false)
    }
  })
})

describe('PG11 — network/5xx retry ที่ offset เดิม (R09)', () => {
  it('5xx retry ได้ไม่เกิน 2 ครั้ง', () => {
    const verdict = classifyFailure(envelope('server_error'))
    expect(verdict.retryable).toBe(true)
    expect(RETRY_POLICY.maxAttemptsPerOffset).toBe(2)
  })

  it('backoff เป็น 2s แล้ว 4s พร้อม jitter ที่ไม่ทำให้สั้นกว่าฐาน', () => {
    const first = planRetry({ kind: 'transient', attempt: 1, now: NOW, retryAfterHeader: null })
    const second = planRetry({ kind: 'transient', attempt: 2, now: NOW, retryAfterHeader: null })
    if (first.action !== 'retry' || second.action !== 'retry') throw new Error('ควร retry ได้')
    expect(first.waitMs).toBeGreaterThanOrEqual(2000)
    expect(first.waitMs).toBeLessThan(3000)
    expect(second.waitMs).toBeGreaterThanOrEqual(4000)
    expect(second.waitMs).toBeLessThan(5000)
  })

  it('เกินจำนวนครั้งแล้วต้องหยุด', () => {
    const third = planRetry({ kind: 'transient', attempt: 3, now: NOW, retryAfterHeader: null })
    expect(third.action).toBe('give_up')
  })

  it('retry ใช้ offset เดิมเสมอ — policy ไม่มีช่องให้เปลี่ยน offset', () => {
    const plan = planRetry({ kind: 'transient', attempt: 1, now: NOW, retryAfterHeader: null })
    expect(plan).not.toHaveProperty('nextOffset')
  })
})

describe('PG09/AT03 — 429 Retry-After ห้ามย่นเวลา (R09)', () => {
  it('Retry-After: 120 ต้องรอครบ 120 วินาที ไม่ตัดเหลือ backoff ของเรา', () => {
    const plan = planRetry({ kind: 'rate_limited', attempt: 1, now: NOW, retryAfterHeader: '120' })
    if (plan.action !== 'retry') throw new Error('ควร retry ได้')
    expect(plan.waitMs).toBe(120_000)
  })

  it('เกินงบเวลาที่เหลือให้หยุดและบอกเวลาที่เริ่มใหม่ได้ ไม่ใช่รอครึ่งเดียวแล้วยิง', () => {
    const plan = planRetry({
      kind: 'rate_limited',
      attempt: 1,
      now: NOW,
      retryAfterHeader: '120',
      remainingBudgetMs: 30_000,
    })
    expect(plan.action).toBe('pause')
    if (plan.action !== 'pause') return
    expect(plan.resumeAfterMs).toBe(120_000)
  })
})

describe('PG10 — Retry-After รูปแบบต่าง ๆ (R09)', () => {
  it('ค่าเป็นวินาที', () => {
    expect(parseRetryAfter('120', NOW)).toBe(120_000)
    expect(parseRetryAfter('0', NOW)).toBe(0)
  })

  it('ค่าเป็น HTTP-date', () => {
    expect(parseRetryAfter('Sat, 19 Sep 2026 10:02:00 GMT', NOW)).toBe(120_000)
  })

  it('HTTP-date ที่เป็นอดีตกลายเป็นศูนย์ ไม่ใช่ค่าติดลบ', () => {
    expect(parseRetryAfter('Sat, 19 Sep 2026 09:58:00 GMT', NOW)).toBe(0)
  })

  it('ค่าผิดรูปหรือไม่มี คืน null ให้ผู้เรียกตัดสินใจเอง', () => {
    for (const header of ['soon', '-5', '', 'NaN', null]) {
      expect(parseRetryAfter(header, NOW), String(header)).toBeNull()
    }
  })

  it('ค่าที่ยาวเกินเหตุถูกตัดที่เพดาน ไม่ปล่อยให้ค้างไม่มีกำหนด', () => {
    expect(parseRetryAfter('999999999', NOW)).toBe(RETRY_POLICY.maxRetryAfterMs)
  })

  it('ไม่มี Retry-After ใช้ backoff 30s แล้ว 60s ไม่วนถี่', () => {
    const first = planRetry({ kind: 'rate_limited', attempt: 1, now: NOW, retryAfterHeader: null })
    const second = planRetry({ kind: 'rate_limited', attempt: 2, now: NOW, retryAfterHeader: null })
    if (first.action !== 'retry' || second.action !== 'retry') throw new Error('ควร retry ได้')
    expect(first.waitMs).toBeGreaterThanOrEqual(30_000)
    expect(second.waitMs).toBeGreaterThanOrEqual(60_000)
  })

  it('ไม่มีทางที่ wait จะเป็นศูนย์แล้ววนยิงรัว ๆ เมื่อ header ผิดรูป', () => {
    const plan = planRetry({ kind: 'rate_limited', attempt: 1, now: NOW, retryAfterHeader: 'soon' })
    if (plan.action !== 'retry') throw new Error('ควร retry ได้')
    expect(plan.waitMs).toBeGreaterThanOrEqual(30_000)
  })
})

describe('planRetry — kind ที่ retry ไม่ได้เลยต้อง give_up ทันที', () => {
  it('kind: fatal ให้ยอมแพ้ทันทีโดยไม่คำนวณ backoff ใด ๆ (§9.1 error ที่ retry ไม่มีทางผ่าน)', () => {
    const plan = planRetry({ kind: 'fatal', attempt: 1, now: NOW, retryAfterHeader: null })
    expect(plan.action).toBe('give_up')
  })
})

describe('parseRetryAfter — ค่าที่ overflow ตัวเลขปกติ', () => {
  it('ค่าที่เป็นตัวเลขล้วนแต่ยาวจนเกิน Number.MAX_VALUE กลาย Infinity ต้องคืน null ไม่ใช่รอไม่มีกำหนด', () => {
    // ผ่าน regex /^\d+$/ ได้ (เป็นตัวเลขล้วน) แต่ Number(...) ของมันคือ Infinity เพราะยาวเกิน
    const overflow = '9'.repeat(400)
    expect(parseRetryAfter(overflow, NOW)).toBeNull()
  })
})

describe('planRetry — attempt นอกช่วงปกติที่ backoff array ไม่มี index ตรง ต้องมี fallback ที่ยัง finite', () => {
  it('rate_limited: attempt ที่ backoff array ไม่มี index ตรง (fallback ??) ยังได้ wait ที่ finite และ >= ฐานสำรอง', () => {
    // attempt: 0 ไม่ใช่ค่าปกติจาก runner (เริ่มนับที่ 1) แต่ policy ต้องไม่พังหรือคืน NaN ถ้าหลุดมาถึง
    const plan = planRetry({ kind: 'rate_limited', attempt: 0, now: NOW, retryAfterHeader: null })
    if (plan.action !== 'retry') throw new Error('ควร retry ได้')
    expect(Number.isFinite(plan.waitMs)).toBe(true)
    expect(plan.waitMs).toBeGreaterThanOrEqual(RETRY_POLICY.rateLimitBackoffMs[1])
  })

  it('transient: attempt ที่ backoff array ไม่มี index ตรง (fallback ??) ยังได้ wait ที่ finite และ >= ฐานสำรอง', () => {
    const plan = planRetry({ kind: 'transient', attempt: 0, now: NOW, retryAfterHeader: null })
    if (plan.action !== 'retry') throw new Error('ควร retry ได้')
    expect(Number.isFinite(plan.waitMs)).toBe(true)
    expect(plan.waitMs).toBeGreaterThanOrEqual(RETRY_POLICY.transientBackoffMs[1])
  })
})

describe('PG12 — fallback ของ page size', () => {
  it('ยังไม่มี error ชนิดใดที่ยืนยันว่าเป็น invalid page size จึงยังไม่เปิด fallback', () => {
    expect(RETRY_POLICY.pageSizeFallbackEnabled).toBe(false)
  })

  it('ถ้าเปิดในอนาคต ต้องลดได้ครั้งเดียวเท่านั้น', () => {
    expect(RETRY_POLICY.maxPageSizeReductions).toBe(1)
  })
})
