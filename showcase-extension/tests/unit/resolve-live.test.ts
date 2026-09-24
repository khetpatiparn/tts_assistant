import { describe, it, expect } from 'vitest'
import { resolveAdapter } from '../../extension/src/adapters/resolve.live.js'
import { ScannerError } from '../../extension/src/domain/errors.js'
import {
  ADAPTER_VERSION_LIVE,
  G0_TECHNICAL_EVIDENCE_COMPLETE,
  G0_VERIFIED,
  OWNER_MANUAL_PROBE_AUTHORIZED,
  OWNER_MANUAL_SCAN_AUTHORIZED,
  TIKTOK_AUTOMATED_ACCESS_AUTHORIZED,
} from '../../extension/src/domain/version.js'
import { violations } from '../setup/network-violations.js'

/**
 * Gate ของ release channel — แยกสามเรื่องที่เคยปนกัน (ดู domain/version.ts)
 * เทสต์ชุดนี้ล็อกไว้ว่า "อะไรเปิด อะไรปิด และเปิดด้วยเหตุผลอะไร" ไม่ให้เลื่อนไหลโดยไม่ตั้งใจ
 */
describe('ค่า gate ทั้งสามตัวต้องเป็นไปตามสถานะที่บันทึกไว้จริง', () => {
  it('หลักฐานเทคนิคครบแล้ว (G0 §5.3 ข้อ 1–5)', () => {
    expect(G0_TECHNICAL_EVIDENCE_COMPLETE).toBe(true)
  })

  it('เจ้าของโปรเจกต์อนุญาตให้ทดลอง manual หนึ่งหน้าในรอบนี้', () => {
    expect(OWNER_MANUAL_PROBE_AUTHORIZED).toBe(true)
  })

  it('เจ้าของโปรเจกต์อนุญาตให้ทดลอง manual หลายหน้าจนจบในรอบนี้ (คนละค่ากับข้อบน)', () => {
    expect(OWNER_MANUAL_SCAN_AUTHORIZED).toBe(true)
  })

  it('TikTok **ยังไม่** อนุญาตการเข้าถึงอัตโนมัติ — ค่านี้ห้ามเป็น true จนกว่าจะมีหนังสืออนุญาตจริง', () => {
    expect(TIKTOK_AUTOMATED_ACCESS_AUTHORIZED).toBe(false)
  })

  it('G0_VERIFIED (gate รวมของ full scan) ยังเป็น false', () => {
    expect(G0_VERIFIED).toBe(false)
  })
})

describe('resolveAdapter — gate แยกตาม purpose ไม่ใช่ค่าเดียวคุมทุกอย่าง', () => {
  it('full_scan ถูกปฏิเสธด้วย g0_not_verified (TikTok ยังไม่อนุญาต)', () => {
    expect(() => resolveAdapter('full_scan')).toThrow(ScannerError)
    try {
      resolveAdapter('full_scan')
      throw new Error('ต้อง throw ก่อนถึงบรรทัดนี้')
    } catch (error) {
      expect((error as ScannerError).code).toBe('g0_not_verified')
    }
  })

  it('ค่า default ของ purpose คือ full_scan — ลืมระบุแล้วต้องได้เส้นทางที่เข้มที่สุด ไม่ใช่หลวมที่สุด', () => {
    expect(() => resolveAdapter()).toThrow(/g0_not_verified/)
  })

  it('manual_probe ได้ adapter จริง เพราะหลักฐานเทคนิคครบ + เจ้าของโปรเจกต์อนุญาต', () => {
    const adapter = resolveAdapter('manual_probe')
    expect(adapter.mode).toBe('live')
    expect(adapter.adapterVersion).toBe(ADAPTER_VERSION_LIVE)
  })

  it('manual_scan ได้ adapter จริง เพราะหลักฐานเทคนิคครบ + เจ้าของโปรเจกต์อนุญาตทดลองหลายหน้า', () => {
    const adapter = resolveAdapter('manual_scan')
    expect(adapter.mode).toBe('live')
    expect(adapter.adapterVersion).toBe(ADAPTER_VERSION_LIVE)
  })

  it('manual_scan เปิดอยู่ไม่ได้ทำให้ full_scan เปิดตาม — สองอย่างนี้ยังแยกจากกันจริง', () => {
    expect(resolveAdapter('manual_scan').mode).toBe('live')
    expect(() => resolveAdapter('full_scan')).toThrow(/g0_not_verified/)
  })

  it('metadata_only ได้ descriptor ที่ยิง request ไม่ได้เลย — ใช้กับ message ที่ไม่ต้องอ่านข้อมูล', async () => {
    const adapter = resolveAdapter('metadata_only')
    expect(adapter.mode).toBe('live')
    expect(adapter.adapterVersion).toBe(ADAPTER_VERSION_LIVE)
    await expect(
      adapter.fetchPage({ offset: 0, count: 6 }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'g0_not_verified' })
  })
})

describe('ไม่มีความพยายามต่อ network เกิดขึ้นเลยจากการ resolve', () => {
  it('ledger ว่างทั้งก่อนและหลัง resolve ทุก purpose — การสร้าง adapter ไม่ยิงอะไรทั้งนั้น', () => {
    expect(violations).toHaveLength(0)
    resolveAdapter('metadata_only')
    resolveAdapter('manual_probe')
    resolveAdapter('manual_scan')
    expect(() => resolveAdapter('full_scan')).toThrow()
    // สร้าง adapter/transport แล้วแต่ยังไม่มีใครเรียก fetchPage → ต้องไม่มี request ใด ๆ
    expect(violations).toHaveLength(0)
  })

  it('เรียกซ้ำหลายครั้งให้ผลเดิมทุกครั้ง — ไม่มี state ที่ค่อย ๆ เปิดทางให้ full scan ผ่านได้', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(() => resolveAdapter('full_scan')).toThrow(/g0_not_verified/)
      expect(resolveAdapter('manual_probe').mode).toBe('live')
    }
  })
})
