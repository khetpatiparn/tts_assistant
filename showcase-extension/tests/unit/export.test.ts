import { describe, it, expect } from 'vitest'
import { buildExport, buildProbeExport } from '../../extension/src/export/json.js'
import type { RunReport } from '../../extension/src/core/runner.js'
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

const baseReport = (products: NormalizedProduct[], overrides: Partial<RunReport> = {}): RunReport => ({
  runId: 'run-1',
  sourceRef: 'local-profile-01',
  adapterVersion: 'mock-v0',
  state: 'ready_complete',
  stopReason: 'endpoint_end',
  scanCoverage: 'reached_endpoint_end',
  dataQuality: 'clean',
  snapshotConsistency: 'unverified',
  counters: {
    requests: 1,
    successfulPages: 1,
    receivedRows: products.length,
    invalidRows: 0,
    duplicateValidRows: 0,
    uniqueValidProducts: products.length,
    candidates: 0,
    otherStatus: 0,
    unknownStatus: products.length,
  },
  productIds: products.map((p) => p.productId),
  products,
  quarantined: [],
  firstOffset: 0,
  pageSizeReductions: 0,
  observedIdentity: null,
  sourceIdentityVerified: false,
  changedWithinRun: false,
  warnings: [],
  resumeAfterMs: null,
  ...overrides,
})

describe('UI02 — export เฉพาะสินค้าที่เลือก', () => {
  it('เลือก 3 จาก 6 → export มี 3 ID ตรงที่เลือก ไม่มีแถวอื่น', () => {
    const products = Array.from({ length: 6 }, (_, i) => product(`P${String(i)}`))
    const report = baseReport(products)
    const payload = buildExport(report, ['P1', 'P3', 'P5'], () => 0)
    expect(payload.selectedProductIds).toEqual(['P1', 'P3', 'P5'])
    expect(payload.products.map((p) => p.productId)).toEqual(['P1', 'P3', 'P5'])
  })

  it('ID ที่ไม่มีอยู่จริงใน report ถูกตัดทิ้งอย่างเงียบ ๆ ไม่ throw', () => {
    const report = baseReport([product('P0')])
    const payload = buildExport(report, ['P0', 'GHOST'], () => 0)
    expect(payload.selectedProductIds).toEqual(['P0'])
  })

  it('ID ซ้ำใน selection ถูก dedupe', () => {
    const report = baseReport([product('P0'), product('P1')])
    const payload = buildExport(report, ['P0', 'P0', 'P1'], () => 0)
    expect(payload.selectedProductIds).toEqual(['P0', 'P1'])
  })

  it('ลำดับใน products ตามลำดับของ report ไม่ใช่ตามลำดับที่ผู้ใช้กดเลือก', () => {
    const report = baseReport([product('P0'), product('P1'), product('P2')])
    const payload = buildExport(report, ['P2', 'P0'], () => 0)
    expect(payload.products.map((p) => p.productId)).toEqual(['P0', 'P2'])
  })

  it('ไม่เลือกอะไรเลย → export ว่างแต่ไม่ throw', () => {
    const report = baseReport([product('P0')])
    const payload = buildExport(report, [], () => 0)
    expect(payload.selectedProductIds).toEqual([])
    expect(payload.products).toEqual([])
  })
})

describe('UI03 — export ของ partial/unknown ต้องมี metadata ตรงจริง ไม่ใช่ success ครบ', () => {
  it('partial run ที่ export ยังคง scanCoverage/dataQuality ตามจริง', () => {
    const report = baseReport([product('P0')], {
      state: 'ready_partial',
      stopReason: 'auth_required',
      scanCoverage: 'partial',
      dataQuality: 'warnings',
    })
    const payload = buildExport(report, ['P0'], () => 0)
    expect(payload.scanCoverage).toBe('partial')
    expect(payload.dataQuality).toBe('warnings')
  })

  it('ไม่มี field ที่ไม่อยู่ใน allowlist ของ §10 (ไม่มี headers/token/warnings ของ run)', () => {
    const report = baseReport([product('P0')])
    const payload = buildExport(report, ['P0'], () => 0)
    expect(Object.keys(payload).sort()).toEqual(
      [
        'adapterVersion',
        'dataQuality',
        'exportedAt',
        'products',
        'resultKind',
        'runId',
        'scanCoverage',
        'selectedProductIds',
        'sourceRef',
        'stopReason',
      ].sort(),
    )
    // ไฟล์บอกตัวเองได้ว่ามาจาก full scan ไม่ใช่ผลทดสอบหนึ่งหน้า
    expect(payload.resultKind).toBe('full_scan')
  })

  it('exportedAt มาจาก clock ที่ inject ได้ ไม่ผูกกับ Date.now() ของเครื่องตรง ๆ', () => {
    const report = baseReport([product('P0')])
    const payload = buildExport(report, ['P0'], () => Date.parse('2026-09-19T10:00:00.000Z'))
    expect(payload.exportedAt).toBe('2026-09-19T10:00:00.000Z')
  })

  it('secret canary ที่หลุดเข้ามาใน product (ถ้ามี) ไม่ถูกขยายผ่าน field อื่นเพิ่ม', () => {
    const report = baseReport([product('P0', { shopName: 'shop CANARY_XYZ' })])
    const payload = buildExport(report, ['P0'], () => 0)
    const serialized = JSON.stringify(payload)
    expect(serialized.match(/CANARY_XYZ/g)).toHaveLength(1)
  })
})

/**
 * export ของ **ผลทดสอบหนึ่งหน้า** — ใช้ exporter/shape เดิม แต่ห้ามอ้างว่าเป็นข้อมูลครบทั้ง Showcase
 */
describe('buildProbeExport — ผลทดสอบหนึ่งหน้าต้องบอกตัวเองว่าไม่ใช่ผลสแกนครบ', () => {
  const input = {
    adapterVersion: 'live-v1',
    sourceRef: 'local-profile-01',
    products: [product('P0'), product('P1')],
  }

  it('resultKind เป็น single_page_probe และ scanCoverage เป็น partial เสมอ', () => {
    const payload = buildProbeExport(input, () => 1_700_000_000_000)
    expect(payload.resultKind).toBe('single_page_probe')
    // หนึ่งหน้าไม่เคยเป็น reached_endpoint_end แม้หน้านั้นจะอ่านครบทุกแถวก็ตาม
    expect(payload.scanCoverage).toBe('partial')
  })

  it('runId เป็น probe-<timestamp> ไม่ใช่ runId ของ run จริง เพราะไม่มี run เกิดขึ้น', () => {
    const payload = buildProbeExport(input, () => 1_700_000_000_000)
    expect(payload.runId).toBe('probe-1700000000000')
    expect(payload.exportedAt).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('ส่งออกทุกแถวที่อ่านได้ในหน้านั้นตามที่เห็น ไม่มีการกรอง', () => {
    const payload = buildProbeExport(input, () => 0)
    expect(payload.products).toHaveLength(2)
    expect(payload.selectedProductIds).toEqual(['P0', 'P1'])
  })

  it('dataQuality สะท้อน warning จริงของแถว ไม่ปัดให้เป็น clean เสมอ', () => {
    expect(buildProbeExport(input, () => 0).dataQuality).toBe('clean')
    const withWarning = {
      ...input,
      products: [product('P0', { validationWarnings: ['status_semantics_unverified'] })],
    }
    expect(buildProbeExport(withWarning, () => 0).dataQuality).toBe('warnings')
  })

  it('key set ตรงกับ allowlist เดียวกับ full scan — ไม่มี field พิเศษแอบเพิ่ม', () => {
    const probe = buildProbeExport(input, () => 0)
    const full = buildExport(baseReport([product('P0')]), ['P0'], () => 0)
    expect(Object.keys(probe).sort()).toEqual(Object.keys(full).sort())
  })
})
