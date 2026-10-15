import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { violations, resetViolations, assertNoViolations } from '../setup/network-violations.js'

describe('IT01 — network deny-by-default (R15)', () => {
  it('ปฏิเสธ fetch ทุกกรณีใน test environment', () => {
    expect(() => fetch('https://shop.tiktok.com/api/v1/streamer_desktop/showcase_product/list'))
      .toThrow(/E_NETWORK_DENIED/)
    resetViolations()
  })

  it('ปฏิเสธ TCP connect ไป host ที่ไม่ใช่ loopback', () => {
    expect(() => net.connect({ host: '93.184.216.34', port: 443 })).toThrow(/E_NETWORK_DENIED/)
    resetViolations()
  })

  it('ปฏิเสธ WebSocket และ XMLHttpRequest', () => {
    const g = globalThis as unknown as Record<string, new (...a: unknown[]) => unknown>
    expect(() => new g.WebSocket!('ws://127.0.0.1:43187')).toThrow(/E_NETWORK_DENIED/)
    expect(() => new g.XMLHttpRequest!()).toThrow(/E_NETWORK_DENIED/)
    resetViolations()
  })

  it('guard ถอดออกไม่ได้ — reassign globalThis.fetch ต้อง throw', () => {
    expect(() => {
      ;(globalThis as unknown as Record<string, unknown>).fetch = () => undefined
    }).toThrow()
  })

  it('บันทึกความพยายามต่อ network ลง ledger แม้ error ถูกกลืน', () => {
    resetViolations()
    try {
      fetch('https://shop.tiktok.com/api/v1/x')
    } catch {
      /* กลืนโดยตั้งใจ — จำลองโค้ดที่มี fallback */
    }
    expect(violations).toHaveLength(1)
    expect(violations[0]?.target).toContain('shop.tiktok.com')
    resetViolations()
  })

  it('vitest.config.ts ต้องโหลด setup file เสมอ — กันคนถอดออกเงียบ ๆ', () => {
    const cfg = readFileSync('vitest.config.ts', 'utf8')
    expect(cfg).toContain('tests/setup/no-network.ts')
  })

  it('IT01 — ledger ที่ไม่ว่างทำให้ run แดงจริง ไม่ใช่แค่บันทึกไว้เฉย ๆ', () => {
    resetViolations()
    try {
      fetch('https://shop.tiktok.com/api/v1/x')
    } catch {
      /* กลืนโดยตั้งใจ — จำลองโค้ดที่ catch แล้วไม่บอกใคร */
    }
    expect(() => assertNoViolations()).toThrow(/E_NETWORK_DENIED/)
    // assertNoViolations ล้าง ledger ให้แล้ว จึงไม่ทำให้ afterEach ของ test นี้แดงตาม
    expect(violations).toHaveLength(0)
  })

  it('IT01 — ledger ว่างแล้ว assertNoViolations ต้องไม่ throw', () => {
    resetViolations()
    expect(() => assertNoViolations()).not.toThrow()
  })
})
