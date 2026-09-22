/**
 * Transport layer ของ live adapter — แยกออกมาเพื่อ inject ตัวจำลองใน test ได้ (spec §13.1)
 * โมดูลนี้เป็นจุดเดียวที่เรียก `fetch` จริง — ทุกที่อื่นเห็นแค่ interface `LiveTransport`
 *
 * หลักการที่บังคับที่นี่ (spec §9.2 ข้อ 3–4, §9.4, ข้อกำหนดรอบ offline adapter):
 * - GET เท่านั้น, credentials: 'include' (ให้ browser แนบ session ปกติ), cache: 'no-store'
 * - ไม่เคยอ่าน/ตั้งค่า Cookie header เอง — ไม่มีโค้ดจุดใดแตะ header ชื่อ cookie เลย
 * - redirect: 'manual' — ไม่ตาม redirect โดยไม่รู้ตัว ถ้าเจอ 3xx ให้รายงานแล้วหยุด ไม่เดาว่าปลายทางคืออะไร
 * - timeout ครอบคลุมการอ่าน body ทั้งหมด ไม่ใช่แค่ตอนต่อ connection
 * - จำกัดจำนวนไบต์ที่อ่านจริงระหว่างสตรีม ไม่ใช่เชื่อ Content-Length แล้วอ่านทั้งก้อนย้อนมาเช็คทีหลัง
 * - ไม่ log body/headers ที่อาจมีข้อมูลอ่อนไหว (ไม่มี console.* ในไฟล์นี้เลย)
 */
export interface LiveTransportRequest {
  readonly method: 'GET'
  readonly url: string
  readonly signal: AbortSignal
}

export type LiveTransportOutcome =
  | {
      readonly kind: 'response'
      readonly httpStatus: number
      readonly headers: Readonly<Record<string, string>>
      readonly bodyText: string
    }
  | { readonly kind: 'redirect_blocked' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'network_error' }
  | { readonly kind: 'body_too_large' }

/** ไม่เคยโยน — ทุกความล้มเหลวเป็นค่าที่ตัดสินใจได้ ไม่ใช่ exception ที่ต้องเดาว่าเกิดจากอะไร */
export interface LiveTransport {
  send(request: LiveTransportRequest): Promise<LiveTransportOutcome>
}

export interface FetchTransportOptions {
  /** §9.4 — 20 วินาที รวมอ่าน body ทั้งหมด */
  readonly timeoutMs?: number
  /** V14 — ไม่เกิน 2 MiB ต่อหน้า เหมือนขีดจำกัดฝั่ง envelope validation */
  readonly maxBodyBytes?: number
  /**
   * inject `fetch` แทน `globalThis.fetch` — มีไว้ให้ test ส่ง fake fetch ที่คืน `Response`
   * จริง (สร้างด้วย `new Response(...)` ได้โดยไม่แตะ network) เข้ามาแทน เพื่อพิสูจน์ logic
   * ของ transport (redirect/timeout/streaming cap) โดยไม่ต้องปลด network-deny guard เลย
   * ค่า default คือ `globalThis.fetch` ซึ่งใน test environment ถูกล็อกให้ throw เสมอ (R15) —
   * ถ้าลืม inject fake fetch ใน test จะ fail ทันทีแทนที่จะยิง network จริงเงียบ ๆ
   */
  readonly fetchImpl?: typeof fetch
}

export const DEFAULT_TIMEOUT_MS = 20_000
export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024

/**
 * อ่าน body แบบ stream พร้อม cap จำนวนไบต์จริง — ถ้าเกิน cap จะ cancel reader ทันที
 * ไม่อ่านต่อจนจบแล้วค่อยเช็คความยาว (ซึ่งจะเสียเวลา/แบนด์วิดท์ไปแล้วโดยไม่มีประโยชน์)
 */
async function readBodyWithCap(
  response: Response,
  maxBytes: number,
): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false }> {
  if (response.body === null) {
    const text = await response.text()
    if (new TextEncoder().encode(text).length > maxBytes) return { ok: false }
    return { ok: true, text }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return { ok: false }
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder('utf-8').decode(merged) }
}

const headersToRecord = (headers: Headers): Record<string, string> => {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

/**
 * transport จริงตัวเดียวที่เรียก `fetch` — ใช้ได้เฉพาะเมื่อ G0_VERIFIED เป็น true เท่านั้น
 * (ตรวจที่ resolve.live.ts ก่อนจะสร้างตัวนี้ขึ้นมาเลยด้วยซ้ำ ไม่ใช่แค่ตรวจตอนเรียก)
 */
export function createFetchTransport(options: FetchTransportOptions = {}): LiveTransport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const doFetch = options.fetchImpl ?? fetch

  return {
    async send(request: LiveTransportRequest): Promise<LiveTransportOutcome> {
      const timeoutController = new AbortController()
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
      const combinedSignal = AbortSignal.any([request.signal, timeoutController.signal])

      try {
        let response: Response
        try {
          response = await doFetch(request.url, {
            method: request.method,
            credentials: 'include',
            cache: 'no-store',
            redirect: 'manual',
            signal: combinedSignal,
          })
        } catch {
          if (request.signal.aborted) return { kind: 'aborted' }
          if (timeoutController.signal.aborted) return { kind: 'timeout' }
          return { kind: 'network_error' }
        }

        // fetch(redirect:'manual') คืน opaque response แทนการตาม redirect ให้อัตโนมัติ —
        // อ่านต่อไม่ได้ (และไม่ควรเดา) ว่าปลายทางจริงคือ endpoint เดิมหรือหน้า login/อื่น ๆ
        if (response.type === 'opaqueredirect') return { kind: 'redirect_blocked' }

        const body = await readBodyWithCap(response, maxBodyBytes)
        if (!body.ok) return { kind: 'body_too_large' }

        return {
          kind: 'response',
          httpStatus: response.status,
          headers: headersToRecord(response.headers),
          bodyText: body.text,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
