import { describe, it, expect } from 'vitest'
import { isExternalRequest } from '../e2e/helpers/network.js'

describe('PK04 — ตัวจำแนก request ต้อง deny-by-default', () => {
  it('ถือว่า host ภายนอกเป็น external ทุก scheme', () => {
    for (const url of [
      'https://shop.tiktok.com/api/v1/x',
      'http://example.test/ping',
      'wss://evil.test/socket',
      'ws://evil.test/socket',
      'ftp://files.test/a',
    ]) {
      expect(isExternalRequest(url), url).toBe(true)
    }
  })

  it('ปล่อย scheme ภายในและปลายทาง loopback', () => {
    for (const url of [
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/dashboard/index.html',
      'devtools://devtools/bundled/x.js',
      'data:text/plain,hello',
      'blob:chrome-extension://abc/123',
      'http://127.0.0.1:45871/probe',
      'http://localhost:8080/x',
      'ws://127.0.0.1:1234/socket',
    ]) {
      expect(isExternalRequest(url), url).toBe(false)
    }
  })

  it('URL ที่ parse ไม่ได้ถือว่าน่าสงสัย ไม่ใช่ปล่อยผ่าน', () => {
    expect(isExternalRequest('not a url')).toBe(true)
  })
})
