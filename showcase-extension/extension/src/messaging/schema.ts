import type { RunReport } from '../core/runner.js'
import type { EnvelopeOutcome } from '../domain/envelope.js'
import type { NormalizedProduct } from '../domain/product.js'
import type { ResumeState } from '../dashboard/resume.js'
import type { ExportPayload } from '../export/json.js'

/** สถานะงานตาม spec §10 — ล็อกคำศัพท์ไว้ตั้งแต่ M1.1 เพราะ M1.3/M1.4 สร้าง state machine ทับชุดนี้ */
export type JobState =
  | 'idle'
  | 'validating'
  | 'fetching'
  | 'waiting_retry'
  | 'ready_complete'
  | 'ready_partial'
  | 'exported'
  | 'auth_required'
  | 'permission_required'
  | 'interrupted'
  | 'cancelled'
  | 'failed'

export type ScannerMessage =
  | { readonly type: 'app.info' }
  | { readonly type: 'status.get' }
  | { readonly type: 'adapter.probe'; readonly offset: number; readonly count: number }
  /**
   * `maxPages` เป็น required เสมอ (ไม่ใช่ optional) เพื่อไม่ให้มี default ที่ซ่อนอยู่ในฝั่ง worker —
   * ผู้เรียกต้องเลือกเองทุกครั้งว่า `null` (ไม่จำกัด สแกนจนจบ) หรือจำนวนหน้าที่ต้องการ (>= 1)
   * ใช้เมื่อรู้ว่ามีสินค้าใหม่เพิ่มมาไม่กี่หน้า ไม่ต้องการเดินสแกนทั้ง Showcase ทุกครั้งเพื่อลดความเสี่ยง
   * ต่อ TikTok server (ผู้ใช้เป็นคนสั่งเอง ไม่ใช่พฤติกรรมอัตโนมัติที่ตั้งใจซ่อนไว้)
   */
  | { readonly type: 'run.start'; readonly maxPages: number | null }
  | { readonly type: 'run.cancel' }
  | { readonly type: 'run.status' }
  | { readonly type: 'run.export'; readonly selectedIds: readonly string[] }
  | { readonly type: 'data.clear' }

export type ScannerMessageType = ScannerMessage['type']

/**
 * key ที่อนุญาตของแต่ละ type — validator ใช้ set equality ไม่ใช่ denylist
 * ทำให้ message ที่แนบ url/headers/method ถูกปฏิเสธโดยอัตโนมัติ โดยไม่ต้องมีกฎเฉพาะทาง
 */
export const ALLOWED_KEYS: Readonly<Record<ScannerMessageType, readonly string[]>> = Object.freeze({
  'app.info': ['type'],
  'status.get': ['type'],
  'adapter.probe': ['type', 'offset', 'count'],
  'run.start': ['type', 'maxPages'],
  'run.cancel': ['type'],
  'run.status': ['type'],
  'run.export': ['type', 'selectedIds'],
  'data.clear': ['type'],
})

export const ALLOWED_TYPES: ReadonlySet<string> = new Set(Object.keys(ALLOWED_KEYS))

export interface AppInfoResponse {
  readonly ok: true
  readonly schemaVersion: number
  readonly adapterMode: 'mock' | 'live'
  readonly adapterVersion: string
  readonly g0Verified: boolean
}

export interface StatusResponse {
  readonly ok: true
  readonly state: JobState
  readonly runId: null
  readonly sourceRef: null
  /** §8.5: ไม่มีทางเป็น true ใน M1 เพราะยังไม่มี identity field ที่ยืนยันได้ */
  readonly sourceIdentityVerified: false
}

/**
 * §14.1 "ทดลองหนึ่งหน้าก่อน แล้วจึงขอผู้ใช้เริ่ม full scan เอง" — adapter.probe คือ **หนึ่ง request
 * เดียว ไม่มี pagination ไม่มี retry อัตโนมัติ ไม่ใช้ lease** (ต่างจาก run.start ที่ผ่าน runImport)
 * `resultKind` มีไว้กันไม่ให้ UI/ผู้ใช้สับสนว่านี่คือผลสแกนครบ — เป็นแค่ผลของหน้าเดียว
 */
export interface ProbeResponse {
  readonly ok: true
  readonly resultKind: 'single_page_probe'
  readonly httpStatus: number
  readonly byteLength: number
  readonly adapterMode: 'mock' | 'live'
  /** ส่งมาด้วยเพื่อให้ dashboard ส่งออกผลตัวอย่างได้โดยไม่ต้องเดา/hardcode ค่าเหล่านี้เอง */
  readonly adapterVersion: string
  readonly sourceRef: string
  /** ผลการตรวจ envelope ของหน้านี้ — 401/403/429/challenge/schema ที่ไม่ใช่ 'ok' คือเหตุผลที่หยุด */
  readonly outcome: EnvelopeOutcome
  /** ว่างเสมอเมื่อ outcome ไม่ใช่ 'ok' — ไม่ normalize ต่อเมื่อ envelope ไม่ผ่าน */
  readonly products: readonly NormalizedProduct[]
  readonly counters: {
    readonly receivedRows: number
    readonly validRows: number
    readonly invalidRows: number
  } | null
}

export interface ErrorResponse {
  readonly ok: false
  readonly code: string
}

export interface RunStartResponse {
  readonly ok: true
  readonly started: true
}

export interface RunCancelResponse {
  readonly ok: true
}

/**
 * §10 — เมื่อ UI เปิดใหม่ (LC02) ต้องแยกได้ว่า idle/running/finished และถ้ามี run เดิมค้างอยู่
 * (running หรือ interrupted) ต้องเห็น ไม่ใช่ถูกซ่อนแล้วเสนอให้เริ่มใหม่เงียบ ๆ
 */
export interface RunStatusResponse {
  readonly ok: true
  readonly phase: 'idle' | 'running' | 'finished'
  readonly resume: ResumeState | null
  readonly report: RunReport | null
}

export interface RunExportResponse {
  readonly ok: true
  readonly payload: ExportPayload
}

/** PK05 — ล้างข้อมูลที่เก็บไว้ทั้งหมด (checkpoints/products); ไม่มี payload อื่นนอกจากธง cleared */
export interface DataClearResponse {
  readonly ok: true
  readonly cleared: true
}

export type ScannerResponse =
  | AppInfoResponse
  | StatusResponse
  | ProbeResponse
  | RunStartResponse
  | RunCancelResponse
  | RunStatusResponse
  | RunExportResponse
  | DataClearResponse
  | ErrorResponse

/** ผูก request type เข้ากับ response ที่เป็นไปได้ เพื่อให้ UI narrow ได้โดยไม่ต้องเดา */
export interface ResponseMap {
  readonly 'app.info': AppInfoResponse | ErrorResponse
  readonly 'status.get': StatusResponse | ErrorResponse
  readonly 'adapter.probe': ProbeResponse | ErrorResponse
  readonly 'run.start': RunStartResponse | ErrorResponse
  readonly 'run.cancel': RunCancelResponse | ErrorResponse
  readonly 'run.status': RunStatusResponse | ErrorResponse
  readonly 'run.export': RunExportResponse | ErrorResponse
  readonly 'data.clear': DataClearResponse | ErrorResponse
}
