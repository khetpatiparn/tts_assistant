import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createMockShowcaseAdapter } from '../../extension/src/adapters/mock-showcase.js'
import { ADAPTER_VERSION_MOCK, SCHEMA_VERSION } from '../../extension/src/domain/version.js'
import { resetViolations } from '../setup/network-violations.js'

const fx01 = readFileSync('tests/fixtures/synthetic/fx01-first-page.json', 'utf8')
const fx03 = readFileSync('tests/fixtures/synthetic/fx03-empty-page.json', 'utf8')

describe('mock adapter (R15)', () => {
  it('SCHEMA_VERSION ถูกล็อกไว้ที่ 1', () => {
    expect(SCHEMA_VERSION).toBe(1)
  })

  it('ประกาศตัวเองเป็น mock พร้อม adapterVersion', () => {
    const a = createMockShowcaseAdapter()
    expect(a.mode).toBe('mock')
    expect(a.adapterVersion).toBe(ADAPTER_VERSION_MOCK)
  })

  it('คืน bodyText ดิบโดยไม่ parse — รักษา ID precision ไว้ให้ validator (V03)', async () => {
    const a = createMockShowcaseAdapter({ pages: [{ bodyText: fx01 }, { bodyText: fx03 }] })
    const page0 = await a.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)
    expect(page0.httpStatus).toBe(200)
    expect(typeof page0.bodyText).toBe('string')
    expect(page0.bodyText).toContain('1736749159048840633')
  })

  it('เลื่อน page ตามลำดับ script แล้วจบด้วย empty page', async () => {
    const a = createMockShowcaseAdapter({ pages: [{ bodyText: fx01 }, { bodyText: fx03 }] })
    const signal = new AbortController().signal
    await a.fetchPage({ offset: 0, count: 6 }, signal)
    const page1 = await a.fetchPage({ offset: 6, count: 6 }, signal)
    expect((JSON.parse(page1.bodyText) as { data: { products: unknown[] } }).data.products).toEqual([])
  })

  it('ทำงานได้ทั้งที่ network ถูกปิด — พิสูจน์ว่าไม่ยิงออกนอกเครื่อง (R15)', async () => {
    expect(() => fetch('https://shop.tiktok.com/')).toThrow(/E_NETWORK_DENIED/)
    resetViolations()
    const a = createMockShowcaseAdapter()
    await expect(a.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)).resolves.toBeDefined()
  })

  it('เคารพ AbortSignal ที่ถูกยกเลิกแล้ว', async () => {
    const controller = new AbortController()
    controller.abort()
    const a = createMockShowcaseAdapter()
    await expect(a.fetchPage({ offset: 0, count: 6 }, controller.signal)).rejects.toThrow(/aborted/i)
  })

  it('script หมดแล้วต้องแจ้ง error ไม่ใช่คืนหน้าว่างเงียบ ๆ', async () => {
    const a = createMockShowcaseAdapter({ pages: [{ bodyText: fx03 }] })
    const signal = new AbortController().signal
    await a.fetchPage({ offset: 0, count: 6 }, signal)
    await expect(a.fetchPage({ offset: 6, count: 6 }, signal)).rejects.toThrow(/mock_script_exhausted/)
  })

  it('V03 — catalog ปริยายมีแถวที่ส่ง product_id เป็นเลขไม่ใส่ quotes', async () => {
    const adapter = createMockShowcaseAdapter()
    const page = await adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal)

    // แถวแรกยังเป็น string ตามเดิม
    expect(page.bodyText).toContain('"product_id":"1736749159048840633"')
    // แถวที่ 2 และ 3 เป็นเลขเปล่า ซึ่ง JSON.parse ปกติจะปัดทิ้ง
    expect(page.bodyText).toContain('"product_id":1736749159048840634')
    expect(page.bodyText).toContain('"product_id":1736749159048840635')

    // พิสูจน์ว่า fixture นี้ทำให้ parser ปกติเสียหายจริง มิฉะนั้น test นี้ไม่มีความหมาย
    const naive = JSON.parse(page.bodyText) as { data: { products: { product_id: unknown }[] } }
    expect(String(naive.data.products[1]?.product_id)).not.toBe('1736749159048840634')
  })
})
