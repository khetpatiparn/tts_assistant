/**
 * Contract tests ของ pagination และกฎ missing/null/0
 *
 * **ทุกเคสในไฟล์นี้เป็นข้อมูลสังเคราะห์ทั้งหมด** — ไม่มีเคสใดที่อ้างว่าเคยพบจาก TikTok จริง
 * เคสที่เคยพบจริงอยู่ใน `observed-showcase-contract.test.ts` และ
 * `tests/fixtures/observed/PROVENANCE.md` เท่านั้น
 *
 * เหตุที่ต้องแยก: `total` ที่เปลี่ยนกลางคัน และ `total` ที่ขัดแย้งกับจำนวนที่ได้รับ
 * เป็นสถานการณ์ที่ **ยังไม่เคยสังเกตเห็น** จาก endpoint จริง จึงต้องทดสอบด้วยข้อมูลที่แต่งขึ้น
 * และห้ามบันทึกว่าเป็นพฤติกรรมที่ยืนยันแล้วของ TikTok — การที่ยังไม่เคยพบไม่ใช่เหตุผลให้ข้าม
 * fault handling: ทุกเคสด้านล่างนี้เป็น fault handling ที่ตั้งใจออกแบบไว้แล้ว ไม่ใช่ผลข้างเคียง
 *
 * หลักการที่ใช้ทั่วทั้งไฟล์ (§9.3 แนวทางอนุรักษนิยม): เมื่อ total ขัดแย้งกับตัวเองข้ามหน้า
 * หรือขัดแย้งกับจำนวนแถวที่ได้รับ ต้องตอบเป็น `conflict` เสมอ — ไม่เดาว่าฝั่งไหนถูก ไม่แก้ total
 * เอง ไม่เริ่มสแกนใหม่อัตโนมัติ และไม่ทำให้ run ดูเหมือน complete ทั้งที่ข้อมูลขัดแย้งกันอยู่
 *
 * ไม่มี network ใด ๆ ในไฟล์นี้
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decideAdvance, readPaginationMetadata } from '../../extension/src/core/pagination.js'
import { validatePage } from '../../extension/src/domain/page.js'
import type { PaginationMetadata } from '../../extension/src/core/pagination.js'
import type { NormalizeContext } from '../../extension/src/domain/product.js'
import type { ShowcaseRawPage } from '../../extension/src/adapters/types.js'

const CTX: NormalizeContext = {
  sourceRef: 'local-profile-01',
  sourceIdentityVerified: false,
  observedAt: '2026-09-20T06:13:53Z',
}

const page = (bodyText: string): ShowcaseRawPage => ({
  httpStatus: 200,
  headers: { 'content-type': 'application/json' },
  bodyText,
})

/** metadata แบบที่ endpoint จริงส่งมา: มีแต่ total (สังเคราะห์ค่าขึ้นมาเอง) */
const totalOnly = (total: number | null): PaginationMetadata => ({
  hasMore: null,
  nextOffset: null,
  total,
})

describe('สังเคราะห์ — ลำดับ offset แบบเดียวกับที่สังเกตได้ (6,6,…,3 แล้วหน้าว่าง)', () => {
  it('เดินทีละจำนวนแถวดิบที่ได้รับ ไม่ใช่ค่า count ที่ขอไป', () => {
    expect(decideAdvance({ currentOffset: 0, rawRowCount: 6, metadata: totalOnly(201) })).toEqual({
      kind: 'continue',
      nextOffset: 6,
    })
    expect(decideAdvance({ currentOffset: 192, rawRowCount: 6, metadata: totalOnly(201) })).toEqual({
      kind: 'continue',
      nextOffset: 198,
    })
  })

  it('หน้าสุดท้ายที่ได้ 3 แถว (น้อยกว่า count) ถือว่าจบทันที เพราะ offset+แถวที่ได้ ถึง total พอดี', () => {
    // 198 + 3 = 201 = total — เคสนี้คือของจริงที่ทดสอบซ้ำแล้วใน observed-showcase-contract.test.ts
    // (fixture หน้า 34 ฉบับเต็ม) ที่นี่ยืนยันแค่ระดับ unit ว่า decideAdvance ตัดสินถูกด้วย metadata ล้วน ๆ
    expect(decideAdvance({ currentOffset: 198, rawRowCount: 3, metadata: totalOnly(201) })).toEqual({
      kind: 'endpoint_end',
    })
  })

  it('หน้าที่ไม่มีแถวเลยก็ยังจบได้เหมือนเดิม — เป็น fallback สำหรับตอนที่ไม่มี total', () => {
    expect(decideAdvance({ currentOffset: 201, rawRowCount: 0, metadata: totalOnly(201) })).toEqual({
      kind: 'endpoint_end',
    })
    expect(decideAdvance({ currentOffset: 201, rawRowCount: 0, metadata: totalOnly(null) })).toEqual({
      kind: 'endpoint_end',
    })
  })
})

describe('สังเคราะห์ — total เพิ่ม/ลดระหว่าง run ต้องหยุดเป็น conflict เสมอ ไม่เดาว่าฝั่งไหนถูก', () => {
  it('total ที่ลดลงระหว่างสแกน: หน้าแรกเห็น 201 หน้าถัดไปเห็น 12 → conflict total_changed ไม่ใช่ endpoint_end', () => {
    // previousTotal คือค่าที่ caller (runner) เก็บไว้จากหน้าก่อนหน้าของ run เดียวกัน
    const first = decideAdvance({
      currentOffset: 0,
      rawRowCount: 6,
      metadata: totalOnly(201),
      previousTotal: null,
    })
    expect(first).toEqual({ kind: 'continue', nextOffset: 6 })

    const second = decideAdvance({
      currentOffset: 6,
      rawRowCount: 6,
      metadata: totalOnly(12),
      previousTotal: 201, // สิ่งที่หน้าแรกเห็น
    })
    expect(second).toEqual({ kind: 'conflict', reason: 'total_changed' })
  })

  it('total ที่เพิ่มขึ้นระหว่างสแกนก็ต้องหยุดเป็น conflict เช่นกัน ไม่ใช่แค่ทิศทางลดลงเท่านั้น', () => {
    const second = decideAdvance({
      currentOffset: 6,
      rawRowCount: 6,
      metadata: totalOnly(999),
      previousTotal: 201,
    })
    expect(second).toEqual({ kind: 'conflict', reason: 'total_changed' })
  })

  it('total ที่หายไปหลังจากเคยเห็นแล้ว (หรือกลายเป็นผิดชนิด) เป็น conflict total_disappeared', () => {
    // readPaginationMetadata ทำให้ total ที่ผิดชนิดกลายเป็น null อยู่แล้ว — ที่นี่ทดสอบผลลัพธ์ปลายทาง
    const second = decideAdvance({
      currentOffset: 6,
      rawRowCount: 6,
      metadata: totalOnly(null),
      previousTotal: 201,
    })
    expect(second).toEqual({ kind: 'conflict', reason: 'total_disappeared' })
  })

  it('total ที่ไม่เคยเห็นมาก่อนในรอบนี้ (previousTotal เป็น null) ไม่ถือว่าเปลี่ยน — เป็นค่าที่เพิ่งปรากฏครั้งแรก', () => {
    // หน้าแรกของ run ไม่มี "ของเดิม" ให้เทียบ จึงไม่ conflict แม้ total จะยังไม่เคยเห็นมาก่อน
    expect(
      decideAdvance({ currentOffset: 0, rawRowCount: 6, metadata: totalOnly(201), previousTotal: null }),
    ).toEqual({ kind: 'continue', nextOffset: 6 })
  })
})

describe('สังเคราะห์ — total ขัดแย้งกับจำนวนที่ได้รับแล้ว (ยังไม่เคยพบจากของจริง)', () => {
  it('ได้รับแถวมามากกว่า total ที่ประกาศไว้ — ต้องหยุดเป็น conflict total_exceeded ไม่ใช่ endpoint_end เงียบ ๆ', () => {
    // offset 12 แปลว่ารับมาแล้ว 12 แถว แต่ server บอกว่ามีทั้งหมด 5 — 12+6=18 เกิน 5 ไปมาก
    // ห้ามปัดให้เป็น "จบปกติ" เพราะข้อมูลไม่สอดคล้องกันเอง (total อาจเก่า/ผิด หรือมีการนับซ้ำ)
    expect(decideAdvance({ currentOffset: 12, rawRowCount: 6, metadata: totalOnly(5) })).toEqual({
      kind: 'conflict',
      reason: 'total_exceeded',
    })
  })

  it('total = 0 แต่ยังส่งแถวมา — ก็เป็น total_exceeded เช่นกัน ไม่ใช่ endpoint_end', () => {
    expect(decideAdvance({ currentOffset: 0, rawRowCount: 6, metadata: totalOnly(0) })).toEqual({
      kind: 'conflict',
      reason: 'total_exceeded',
    })
  })

  it('offset+rawRowCount ถึง total พอดี (ไม่เกิน) ยังคงเป็น endpoint_end ปกติ — แยกจากกรณีเกิน', () => {
    expect(decideAdvance({ currentOffset: 195, rawRowCount: 6, metadata: totalOnly(201) })).toEqual({
      kind: 'endpoint_end',
    })
  })

  it('ได้หน้าว่างทั้งที่ total บอกว่ายังไม่ถึง — conflict empty_page_but_total_not_reached ไม่ใช่จบเงียบ ๆ', () => {
    // offset 100 ยังไม่ถึง total 201 แต่ได้แถวว่างมา — ขัดกับสิ่งที่ total ยืนยันไว้
    expect(decideAdvance({ currentOffset: 100, rawRowCount: 0, metadata: totalOnly(201) })).toEqual({
      kind: 'conflict',
      reason: 'empty_page_but_total_not_reached',
    })
  })

  it('total = 0 และ products=[] ตั้งแต่หน้าแรก — เป็นกรณีปกติ (Showcase ว่าง) ไม่ใช่ conflict', () => {
    // offset=0, rawRowCount=0, total=0 → 0 < 0 เป็นเท็จ จึงไม่เข้าเงื่อนไข "total ยังไปไม่ถึง"
    // ต้องแยกจากเคสข้างบนให้ชัด ไม่ให้ Showcase ว่างจริงถูกตีความเป็นข้อผิดพลาด
    expect(decideAdvance({ currentOffset: 0, rawRowCount: 0, metadata: totalOnly(0) })).toEqual({
      kind: 'endpoint_end',
    })
  })

  it('ความขัดแย้งที่อิง has_more/next_offset เดิมยังทำงานอยู่เหมือนเดิม ไม่ถูกแทนที่ด้วยเช็ค total ใหม่', () => {
    expect(
      decideAdvance({
        currentOffset: 0,
        rawRowCount: 0,
        metadata: { hasMore: true, nextOffset: null, total: 201 },
      }),
    ).toEqual({ kind: 'conflict', reason: 'empty_page_but_has_more' })

    expect(
      decideAdvance({
        currentOffset: 12,
        rawRowCount: 6,
        metadata: { hasMore: null, nextOffset: 6, total: 201 },
      }),
    ).toEqual({ kind: 'conflict', reason: 'next_offset_not_advancing' })
  })
})

describe('สังเคราะห์ — readPaginationMetadata ไม่เดาค่าที่ไม่มี', () => {
  it('body ที่มีแต่ total ให้ hasMore/nextOffset เป็น null ไม่ใช่ค่า default', () => {
    expect(readPaginationMetadata({ total: 201 })).toEqual({
      hasMore: null,
      nextOffset: null,
      total: 201,
    })
  })

  it('total ที่ไม่ใช่ safe integer ถูกปฏิเสธ ไม่ถูกปัดหรือแปลง', () => {
    expect(readPaginationMetadata({ total: 1.5 }).total).toBeNull()
    expect(readPaginationMetadata({ total: '201' }).total).toBeNull()
    expect(readPaginationMetadata({ total: Number.MAX_SAFE_INTEGER + 2 }).total).toBeNull()
  })
})

describe('สังเคราะห์ — missing / null / 0 / "-" ต้องไม่ถูกยุบรวมกัน (V05, V07)', () => {
  const body = readFileSync('tests/fixtures/synthetic/fx20-missing-vs-zero-vs-dash.json', 'utf8')
  const result = validatePage(page(body), CTX)

  it('ทั้งสี่แถวผ่าน validator', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.products).toHaveLength(4)
  })

  it('ราคาที่เป็นขีดถูกเก็บเป็นข้อความตามเดิม ไม่ถูก parse เป็นตัวเลข', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    const dash = result.products[0]
    expect(dash?.priceDisplay).toBe('-')
    expect(dash?.priceAmountDecimal).toBeNull()
    expect(dash?.currency).toBeNull()
    expect(dash?.validationWarnings).toContain('price_amount_unverified')
  })

  it('field ที่หายไปให้ null ไม่ใช่ 0', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.products[1]?.stockQuantity).toBeNull()
  })

  it('ค่า 0 ที่มีจริงยังคงเป็น 0 ไม่ถูกแปลงเป็น null', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.products[2]?.stockQuantity).toBe(0)
  })

  it('null ที่ส่งมาชัดเจนยังเป็น null และแยกจาก 0 ได้', () => {
    if (result.outcome !== 'ok') throw new Error(result.outcome)
    expect(result.products[3]?.stockQuantity).toBeNull()
    expect(result.products[2]?.stockQuantity).not.toBeNull()
  })
})
