/**
 * Protocol client ของ "ลิงก์ปลายทาง" (Destination link — CONTEXT.md) — ไฟล์เดียวที่รู้จัก protocol
 * `showcase-scanner/1` ใช้ร่วมกันโดย popup (ไฟสถานะ) และหน้าจัดการ (หยุดเอง + ส่งผล)
 * สเปก: docs/superpowers/specs/2026-09-29-showcase-destination-link-design.md · เหตุผลที่ฝังรหัส
 * ในลิงก์: docs/adr/0001-destination-link-secret-in-url.md (ใน repo ของ Angle)
 *
 * POST เป็น simple request (text/plain ไม่มี custom header) จึงไม่มี preflight — ใช้กับ Google
 * Apps Script ได้ · ไม่ต้องมี host permission ของปลายทาง แค่ปลายทางตอบ CORS (ยืนยันสด 2026-09-29)
 */
export const PROTOCOL = 'showcase-scanner/1'

const KEY_LINK = 'destinationLink'
const KEY_DELIVERED = 'deliveredProductIds'
const KEY_LAST = 'lastDeliveredAt'
const TIMEOUT_MS = 5000

export interface DestinationDeps {
  readonly fetchImpl: typeof fetch
  storageGet(keys: string[]): Promise<Record<string, unknown>>
  storageSet(items: Record<string, unknown>): Promise<void>
  now(): number
}

export const defaultDestinationDeps = (): DestinationDeps => ({
  fetchImpl: (...args) => fetch(...args),
  storageGet: (keys) => chrome.storage.local.get(keys) as Promise<Record<string, unknown>>,
  storageSet: (items) => chrome.storage.local.set(items),
  now: () => Date.now(),
})

export function parseDestinationLink(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, message: 'ยังไม่ได้วางลิงก์' }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, message: 'ข้อความนี้ไม่ใช่ลิงก์ — คัดลอกลิงก์ปลายทางมาทั้งบรรทัด' }
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return { ok: true, url: trimmed }
  return { ok: false, message: 'ลิงก์ต้องขึ้นต้นด้วย https:// (ยกเว้นระบบในเครื่องตัวเอง localhost)' }
}

export async function getDestinationLink(deps: DestinationDeps = defaultDestinationDeps()): Promise<string> {
  const v = (await deps.storageGet([KEY_LINK]))[KEY_LINK]
  return typeof v === 'string' ? v : ''
}

export async function saveDestinationLink(url: string, deps: DestinationDeps = defaultDestinationDeps()): Promise<void> {
  // เปลี่ยนปลายทาง = สิ่งที่เคยส่งไปที่เดิมไม่เกี่ยวกับที่ใหม่
  await deps.storageSet({ [KEY_LINK]: url, [KEY_DELIVERED]: [], [KEY_LAST]: null })
}

export async function getDeliveryMemory(
  deps: DestinationDeps = defaultDestinationDeps(),
): Promise<{ ids: string[]; lastDeliveredAt: string | null }> {
  const s = await deps.storageGet([KEY_DELIVERED, KEY_LAST])
  const ids = Array.isArray(s[KEY_DELIVERED]) ? s[KEY_DELIVERED].filter((x): x is string => typeof x === 'string') : []
  return { ids, lastDeliveredAt: typeof s[KEY_LAST] === 'string' ? s[KEY_LAST] : null }
}

export async function clearDeliveryMemory(deps: DestinationDeps = defaultDestinationDeps()): Promise<void> {
  await deps.storageSet({ [KEY_DELIVERED]: [], [KEY_LAST]: null })
}

export type DestinationStatus =
  | { readonly kind: 'no_link' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'ready'; readonly productCount: number; readonly lastReceivedAt: string | null }
  | { readonly kind: 'no_status'; readonly lastDeliveredAt: string | null }

type Probe =
  | { kind: 'no_link' | 'unreachable' | 'rejected' | 'no_status' }
  | { kind: 'ready'; productIds: string[]; lastReceivedAt: string | null }

/** GET ลิงก์ปลายทางหนึ่งครั้ง — ไม่ throw เด็ดขาด */
async function probe(deps: DestinationDeps): Promise<Probe> {
  const link = await getDestinationLink(deps)
  if (link === '') return { kind: 'no_link' }
  let res: Response
  try {
    res = await deps.fetchImpl(link, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    return { kind: 'unreachable' }
  }
  if (res.status === 401 || res.status === 403) return { kind: 'rejected' }
  if (res.status >= 500) return { kind: 'unreachable' }
  if (!res.ok) return { kind: 'no_status' }
  try {
    const body = (await res.json()) as { protocol?: unknown; productIds?: unknown; lastReceivedAt?: unknown; error?: unknown }
    if (body.error === 'unauthorized') return { kind: 'rejected' } // Apps Script ตอบ 401 ไม่ได้ ใช้ body แทน
    if (body.protocol !== PROTOCOL || !Array.isArray(body.productIds)) return { kind: 'no_status' }
    return {
      kind: 'ready',
      productIds: body.productIds.filter((x): x is string => typeof x === 'string'),
      lastReceivedAt: typeof body.lastReceivedAt === 'string' ? body.lastReceivedAt : null,
    }
  } catch {
    return { kind: 'no_status' } // เช่น Apps Script ที่ไม่มี doGet ตอบเป็น HTML
  }
}

export async function checkDestination(deps: DestinationDeps = defaultDestinationDeps()): Promise<DestinationStatus> {
  const p = await probe(deps)
  if (p.kind === 'ready') return { kind: 'ready', productCount: p.productIds.length, lastReceivedAt: p.lastReceivedAt }
  if (p.kind === 'no_status') return { kind: 'no_status', lastDeliveredAt: (await getDeliveryMemory(deps)).lastDeliveredAt }
  return { kind: p.kind }
}

/**
 * รายการสินค้าที่ถือว่า "ส่งแล้ว" สำหรับหยุดสแกนเอง — ปลายทางบอกได้ใช้ของปลายทาง (แม่นกว่า) ไม่งั้นใช้
 * ความจำ · null = ห้ามสแกนอัตโนมัติ: ถ้าติดต่อไม่ได้แล้วยังสแกนต่อด้วยความจำ อาจส่งไม่ได้ทั้งรอบ
 */
export async function resolveKnownIds(
  deps: DestinationDeps = defaultDestinationDeps(),
): Promise<{ source: 'destination' | 'memory'; ids: string[] } | null> {
  const p = await probe(deps)
  if (p.kind === 'ready') return { source: 'destination', ids: p.productIds }
  if (p.kind === 'no_status') return { source: 'memory', ids: (await getDeliveryMemory(deps)).ids }
  return null
}

/**
 * POST ผลสแกน · 2xx = สำเร็จ (ไม่อ่าน body — ปลายทางตอบอะไรก็ได้) แล้วจำ "ทุก ID ที่ส่ง" ไม่ใช่เฉพาะที่
 * ปลายทางเก็บ — สินค้าที่ปลายทางข้าม (เช่นหมดสต็อก) ต้องไม่ถูกนับเป็น "ใหม่" ซ้ำทุกรอบ (ดูสเปกข้อ 5)
 */
export async function deliver(
  payload: { readonly products: readonly { readonly productId: string }[] },
  deps: DestinationDeps = defaultDestinationDeps(),
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const link = await getDestinationLink(deps)
  if (link === '') return { ok: false, message: 'ยังไม่ได้ใส่ลิงก์ปลายทาง — ใส่ที่ส่วน "ตั้งค่า"' }
  let res: Response
  try {
    res = await deps.fetchImpl(link, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return { ok: false, message: 'ติดต่อปลายทางไม่ได้ — เช็กว่าระบบปลายทางเปิดอยู่' }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'ลิงก์ปลายทางใช้ไม่ได้แล้ว (อาจถูกสร้างใหม่) — คัดลอกลิงก์ล่าสุดมาใส่ใหม่' }
  }
  if (!res.ok) return { ok: false, message: `ปลายทางตอบกลับว่าไม่สำเร็จ (${String(res.status)})` }
  // Apps Script ตอบสถานะ 401 ไม่ได้ (200 เสมอ) — protocol ให้ตอบ {"error":"unauthorized"} แทน ต้องไม่นับว่าส่งสำเร็จ
  const text = await res.text().catch(() => '')
  if (/"error"\s*:\s*"unauthorized"/.test(text)) {
    return { ok: false, message: 'ลิงก์ปลายทางใช้ไม่ได้แล้ว (อาจถูกสร้างใหม่) — คัดลอกลิงก์ล่าสุดมาใส่ใหม่' }
  }

  const memory = await getDeliveryMemory(deps)
  const ids = new Set(memory.ids)
  for (const p of payload.products) ids.add(p.productId)
  await deps.storageSet({ [KEY_DELIVERED]: [...ids], [KEY_LAST]: new Date(deps.now()).toISOString() })
  return { ok: true, count: payload.products.length }
}

/** "3 วันก่อน" / "วันนี้" สำหรับบรรทัดเวลาบน popup */
export function relativeDaysThai(iso: string, now: number): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'ไม่ทราบ'
  const days = Math.floor((now - then) / 86_400_000)
  if (days <= 0) return 'วันนี้'
  if (days === 1) return 'เมื่อวาน'
  return `${String(days)} วันก่อน`
}

/**
 * popup สั่งหน้าจัดการให้ "สแกนสินค้าใหม่แล้วส่งเข้าแอปเองจนจบ" (dashboard/main.ts runAutoScanAndPush)
 * ผ่าน chrome.storage.session — ไม่ใช้ query string เพราะ PK03 ห้าม release bundle อ่าน
 * location.search/URLSearchParams เด็ดขาด (กันช่องสั่งโหมดพิเศษจากภายนอก) · storage.session อยู่ใน
 * หน่วยความจำของ extension เท่านั้น หน้าเว็บภายนอกเขียนไม่ได้ · คำสั่งใช้ได้ครั้งเดียว (อ่านแล้วลบ)
 * และหมดอายุเร็ว กันคำสั่งค้างไปจุดชนวนตอนผู้ใช้เปิดหน้าจัดการเองทีหลัง
 */
const AUTO_SCAN_REQUEST_KEY = 'autoScanRequestedAt'
const AUTO_SCAN_REQUEST_TTL_MS = 15_000

export async function requestAutoScan(): Promise<void> {
  await chrome.storage.session.set({ [AUTO_SCAN_REQUEST_KEY]: Date.now() })
}

export async function consumeAutoScanRequest(now: number = Date.now()): Promise<boolean> {
  const stored = (await chrome.storage.session.get(AUTO_SCAN_REQUEST_KEY)) as Record<string, unknown>
  const requestedAt = stored[AUTO_SCAN_REQUEST_KEY]
  if (requestedAt === undefined) return false
  await chrome.storage.session.remove(AUTO_SCAN_REQUEST_KEY)
  return typeof requestedAt === 'number' && now - requestedAt >= 0 && now - requestedAt <= AUTO_SCAN_REQUEST_TTL_MS
}
