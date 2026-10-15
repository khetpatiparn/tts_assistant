import type { EnvelopeFailure } from '../domain/envelope.js'

export const RETRY_POLICY = {
  /** §9.4 — สูงสุด 2 ครั้งต่อ offset ไม่เปลี่ยน offset ระหว่าง retry */
  maxAttemptsPerOffset: 2,
  /** backoff ของ network/5xx */
  transientBackoffMs: [2000, 4000],
  /** backoff เมื่อโดน rate limit แต่ไม่มี Retry-After ที่ใช้ได้ */
  rateLimitBackoffMs: [30_000, 60_000],
  /** เพดานของ Retry-After เพื่อไม่ให้ค้างไม่มีกำหนด */
  maxRetryAfterMs: 15 * 60_000,
  /**
   * §9.1 — ลด count อัตโนมัติอนุญาตเฉพาะ error ที่ "ยืนยันแล้ว" ว่าเป็น invalid page size
   * ยังไม่มี error ชนิดใดที่ M0 ยืนยัน จึงปิดไว้ทั้งหมด
   */
  pageSizeFallbackEnabled: false,
  maxPageSizeReductions: 1,
} as const

export type FailureKind = 'transient' | 'rate_limited' | 'fatal'

export interface FailureVerdict {
  readonly action: 'retry' | 'stop'
  readonly kind: FailureKind
  readonly retryable: boolean
  /** §9.1 — auth failure, forbidden, challenge และ rate limit ห้ามเปลี่ยน count เพื่อพยายามผ่าน */
  readonly mayReducePageSize: boolean
}

export function classifyFailure(failure: EnvelopeFailure): FailureVerdict {
  switch (failure.outcome) {
    case 'rate_limited':
      return { action: 'retry', kind: 'rate_limited', retryable: true, mayReducePageSize: false }

    case 'server_error':
    case 'unexpected_status':
      return { action: 'retry', kind: 'transient', retryable: true, mayReducePageSize: false }

    // auth/forbidden/challenge/schema/business/oversize ไม่หายไปด้วยการยิงซ้ำ และการลด count
    // เพื่อพยายามผ่านคือการหาทางเลี่ยงการตรวจสอบ ซึ่ง spec §2.3/§9.1 ห้ามไว้
    case 'auth_required':
    case 'access_denied':
    case 'challenge_required':
    case 'schema_changed':
    case 'business_error':
    case 'body_too_large':
      return { action: 'stop', kind: 'fatal', retryable: false, mayReducePageSize: false }
  }
}

/**
 * §9.4 — Retry-After มีได้ทั้งวินาทีและ HTTP-date
 * ห้ามย่นเวลาที่ server ขอ ถ้าขอ 120 วินาที ต้องไม่ยิงก่อนครบ
 */
export function parseRetryAfter(header: string | null | undefined, now: number): number | null {
  if (header === null || header === undefined) return null
  const trimmed = header.trim()
  if (trimmed.length === 0) return null

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (!Number.isFinite(seconds)) return null
    return Math.min(seconds * 1000, RETRY_POLICY.maxRetryAfterMs)
  }

  // ค่าที่หน้าตาเป็นตัวเลขแต่ไม่ผ่านกฎข้างบน (เช่น "-5", "1.5") ถือว่าผิดรูป
  // ห้ามส่งต่อให้ Date.parse เพราะ Date.parse('-5') ตีความเป็นปี ค.ศ. -5 แล้วถูก clamp เหลือ 0
  // ซึ่งจะกลายเป็นการยิงซ้ำทันทีแบบไม่มีการรอ
  if (/^[+-]?[\d.]+$/.test(trimmed)) return null

  const asDate = Date.parse(trimmed)
  if (Number.isNaN(asDate)) return null
  return Math.min(Math.max(0, asDate - now), RETRY_POLICY.maxRetryAfterMs)
}

export interface RetryPlanInput {
  readonly kind: FailureKind
  /** ครั้งที่เท่าไรของ offset นี้ เริ่มนับที่ 1 */
  readonly attempt: number
  readonly now: number
  readonly retryAfterHeader: string | null | undefined
  /** งบเวลาที่เหลือของ run; ไม่ระบุ = ไม่จำกัด */
  readonly remainingBudgetMs?: number
}

export type RetryPlan =
  | { readonly action: 'retry'; readonly waitMs: number }
  | { readonly action: 'pause'; readonly resumeAfterMs: number }
  | { readonly action: 'give_up' }

/** jitter บวกอย่างเดียว เพื่อไม่ให้รอสั้นกว่าฐานที่ตั้งใจไว้ */
const jitter = (baseMs: number): number => baseMs + Math.floor(Math.random() * 1000)

export function planRetry(input: RetryPlanInput): RetryPlan {
  const { kind, attempt, now, retryAfterHeader, remainingBudgetMs } = input

  if (kind === 'fatal') return { action: 'give_up' }
  if (attempt > RETRY_POLICY.maxAttemptsPerOffset) return { action: 'give_up' }

  let waitMs: number
  if (kind === 'rate_limited') {
    const fromHeader = parseRetryAfter(retryAfterHeader, now)
    waitMs =
      fromHeader ??
      jitter(RETRY_POLICY.rateLimitBackoffMs[attempt - 1] ?? RETRY_POLICY.rateLimitBackoffMs[1])
  } else {
    waitMs = jitter(
      RETRY_POLICY.transientBackoffMs[attempt - 1] ?? RETRY_POLICY.transientBackoffMs[1],
    )
  }

  // §9.4 — ไม่ retry อัตโนมัติถ้าไม่มีงบเวลา ให้หยุดและบอกว่าเริ่มใหม่ได้เมื่อไร
  if (remainingBudgetMs !== undefined && waitMs > remainingBudgetMs) {
    return { action: 'pause', resumeAfterMs: waitMs }
  }

  return { action: 'retry', waitMs }
}
