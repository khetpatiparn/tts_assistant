// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_PAGE_SIZE, renderPreviewPage, totalPages } from '../../extension/src/dashboard/preview.js'
import type { NormalizedProduct } from '../../extension/src/domain/product.js'

const product = (id: string, overrides: Partial<NormalizedProduct> = {}): NormalizedProduct => ({
  schemaVersion: 1,
  sourceRef: 'local-profile-01',
  sourceIdentityVerified: false,
  productId: id,
  title: `สินค้า ${id}`,
  priceDisplay: '฿10.00',
  priceAmountDecimal: null,
  currency: null,
  stockQuantity: 1,
  stockStatusRaw: 1,
  reviewStatusRaw: 1,
  canAddRaw: null,
  commissionRate: null,
  eligibility: 'unknown',
  eligibilityBasis: 'adapter-rule-v1-unverified',
  imageUrls: [],
  shopName: null,
  observedAt: '2026-09-19T10:00:00Z',
  validationWarnings: [],
  ...overrides,
})

describe('UI05 — 5,000 rows ต้องใช้ local pagination ไม่สร้าง DOM ทั้งชุด', () => {
  it('render หน้าแรกได้แค่ pageSize แถว ไม่ใช่ 5000', () => {
    const products = Array.from({ length: 5000 }, (_, i) => product(`P${String(i)}`))
    const container = document.createElement('div')
    renderPreviewPage(container, products, new Set(), { page: 0, pageSize: 50 }, () => undefined)
    expect(container.querySelectorAll('.product-row')).toHaveLength(50)
  })

  it('เปลี่ยนหน้าแล้วแถวที่แสดงเปลี่ยนตาม ไม่สะสมค้าง (clear ก่อน render)', () => {
    const products = Array.from({ length: 200 }, (_, i) => product(`P${String(i)}`))
    const container = document.createElement('div')
    renderPreviewPage(container, products, new Set(), { page: 0, pageSize: 50 }, () => undefined)
    renderPreviewPage(container, products, new Set(), { page: 1, pageSize: 50 }, () => undefined)
    expect(container.querySelectorAll('.product-row')).toHaveLength(50)
    const ids = [...container.querySelectorAll('input[type=checkbox]')].map(
      (el) => (el as HTMLInputElement).dataset['productId'],
    )
    expect(ids[0]).toBe('P50')
    expect(ids.at(-1)).toBe('P99')
  })

  it('totalPages คำนวณถูกต้องและมีอย่างน้อยหนึ่งหน้าแม้ list ว่าง', () => {
    expect(totalPages(5000, 50)).toBe(100)
    expect(totalPages(0, 50)).toBe(1)
    expect(totalPages(1, 50)).toBe(1)
  })

  it('ค่า default page size สมเหตุสมผล (ไม่ใช่ 5000)', () => {
    expect(DEFAULT_PAGE_SIZE).toBeLessThan(500)
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThan(0)
  })
})

describe('UI04 — title ไทยยาว, ภาพหาย, คีย์บอร์ด/checkbox ใช้งานได้', () => {
  it('title ภาษาไทยยาว 2000 ตัวอักษรแสดงครบไม่ถูกตัด', () => {
    const longTitle = 'ก'.repeat(2000)
    const container = document.createElement('div')
    renderPreviewPage(container, [product('P0', { title: longTitle })], new Set(), { page: 0 }, () => undefined)
    const titleEl = container.querySelector('.product-title')
    expect(titleEl?.textContent).toBe(longTitle)
  })

  it('ไม่มีรูปภาพ (imageUrls ว่าง) แสดง placeholder แทน <img> ที่พัง', () => {
    const container = document.createElement('div')
    renderPreviewPage(container, [product('P0', { imageUrls: [] })], new Set(), { page: 0 }, () => undefined)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.product-image')?.textContent).toContain('ไม่มีรูปภาพ')
  })

  it('มีรูปเดียว — โชว์แค่ thumbnail ไม่มีปุ่มขยาย/badge เพราะไม่มีอะไรให้ขยายดู', () => {
    const container = document.createElement('div')
    const urls = ['https://p16-oec-sg.ibyteimg.com/a.jpeg']
    renderPreviewPage(container, [product('P0', { imageUrls: urls })], new Set(), { page: 0 }, () => undefined)
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('.product-image-count')).toBeNull()
    expect(container.querySelector('.product-image-gallery')).toBeNull()
  })

  it('มีหลายรูป — preview โชว์แค่รูปแรกเป็น thumbnail ก่อน พร้อม badge บอกจำนวนที่เหลือ', () => {
    const container = document.createElement('div')
    const urls = [
      'https://p16-oec-sg.ibyteimg.com/a.jpeg',
      'https://p19-oec-sg.ibyteimg.com/b.jpeg',
      'https://p16-oec-va.ibyteimg.com/c.jpeg',
    ]
    renderPreviewPage(container, [product('P0', { imageUrls: urls })], new Set(), { page: 0 }, () => undefined)

    const toggle = container.querySelector('.product-image-toggle') as HTMLButtonElement
    expect(toggle).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.product-image-count')?.textContent).toBe('+2')

    const gallery = container.querySelector('.product-image-gallery') as HTMLElement
    expect(gallery.hidden).toBe(true)
    // gallery มีครบทุกรูปรวมรูปแรก (ไม่ใช่แค่ที่เหลือ) — ยืนยันว่าดึงได้ครบจริงตามที่ทดสอบไว้ก่อนหน้า
    expect(gallery.querySelectorAll('img')).toHaveLength(urls.length)
    expect([...gallery.querySelectorAll('img')].map((img) => (img as HTMLImageElement).src)).toEqual(urls)
  })

  it('กดปุ่ม thumbnail แล้ว gallery เปิด/ปิดสลับกันได้ (ไม่ต้อง render ใหม่)', () => {
    const container = document.createElement('div')
    const urls = ['https://p16-oec-sg.ibyteimg.com/a.jpeg', 'https://p19-oec-sg.ibyteimg.com/b.jpeg']
    renderPreviewPage(container, [product('P0', { imageUrls: urls })], new Set(), { page: 0 }, () => undefined)

    const toggle = container.querySelector('.product-image-toggle') as HTMLButtonElement
    const gallery = container.querySelector('.product-image-gallery') as HTMLElement
    expect(gallery.hidden).toBe(true)

    toggle.click()
    expect(gallery.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    toggle.click()
    expect(gallery.hidden).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('checkbox เป็น native input — focusable และกดแล้วเรียก onToggle ได้ (คีย์บอร์ดใช้ได้โดยไม่ต้องเขียน handler เอง)', () => {
    const container = document.createElement('div')
    const onToggle = vi.fn()
    renderPreviewPage(container, [product('P0')], new Set(), { page: 0 }, onToggle)
    const checkbox = container.querySelector('input[type=checkbox]') as HTMLInputElement
    expect(checkbox.tagName).toBe('INPUT')
    expect(checkbox.tabIndex).toBeGreaterThanOrEqual(0)
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    expect(onToggle).toHaveBeenCalledWith('P0')
  })

  it('checkbox มี accessible name ผ่าน label ที่ครอบ (ไม่ใช่แค่ title attribute)', () => {
    const container = document.createElement('div')
    renderPreviewPage(container, [product('P0', { title: 'ทดสอบ label' })], new Set(), { page: 0 }, () => undefined)
    const checkbox = container.querySelector('input[type=checkbox]')
    expect(checkbox?.closest('label')?.textContent).toContain('ทดสอบ label')
  })

  it('checkbox สะท้อนสถานะที่เลือกไว้แล้วถูกต้อง', () => {
    const container = document.createElement('div')
    renderPreviewPage(container, [product('P0'), product('P1')], new Set(['P1']), { page: 0 }, () => undefined)
    const boxes = [...container.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[]
    expect(boxes[0]?.checked).toBe(false)
    expect(boxes[1]?.checked).toBe(true)
  })
})

describe('UT09 (เต็มรูปแบบ) — render product rows จริง ต้องไม่เกิด code execution', () => {
  const XSS = '<img src=x onerror="globalThis.__previewPwned=1"> ครีมทดสอบ'

  it('title ที่เป็น HTML render เป็นข้อความ ไม่สร้าง element และไม่รันโค้ด', () => {
    const container = document.createElement('div')
    renderPreviewPage(container, [product('P0', { title: XSS })], new Set(), { page: 0 }, () => undefined)
    expect(container.querySelector('.product-title')?.textContent).toBe(XSS)
    expect(container.querySelector('.product-title img')).toBeNull()
    expect((globalThis as Record<string, unknown>)['__previewPwned']).toBeUndefined()
  })

  it('shopName ที่เป็น HTML ก็ต้องปลอดภัยเช่นกัน', () => {
    const container = document.createElement('div')
    renderPreviewPage(
      container,
      [product('P0', { shopName: '<script>globalThis.__previewPwned2=1</script>' })],
      new Set(),
      { page: 0 },
      () => undefined,
    )
    expect(container.querySelector('script')).toBeNull()
    expect((globalThis as Record<string, unknown>)['__previewPwned2']).toBeUndefined()
  })

  it('ไม่มี innerHTML/insertAdjacentHTML ในไฟล์นี้ (ครอบคลุมด้วย static guard ของ dom-safety.test.ts อยู่แล้ว แต่ตรวจซ้ำเพื่อความชัดเจน)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('extension/src/dashboard/preview.ts', 'utf8')
    expect(src).not.toMatch(/\.(innerHTML|outerHTML)\s*=/)
    expect(src).not.toContain('insertAdjacentHTML')
  })
})
