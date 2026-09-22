import { describe, it, expect } from 'vitest'
import {
  countSelectedInFilter,
  deselectAllInFilter,
  productsInFilter,
  selectAllInFilter,
  toggleSelection,
} from '../../extension/src/dashboard/selection.js'
import type { NormalizedProduct } from '../../extension/src/domain/product.js'

const product = (id: string, eligibility: NormalizedProduct['eligibility']): NormalizedProduct => ({
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
  eligibility,
  eligibilityBasis: 'adapter-rule-v1-unverified',
  imageUrls: [],
  shopName: null,
  observedAt: '2026-09-19T10:00:00Z',
  validationWarnings: [],
})

const CATALOG: NormalizedProduct[] = [
  product('P0', 'candidate'),
  product('P1', 'unknown'),
  product('P2', 'candidate'),
  product('P3', 'unavailable'),
  product('P4', 'out_of_stock'),
  product('P5', 'candidate'),
]

describe('UI01 — productsInFilter (§8.3)', () => {
  it('candidate filter คืนเฉพาะ eligibility=candidate', () => {
    const result = productsInFilter(CATALOG, 'candidate')
    expect(result.map((p) => p.productId)).toEqual(['P0', 'P2', 'P5'])
  })

  it('other filter คืนทุกอย่างที่ไม่ใช่ candidate (unknown/unavailable/out_of_stock รวมกัน)', () => {
    const result = productsInFilter(CATALOG, 'other')
    expect(result.map((p) => p.productId)).toEqual(['P1', 'P3', 'P4'])
  })
})

describe('UI01 — Select all หมายถึงทุกแถวที่ผ่าน filter ไม่ใช่ทุก record', () => {
  it('select all ใน candidate filter ไม่แตะแถวนอก filter', () => {
    const filtered = productsInFilter(CATALOG, 'candidate')
    const selected = selectAllInFilter(new Set(), filtered)
    expect([...selected].sort()).toEqual(['P0', 'P2', 'P5'])
    expect(selected.has('P1')).toBe(false)
  })

  it('select all ไม่ล้าง selection เดิมที่อยู่นอก filter', () => {
    const filtered = productsInFilter(CATALOG, 'candidate')
    const existing = new Set(['P3'])
    const selected = selectAllInFilter(existing, filtered)
    expect(selected.has('P3')).toBe(true)
    expect([...selected].sort()).toEqual(['P0', 'P2', 'P3', 'P5'])
  })

  it('จำนวนที่เลือกตรงกับจำนวนใน filter เป๊ะ (ปุ่มบอกจำนวนชัด)', () => {
    const filtered = productsInFilter(CATALOG, 'candidate')
    const selected = selectAllInFilter(new Set(), filtered)
    expect(countSelectedInFilter(selected, filtered)).toBe(filtered.length)
    expect(filtered.length).toBe(3)
  })

  it('deselect all ใน filter ลบเฉพาะแถวใน filter ไม่แตะที่อื่น', () => {
    const filtered = productsInFilter(CATALOG, 'candidate')
    const allSelected = new Set(['P0', 'P1', 'P2', 'P3', 'P5'])
    const cleared = deselectAllInFilter(allSelected, filtered)
    expect([...cleared].sort()).toEqual(['P1', 'P3'])
  })

  it('เลือกซ้ำหลายครั้งไม่ทำให้จำนวนเพี้ยน (idempotent)', () => {
    const filtered = productsInFilter(CATALOG, 'candidate')
    const once = selectAllInFilter(new Set(), filtered)
    const twice = selectAllInFilter(once, filtered)
    expect(countSelectedInFilter(twice, filtered)).toBe(3)
  })
})

describe('toggleSelection — สลับสถานะเลือกทีละแถว', () => {
  it('toggle แถวที่ยังไม่เลือก → เลือก', () => {
    const result = toggleSelection(new Set(), 'P0')
    expect(result.has('P0')).toBe(true)
  })

  it('toggle แถวที่เลือกอยู่แล้ว → ยกเลิก', () => {
    const result = toggleSelection(new Set(['P0']), 'P0')
    expect(result.has('P0')).toBe(false)
  })

  it('ไม่แก้ Set เดิม (immutable)', () => {
    const original = new Set(['P0'])
    toggleSelection(original, 'P1')
    expect(original.has('P1')).toBe(false)
  })
})

describe('default ไม่เลือกอะไร (§8.3)', () => {
  it('countSelectedInFilter บน Set ว่างคือ 0', () => {
    const filtered = productsInFilter(CATALOG, 'candidate')
    expect(countSelectedInFilter(new Set(), filtered)).toBe(0)
  })
})
