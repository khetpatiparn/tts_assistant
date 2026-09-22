import type { ShowcaseAdapter, ShowcaseRawPage } from '../adapters/types.js'
import { validateEnvelope } from '../domain/envelope.js'
import { FlowAError } from '../domain/errors.js'
import { validatePage } from '../domain/page.js'
import type { QuarantineReason } from '../domain/product.js'
import type { NormalizedProduct } from '../domain/product.js'
import type { JobState } from '../messaging/schema.js'
import type { CheckpointStore } from '../storage/checkpoints.js'
import { createProductAccumulator, decideAdvance, readPaginationMetadata } from './pagination.js'
import { classifyFailure, planRetry } from './retry.js'
import type { FailureKind } from './retry.js'

/** §9.4 — ค่าเริ่มต้นของ prototype ไม่ใช่คำรับรองว่าปลอดภัยจาก rate limit */
export const DEFAULT_BUDGET = {
  maxDurationMs: 10 * 60_000,
  maxRequests: 600,
  maxProducts: 5000,
} as const

/** §9.4 — เว้นระยะหลังจบหน้าก่อนหน้า */
export const PAGE_INTERVAL_MS = 1000

/** จำกัดจำนวนที่เก็บไว้ให้ UI ไล่ดู — counters.invalidRows ยังนับครบทุกแถวเสมอ ไม่ตัด */
export const MAX_QUARANTINED_RECORDS = 5000

export interface RunBudget {
  readonly maxDurationMs: number
  readonly maxRequests: number
  readonly maxProducts: number
}

export interface RunRequest {
  readonly runId: string
  readonly sourceRef: string
  readonly pageSize: number
  readonly signal: AbortSignal
  readonly budget?: RunBudget
  /**
   * หยุดหลังอ่านสำเร็จครบจำนวนหน้านี้ (ไม่นับ retry ที่ล้มเหลว) — `null`/ไม่ระบุ = ไม่จำกัด สแกนจนจบ
   * ตามปกติ (ค่าเริ่มต้น) ผู้ใช้เป็นคนสั่งเองผ่าน UI เพื่อลดจำนวน request ไป TikTok เมื่อรู้ว่ามีแค่
   * ไม่กี่หน้าที่เปลี่ยน ไม่ใช่ค่าความปลอดภัย (ต่างจาก budget.maxRequests ที่กันไม่ให้ run วิ่งเกินควบคุม)
   * เป็น optional ในอินเทอร์เฟซนี้เหมือน `budget` เพราะเป็นชั้นภายใน ไม่ใช่ wire message ที่ต้องเข้มงวด
   * (validate.ts บังคับให้ FlowAMessage ของ run.start ส่ง field นี้มาเสมอ ไม่มี default ที่ซ่อนอยู่)
   */
  readonly maxPages?: number | null
}

export interface RunnerDeps {
  readonly adapter: ShowcaseAdapter
  readonly store: CheckpointStore
  now(): number
  sleep(ms: number, signal: AbortSignal): Promise<void>
}

export type StopReason =
  | 'endpoint_end'
  | 'pagination_stalled'
  | 'pagination_conflict'
  | 'schema_changed'
  | 'challenge_required'
  | 'auth_required'
  | 'permission_required'
  | 'access_denied'
  | 'rate_limited'
  | 'business_error'
  | 'body_too_large'
  | 'redirect_blocked'
  | 'transport_error'
  | 'storage_error'
  | 'staging_limit_reached'
  | 'identity_changed'
  | 'run_already_active'
  | 'cancelled'
  | 'time_limit_reached'
  | 'request_limit_reached'
  | 'product_limit_reached'
  | 'page_limit_reached'

export type ScanCoverage = 'reached_endpoint_end' | 'partial' | 'unknown'
export type DataQuality = 'clean' | 'warnings' | 'rejected_rows'

/**
 * §8.3 — แท็บ "Rejected" ของ preview ต้องเห็นได้ว่ามีแถวอะไรบ้างที่ใช้ไม่ได้และเพราะอะไร
 * โดยไม่เก็บเนื้อหาแถวดิบ (title/price/ฯลฯ) เพราะแถวที่ quarantine อาจมีข้อมูลที่ยังไม่ตรวจ (R11)
 */
export interface QuarantinedRecord {
  readonly offset: number
  readonly indexInPage: number
  readonly reasons: readonly QuarantineReason[]
}

export interface RunCounters {
  readonly requests: number
  readonly successfulPages: number
  readonly receivedRows: number
  readonly invalidRows: number
  readonly duplicateValidRows: number
  readonly uniqueValidProducts: number
  readonly candidates: number
  readonly otherStatus: number
  readonly unknownStatus: number
}

export interface RunReport {
  readonly runId: string
  readonly sourceRef: string
  readonly adapterVersion: string
  readonly state: JobState
  readonly stopReason: StopReason
  readonly scanCoverage: ScanCoverage
  readonly dataQuality: DataQuality
  /** §9.5 — offset API ไม่มี atomic snapshot จึงยืนยันไม่ได้ว่าไม่มีรายการเคลื่อนระหว่างดึง */
  readonly snapshotConsistency: 'unverified'
  readonly counters: RunCounters
  readonly productIds: readonly string[]
  readonly products: readonly NormalizedProduct[]
  readonly quarantined: readonly QuarantinedRecord[]
  readonly firstOffset: number
  readonly pageSizeReductions: number
  readonly observedIdentity: string | null
  readonly sourceIdentityVerified: false
  readonly changedWithinRun: boolean
  readonly warnings: readonly string[]
  /** §9.4 — เมื่อหยุดเพราะงบเวลาไม่พอสำหรับ Retry-After ต้องบอกเวลาที่เริ่มใหม่ได้ */
  readonly resumeAfterMs: number | null
}

const STATE_BY_REASON: Partial<Record<StopReason, JobState>> = {
  endpoint_end: 'ready_complete',
  auth_required: 'auth_required',
  // challenge (เช่น HTML login/CAPTCHA แทน JSON) ต้องให้ผู้ใช้กลับไปยืนยันตัวตนในเบราว์เซอร์เอง
  // เหมือน auth_required — ไม่มี JobState เฉพาะของ challenge เพราะ §10 ล็อกคำศัพท์ไว้แล้ว
  challenge_required: 'auth_required',
  permission_required: 'permission_required',
  access_denied: 'failed',
  cancelled: 'cancelled',
  run_already_active: 'failed',
  identity_changed: 'failed',
}

/**
 * อ่าน identity ที่ไม่เป็นความลับจาก envelope
 *
 * ชื่อ field ยังเป็นข้อสันนิษฐาน (G0 ไม่ผ่าน) ค่าที่ได้จึงใช้เพื่อ "ตรวจว่าเปลี่ยนกลาง run หรือไม่"
 * เท่านั้น และไม่เคยทำให้ sourceIdentityVerified กลายเป็น true (§8.5)
 */
const readIdentity = (bodyText: string): string | null => {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    const data = parsed['data']
    if (data === null || typeof data !== 'object') return null
    const value = (data as Record<string, unknown>)['seller_id']
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

const readMetadataFrom = (bodyText: string): ReturnType<typeof readPaginationMetadata> => {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    return readPaginationMetadata(parsed['data'])
  } catch {
    return { hasMore: null, nextOffset: null, total: null }
  }
}

export async function runImport(request: RunRequest, deps: RunnerDeps): Promise<RunReport> {
  const budget = request.budget ?? DEFAULT_BUDGET
  const maxPages = request.maxPages ?? null
  const startedAt = deps.now()
  const accumulator = createProductAccumulator({ maxProducts: budget.maxProducts })
  const warnings = new Set<string>()

  let requests = 0
  let successfulPages = 0
  // จำนวนหน้าที่ผ่าน validatePage สำเร็จจริง (ต่างจาก successfulPages ที่นับเฉพาะหน้าที่มีสินค้า
  // อย่างน้อยหนึ่งแถว) — ใช้เทียบกับ request.maxPages เพราะ "หน้า" ในความหมายของผู้ใช้คือทุกหน้าที่
  // เดินผ่านจริง แม้บางหน้าจะว่างเปล่า ไม่ใช่แค่หน้าที่มีข้อมูล
  let pagesProcessed = 0
  let receivedRows = 0
  let invalidRows = 0
  let observedIdentity: string | null = null
  let identitySeen = false
  let offset = 0
  let pageIndex = 0
  // §9.4 — retry สูงสุด 2 ครั้งต่อ offset; รีเซ็ตทุกครั้งที่ offset ขยับสำเร็จ
  let offsetAttempts = 0
  // §9.3 อนุรักษนิยม — จำ total ที่เคยเห็นในหน้าก่อนหน้าของ run นี้ ไว้ตรวจว่า contract เปลี่ยนกลางคันหรือไม่
  // (decideAdvance เป็น pure function ไม่มี state เอง ผู้เรียกต้องเก็บค่านี้ข้าม iteration)
  let previousTotal: number | null = null
  const quarantinedRecords: QuarantinedRecord[] = []

  const finish = (reason: StopReason, resumeAfterMs: number | null = null): RunReport => {
    const products = accumulator.snapshot()
    // ไม่มีข้อมูลเลยแปลว่ายังไม่รู้อะไรเกี่ยวกับ endpoint — unknown ต่างจาก partial ที่มีข้อมูลบางส่วนแล้ว
    const coverage: ScanCoverage =
      reason === 'endpoint_end' ? 'reached_endpoint_end' : products.length === 0 ? 'unknown' : 'partial'

    const quality: DataQuality =
      invalidRows > 0
        ? 'rejected_rows'
        : products.some((p) => p.validationWarnings.length > 0)
          ? 'warnings'
          : 'clean'

    let state = STATE_BY_REASON[reason]
    if (state === undefined) {
      state = products.length > 0 ? 'ready_partial' : 'failed'
    }
    if (reason === 'endpoint_end') state = 'ready_complete'

    if (!identitySeen || observedIdentity === null) warnings.add('source_identity_unverified')

    let candidates = 0
    let otherStatus = 0
    let unknownStatus = 0
    for (const product of products) {
      if (product.eligibility === 'candidate') candidates += 1
      else if (product.eligibility === 'unknown') unknownStatus += 1
      else otherStatus += 1
    }

    return {
      runId: request.runId,
      sourceRef: request.sourceRef,
      adapterVersion: deps.adapter.adapterVersion,
      state,
      stopReason: reason,
      scanCoverage: coverage,
      dataQuality: quality,
      snapshotConsistency: 'unverified',
      counters: {
        requests,
        successfulPages,
        receivedRows,
        invalidRows,
        duplicateValidRows: accumulator.duplicateValidRows,
        uniqueValidProducts: accumulator.uniqueValidProducts,
        candidates,
        otherStatus,
        unknownStatus,
      },
      productIds: accumulator.productIds(),
      products,
      quarantined: quarantinedRecords,
      firstOffset: 0,
      // §9.1 — fallback ยังปิดอยู่ทั้งหมด จึงเป็นศูนย์เสมอในรุ่นนี้
      pageSizeReductions: 0,
      observedIdentity,
      sourceIdentityVerified: false,
      changedWithinRun: accumulator.changedWithinRun,
      warnings: [...warnings],
      resumeAfterMs,
    }
  }

  /** stop reason ของ retry ที่หมดสิทธิ์ ต้องสะท้อนสาเหตุจริง ไม่ใช่ rate_limited เหมารวมทุกกรณี */
  const stopReasonForKind = (kind: FailureKind): StopReason =>
    kind === 'rate_limited' ? 'rate_limited' : 'transport_error'

  /**
   * D2 (ปิดช่องว่างแล้ว) — รอ retry/backoff โดยต่ออายุ lease **ระหว่างรอ** ไม่ใช่แค่ครั้งเดียวก่อนรอ
   *
   * `RETRY_POLICY.maxRetryAfterMs` ยอมให้รอได้ถึง 15 นาที แต่ lease มีอายุแค่ `leaseTtlMs`
   * (ค่าเริ่มต้น 60 วินาที) การ heartbeat ครั้งเดียวก่อนรอจึงครอบคลุมการรอยาว ๆ ไม่ได้ —
   * lease หมดอายุกลางคันทั้งที่ run ยังวิ่งอยู่ แล้วถูกรายงานเป็น interrupted ผิด ๆ
   *
   * แก้โดยซอยการรอเป็นช่วง ๆ แล้ว heartbeat คั่นระหว่างช่วง ความถี่คิดจาก TTL จริงของ store
   * (ไม่ hardcode) จึงไม่มีทาง drift ถ้าใครเปลี่ยน `leaseTtlMs` ภายหลัง
   *
   * ถ้า service worker ตายกลางทาง lease จะหมดอายุตาม TTL ตามปกติ — ความหมายของ lease
   * ในฐานะสัญญาณว่า "ยังมีชีวิตอยู่" จึงไม่ถูกทำให้เสียไป
   */
  const heartbeatEveryMs = Math.max(1_000, Math.floor(deps.store.leaseTtlMs / 3))

  // §2.2/§9.2 ข้อ 1 — หนึ่งงานต่อ profile; lease เป็นตัวบังคับ ไม่ใช่ความตั้งใจของ UI
  const lease = await deps.store.acquireLease({
    runId: request.runId,
    sourceRef: request.sourceRef,
    adapterVersion: deps.adapter.adapterVersion,
    now: startedAt,
  })
  if (!lease.acquired) return finish('run_already_active')

  // ประกาศหลัง guard เพื่อให้ `lease.generation` ถูก narrow แล้วจริง ๆ ไม่ใช่ cast เอาเอง
  const waitWithHeartbeat = async (totalMs: number): Promise<void> => {
    let remaining = totalMs
    while (remaining > 0) {
      const chunk = Math.min(remaining, heartbeatEveryMs)
      await deps.sleep(chunk, request.signal)
      remaining -= chunk
      if (remaining > 0) {
        await deps.store.heartbeat(request.runId, lease.generation, deps.now())
      }
    }
  }

  try {
    for (;;) {
      // §9.2 ข้อ 10 — ตรวจ cancel และ bounds ก่อนทุก request
      if (request.signal.aborted) return finish('cancelled')
      if (deps.now() - startedAt >= budget.maxDurationMs) return finish('time_limit_reached')
      if (requests >= budget.maxRequests) return finish('request_limit_reached')

      let rawPage: ShowcaseRawPage
      try {
        requests += 1
        rawPage = await deps.adapter.fetchPage(
          { offset, count: request.pageSize },
          request.signal,
        )
      } catch (error) {
        if (request.signal.aborted) return finish('cancelled')

        if (error instanceof FlowAError) {
          // §9.2 ข้อ 4 — redirect ที่หลุดจาก endpoint contract ต้องหยุดเพื่อยืนยัน ไม่ retry เพื่อ
          // พยายามผ่าน (ต่างจาก network error/timeout ด้านล่างที่เป็นความผิดพลาดชั่วคราวจริง ๆ)
          if (error.code === 'adapter_redirect_blocked') return finish('redirect_blocked')
          // request สร้างไม่ได้ (offset/count ผิดรูป) คือบั๊กภายใน ไม่ใช่ความผิดพลาดชั่วคราวที่ retry
          // แล้วหาย — offset เดิมจะพังซ้ำแบบเดิมทุกครั้ง
          if (error.code === 'adapter_invalid_request') {
            warnings.add('transport_error:adapter_invalid_request')
            return finish('transport_error')
          }
          // body ใหญ่เกินตั้งแต่ transport เอง (หยุดอ่านกลางทางแล้ว) — เข้ากฎเดียวกับ body_too_large
          // ระดับ envelope (V14) ไม่ retry ด้วยเหตุผลเดียวกัน
          if (error.code === 'adapter_body_too_large') return finish('body_too_large')
          // optional host permission ยังไม่ได้รับอนุมัติ — ไม่ retry (การขอสิทธิ์ต้องมาจาก user
          // gesture ในหน้า dashboard เท่านั้น ไม่ใช่สิ่งที่ retry แล้วจะเปลี่ยนได้เอง)
          if (error.code === 'permission_required') return finish('permission_required')
        }

        // §9.4/PG11 — network error/timeout เข้ากฎ retry เดียวกับ 500 ไม่ใช่ fail ทันทีโดยไม่ลอง
        offsetAttempts += 1
        const plan = planRetry({
          kind: 'transient',
          attempt: offsetAttempts,
          now: deps.now(),
          retryAfterHeader: null,
          remainingBudgetMs: budget.maxDurationMs - (deps.now() - startedAt),
        })
        if (plan.action !== 'retry') {
          return finish('transport_error', plan.action === 'pause' ? plan.resumeAfterMs : null)
        }
        // D2 — ต่ออายุ lease ก่อนเริ่มรอ retry/backoff เสมอ ไม่ใช่แค่หลัง commit สำเร็จ เพราะระหว่างรอ (ซึ่งอาจ
        // ยาวหลายสิบวินาทีถึงหลายนาทีตาม Retry-After) ไม่มี commitPage เกิดขึ้นเลย ถ้าไม่ heartbeat ตรงนี้
        // lease จะหมดอายุกลาง wait ทั้งที่ run ยังวิ่งอยู่จริงและจะ resume ทันทีที่ wait จบ (ดู runner.test.ts
        // describe 'D2 gap') — `waitWithHeartbeat` ต่ออายุทั้งก่อนและ **ระหว่าง** รอ
        await deps.store.heartbeat(request.runId, lease.generation, deps.now())
        try {
          await waitWithHeartbeat(plan.waitMs)
        } catch {
          return finish('cancelled')
        }
        continue
      }

      const envelope = validateEnvelope(rawPage)
      if (envelope.outcome !== 'ok') {
        const verdict = classifyFailure(envelope)
        if (!verdict.retryable) {
          return finish(
            envelope.outcome === 'business_error' ? 'business_error' : (envelope.outcome as StopReason),
          )
        }
        offsetAttempts += 1
        const plan = planRetry({
          kind: verdict.kind,
          attempt: offsetAttempts,
          now: deps.now(),
          retryAfterHeader: rawPage.headers['retry-after'] ?? null,
          remainingBudgetMs: budget.maxDurationMs - (deps.now() - startedAt),
        })
        if (plan.action !== 'retry') {
          return finish(
            stopReasonForKind(verdict.kind),
            plan.action === 'pause' ? plan.resumeAfterMs : null,
          )
        }
        // D2 — เหตุผลเดียวกับจุด retry ของ network error ด้านบน: ต่ออายุ lease ก่อนและระหว่างรอเสมอ
        // จุดนี้สำคัญกว่าด้วยซ้ำ เพราะ Retry-After จาก rate limit คือแหล่งของ waitMs ยาว ๆ ตัวจริง
        await deps.store.heartbeat(request.runId, lease.generation, deps.now())
        try {
          await waitWithHeartbeat(plan.waitMs)
        } catch {
          return finish('cancelled')
        }
        continue
      }

      // §8.5/R14 — บัญชีเปลี่ยนกลาง run ห้ามผสมข้อมูล
      const identity = readIdentity(rawPage.bodyText)
      if (!identitySeen) {
        observedIdentity = identity
        identitySeen = true
      } else if (identity !== observedIdentity) {
        return finish('identity_changed')
      }

      const page = validatePage(rawPage, {
        sourceRef: request.sourceRef,
        sourceIdentityVerified: false,
        observedAt: new Date(deps.now()).toISOString(),
      })
      if (page.outcome !== 'ok') return finish('schema_changed')

      successfulPages += page.counters.receivedRows > 0 ? 1 : 0
      pagesProcessed += 1
      receivedRows += page.counters.receivedRows
      invalidRows += page.counters.invalidRows

      for (const row of page.quarantined) {
        if (quarantinedRecords.length >= MAX_QUARANTINED_RECORDS) break
        quarantinedRecords.push({ offset, indexInPage: row.index, reasons: row.reasons })
      }

      const added = accumulator.addPage(page.products)

      // §9.2 ข้อ 8 — แถวและ checkpoint ลงพร้อมกันใน transaction เดียว แล้วจึงรายงาน progress
      if (page.products.length > 0) {
        const commit = await deps.store.commitPage({
          runId: request.runId,
          generation: lease.generation,
          pageIndex,
          products: page.products,
          nextOffset: offset + page.counters.receivedRows,
          now: deps.now(),
        })
        if (!commit.committed) {
          return finish(
            commit.reason === 'staging_limit_reached' ? 'staging_limit_reached' : 'storage_error',
          )
        }
        pageIndex += 1

        // D2 — ต่ออายุ lease ทันทีหลัง commit สำเร็จด้วย (เพิ่มเติมจากสองจุดก่อนรอ retry/backoff ด้านบน
        // ซึ่งเป็นจุดที่ปิดช่องว่างจริงของ D2) ไม่จำเป็นสำหรับ run ที่กำลัง commit ถี่ ๆ อยู่แล้ว (commitPage เอง
        // ก็ต่ออายุ lease ให้อยู่แล้ว) แต่ไม่มีผลเสีย และช่วยกรณี run หลายสิบหน้าที่ page interval สะสมนาน
        await deps.store.heartbeat(request.runId, lease.generation, deps.now())
      }

      if (added.droppedByLimit > 0) return finish('product_limit_reached')

      const metadata = readMetadataFrom(rawPage.bodyText)
      const decision = decideAdvance({
        currentOffset: offset,
        rawRowCount: page.counters.receivedRows,
        metadata,
        previousTotal,
      })

      if (decision.kind === 'endpoint_end') return finish('endpoint_end')
      if (decision.kind === 'conflict') {
        // เก็บเหตุผลที่แน่ชัดไว้ให้เห็นได้ ไม่ใช่แค่ "pagination_conflict" เฉย ๆ — ข้อมูลที่ commit
        // แล้วก่อนหน้านี้ยังอยู่ครบใน products/counters เพราะ commit เกิดก่อนจุดนี้เสมอ (ดูด้านบน)
        warnings.add(`pagination_conflict:${decision.reason}`)
        return finish('pagination_conflict')
      }
      // จำ total ไว้ให้หน้าถัดไปเทียบ — อัปเดตเฉพาะตอนที่เห็นค่าจริง (ไม่เขียนทับด้วย null)
      // เพราะถ้า total เคยไม่ใช่ null มาก่อนแล้วหน้านี้กลายเป็น null ก็ต้องกลายเป็น conflict
      // ไปแล้วข้างบน (total_disappeared) ไม่มีทางถึงบรรทัดนี้ด้วยค่า null ทับของเดิม
      if (metadata.total !== null) previousTotal = metadata.total

      // §9.3 — หน้ามีสินค้า valid แต่ไม่มี ID ใหม่/เปลี่ยนเลย แปลว่า offset อาจไม่ทำงาน ห้ามอ้างว่าครบ
      // ใช้ page.products.length (แถวที่ผ่าน validate) ไม่ใช่ receivedRows (แถวดิบ) — หน้าที่แถวดิบ
      // เสียทั้งหมด (invalid ไม่ใช่ duplicate) ไม่ใช่ stalled ยังเดินหน้าต่อได้ตามปกติ
      if (page.products.length > 0 && added.newIds === 0 && added.changedIds === 0) {
        return finish('pagination_stalled')
      }

      // ผู้ใช้ตั้งใจจำกัดจำนวนหน้าเอง (ลดความเสี่ยงต่อ TikTok server เมื่อรู้ว่ามีแค่ไม่กี่หน้าที่
      // เปลี่ยน) — เช็คหลัง endpoint_end/conflict/stalled เสมอ เพื่อให้เหตุผลที่แม่นยำกว่าชนะ ถ้า
      // หน้านี้บังเอิญเป็นหน้าสุดท้ายจริงของ Showcase พอดี ต้องรายงาน endpoint_end ไม่ใช่ page_limit_reached
      if (maxPages !== null && pagesProcessed >= maxPages) {
        return finish('page_limit_reached')
      }

      offset = decision.nextOffset
      offsetAttempts = 0

      if (request.signal.aborted) return finish('cancelled')
      try {
        await deps.sleep(PAGE_INTERVAL_MS, request.signal)
      } catch {
        return finish('cancelled')
      }
    }
  } finally {
    await deps.store.releaseLease(request.runId, lease.generation)
  }
}
