import { APP_HOST_PERMISSION_ORIGIN } from '../domain/permissions.js'

/**
 * การเชื่อมต่อกับแอปหลัก (Angle / pooling_prompt บน localhost:3000) — ใช้ร่วมกันระหว่าง popup
 * (ไฟสถานะ + เปิด/ปิดปุ่ม "สแกนสินค้าใหม่ → ส่งเข้า Angle") และหน้าจัดการ (known-ids + ส่งเข้าแอป)
 *
 * ทุก endpoint ของแอปหลักต้องตอบ CORS เอง — host permission ไม่ได้ยกเว้น CORS (ดู lib/cors.ts
 * ของแอปหลัก)
 */
export const APP_KNOWN_IDS_URL = 'http://localhost:3000/api/showcase-import/known-ids'
export const APP_IMPORT_URL = 'http://localhost:3000/api/showcase-import'
export const APP_HEALTH_URL = 'http://localhost:3000/api/showcase-import/health'

/**
 * x-showcase-secret ต้องตรงกับ SHOWCASE_IMPORT_SECRET ใน .env ของแอปหลัก — เก็บที่
 * chrome.storage.local เท่านั้น (ไม่ใช่ .sync — PK02 ห้ามไว้) ผู้ใช้วางเองครั้งเดียวในหน้าจัดการ
 */
export const APP_SECRET_STORAGE_KEY = 'showcaseImportSecret'

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

export type AppConnection =
  /** ยังไม่ได้กดอนุญาตให้เข้าถึง localhost:3000 (ทำครั้งเดียวในหน้าจัดการ) */
  | { readonly kind: 'no_permission' }
  /** ยังไม่ได้วางรหัสเชื่อมต่อ — สแกนได้แต่ส่งเข้าแอปไม่ผ่าน */
  | { readonly kind: 'no_secret' }
  /** แอปหลักไม่ตอบ = ยังไม่ได้เปิด start.bat */
  | { readonly kind: 'offline' }
  /** แอปตอบแล้วแต่รหัสที่บันทึกไว้ไม่ตรงกับ .env */
  | { readonly kind: 'bad_secret' }
  | { readonly kind: 'ready'; readonly productCount: number; readonly lastImportAt: string | null }

export interface AppLinkDeps {
  readonly hasPermission: () => Promise<boolean>
  readonly getSecret: () => Promise<string>
  readonly fetchImpl: typeof fetch
}

export async function getSavedAppSecret(): Promise<string> {
  const stored = (await chrome.storage.local.get(APP_SECRET_STORAGE_KEY)) as Record<string, unknown>
  const value = stored[APP_SECRET_STORAGE_KEY]
  return typeof value === 'string' ? value : ''
}

export const defaultAppLinkDeps = (): AppLinkDeps => ({
  hasPermission: () => chrome.permissions.contains({ origins: [APP_HOST_PERMISSION_ORIGIN] }),
  getSecret: getSavedAppSecret,
  fetchImpl: (...args) => fetch(...args),
})

/**
 * ลำดับการเช็ค: เรื่องตั้งค่าครั้งเดียว (สิทธิ์ → รหัส) ก่อนเรื่องประจำวัน (แอปเปิดไหม) — ไม่มีสิทธิ์
 * ก็ยิงไปถามแอปไม่ได้อยู่แล้ว · ไม่ throw ออกจากฟังก์ชันนี้เด็ดขาด (popup ต้องแสดงผลได้เสมอ)
 */
export async function checkAppConnection(deps: AppLinkDeps = defaultAppLinkDeps()): Promise<AppConnection> {
  try {
    if (!(await deps.hasPermission())) return { kind: 'no_permission' }
    const secret = await deps.getSecret()
    if (secret === '') return { kind: 'no_secret' }

    let body: { secretOk?: unknown; productCount?: unknown; lastImportAt?: unknown }
    try {
      const response = await deps.fetchImpl(APP_HEALTH_URL, {
        headers: { 'x-showcase-secret': secret },
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) return { kind: 'offline' }
      body = (await response.json()) as typeof body
    } catch {
      return { kind: 'offline' }
    }

    if (body.secretOk !== true) return { kind: 'bad_secret' }
    return {
      kind: 'ready',
      productCount: typeof body.productCount === 'number' ? body.productCount : 0,
      lastImportAt: typeof body.lastImportAt === 'string' ? body.lastImportAt : null,
    }
  } catch {
    return { kind: 'offline' }
  }
}

/** "3 วันก่อน" / "วันนี้" — สำหรับบรรทัด "นำเข้าล่าสุด" บน popup */
export function relativeDaysThai(iso: string, now: number): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'ไม่ทราบ'
  const days = Math.floor((now - then) / 86_400_000)
  if (days <= 0) return 'วันนี้'
  if (days === 1) return 'เมื่อวาน'
  return `${String(days)} วันก่อน`
}
