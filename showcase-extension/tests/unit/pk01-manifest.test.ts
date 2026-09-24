import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { APP_HOST_PERMISSION_ORIGIN, SHOWCASE_HOST_PERMISSION_ORIGIN } from '../../extension/src/domain/permissions.js'

const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8')) as Record<string, unknown>

const FORBIDDEN = [
  'cookies',
  'debugger',
  'nativeMessaging',
  'webRequest',
  'webRequestBlocking',
  'scripting',
  'activeTab',
  'tabs',
  'alarms',
  'downloads',
  'declarativeNetRequest',
  'proxy',
  'management',
  'history',
  'bookmarks',
  'privacy',
]

describe('PK01 — manifest สิทธิ์ขั้นต่ำ (R02)', () => {
  it('เป็น MV3', () => {
    expect(manifest.manifest_version).toBe(3)
  })

  it('permissions มีแค่ storage — ใช้ exact equality ไม่ใช่ denylist', () => {
    expect(manifest.permissions).toEqual(['storage'])
    expect(manifest.optional_permissions).toBeUndefined()
  })

  it('ไม่มี permission ต้องห้ามใด ๆ ปรากฏใน manifest', () => {
    const raw = JSON.stringify(manifest)
    for (const p of FORBIDDEN) expect(raw).not.toContain(`"${p}"`)
  })

  it('ไม่ขอ host permission แบบบังคับ และ optional host จำกัด shop.tiktok.com + แอปหลัก (localhost) เท่านั้น', () => {
    expect(manifest.host_permissions).toBeUndefined()
    expect(manifest.optional_host_permissions).toEqual([
      'https://shop.tiktok.com/*',
      'http://localhost:3000/*',
    ])
  })

  it('domain/permissions.ts (ที่ resolve.live.ts เช็คและปุ่ม dashboard ขอสิทธิ์) ตรงกับ manifest เป๊ะ — กัน drift', () => {
    expect(manifest.optional_host_permissions).toEqual([
      SHOWCASE_HOST_PERMISSION_ORIGIN,
      APP_HOST_PERMISSION_ORIGIN,
    ])
  })

  it('ไม่มี wildcard host กว้าง', () => {
    const raw = JSON.stringify(manifest)
    for (const bad of ['<all_urls>', '*://*/*', 'http://*/', 'https://*/*', 'https://*.tiktok.com']) {
      expect(raw).not.toContain(bad)
    }
  })

  it('ไม่มี content script และไม่เปิดให้เว็บส่ง message เข้ามา', () => {
    expect(manifest.content_scripts).toBeUndefined()
    expect(manifest.externally_connectable).toBeUndefined()
  })

  it('CSP ล็อก script-src self และไม่มี unsafe/remote source', () => {
    const csp =
      (manifest.content_security_policy as { extension_pages?: string } | undefined)?.extension_pages ?? ''
    expect(csp).toContain("script-src 'self'")
    for (const bad of ["'unsafe-eval'", "'unsafe-inline'", 'http://', 'https://', '*']) {
      expect(csp).not.toContain(bad)
    }
  })

  it('ไม่รองรับ incognito ตาม §7.1', () => {
    expect(manifest.incognito).toBe('not_allowed')
  })

  it('ไม่มี key/update_url/web_accessible_resources ที่ผูกกับ package ของคนอื่น (§3.2 ข้อ 7)', () => {
    expect(manifest.key).toBeUndefined()
    expect(manifest.update_url).toBeUndefined()
    expect(manifest.web_accessible_resources).toBeUndefined()
  })

  it('ชื่อระบุชัดว่ายังไม่พร้อมใช้งานจริง เพราะ G0 ยังไม่ผ่าน (§5.3)', () => {
    expect(String(manifest.name).toLowerCase()).toContain('not live-ready')
  })
})
