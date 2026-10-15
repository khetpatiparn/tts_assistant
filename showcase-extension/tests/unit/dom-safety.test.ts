// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { globSync, readFileSync } from 'node:fs'
import { setText, appendLabeledRow } from '../../extension/src/dashboard/dom.js'

describe('UT09 baseline — DOM rendering ปลอดภัย (R11/V11)', () => {
  const XSS = '<img src=x onerror="globalThis.__pwned=1"> สินค้า &amp; ทดสอบ'

  it('setText เก็บข้อความตรงตัวและไม่สร้าง element', () => {
    const el = document.createElement('div')
    setText(el, XSS)
    expect(el.textContent).toBe(XSS)
    expect(el.querySelector('img')).toBeNull()
    expect((globalThis as Record<string, unknown>)['__pwned']).toBeUndefined()
  })

  it('appendLabeledRow ไม่ตีความ HTML ทั้งใน label และ value', () => {
    const parent = document.createElement('div')
    appendLabeledRow(parent, '<b>ชื่อ</b>', XSS)
    expect(parent.querySelectorAll('b, img')).toHaveLength(0)
    expect(parent.textContent).toContain(XSS)
  })

  it('ไม่มีไฟล์ใดใน extension/src ใช้ innerHTML/outerHTML/insertAdjacentHTML/eval', () => {
    const files = globSync('extension/src/**/*.ts')
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/\.(innerHTML|outerHTML)\s*=/)
      expect(src, file).not.toContain('insertAdjacentHTML')
      expect(src, file).not.toContain('document.write')
      expect(src, file).not.toMatch(/\beval\s*\(/)
      expect(src, file).not.toMatch(/new\s+Function\s*\(/)
    }
  })

  it('หน้า HTML ไม่มี inline script และไม่โหลด script จาก remote (CSP)', () => {
    const pages = globSync('extension/src/**/*.html')
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) {
      const html = readFileSync(page, 'utf8')
      expect(html, page).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/)
      expect(html, page).not.toMatch(/<script[^>]+src=["']https?:/)
      expect(html, page).not.toMatch(/\son[a-z]+\s*=/i)
    }
  })
})
