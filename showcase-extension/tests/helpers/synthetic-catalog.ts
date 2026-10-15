/**
 * ชุดสินค้าสังเคราะห์สำหรับ FX11 และการทดสอบ pagination
 *
 * ทำหน้าที่เหมือน server ปลอมที่ควบคุมได้: รู้ ID ที่ควรได้ครบทุกตัวล่วงหน้า
 * จึงเทียบ ID set ได้ 100% ตามที่ G1 และ VA03 กำหนด (จำนวนหน้าไม่ใช่หลักฐานว่าได้ครบ)
 */

export interface CatalogOptions {
  /** จำนวนสินค้าทั้งหมดใน catalog */
  readonly total: number
  /** เพดานที่ server ยอมคืนต่อหนึ่ง request ถึงแม้ client จะขอมากกว่า */
  readonly serverCap?: number
  /** ใส่ has_more/next_offset/total ลงใน envelope หรือไม่ */
  readonly metadata?: 'none' | 'has_more' | 'next_offset' | 'total'
}

const ID_BASE = 7000000000000000000n

export const catalogId = (index: number): string => String(ID_BASE + BigInt(index))

export const expectedIds = (total: number): string[] =>
  Array.from({ length: total }, (_, i) => catalogId(i))

const product = (index: number): Record<string, unknown> => ({
  product_id: catalogId(index),
  title: `สินค้าสังเคราะห์ลำดับที่ ${String(index + 1)}`,
  format_available_price: `฿${String(100 + (index % 50))}.00`,
  stock_num: index % 7,
  stock_status: 1,
  review_status: 1,
  can_added: true,
})

export interface CatalogServer {
  /** จำนวน request ที่ถูกเรียกไปแล้ว รวม request สุดท้ายที่ได้หน้าว่าง */
  readonly requestLog: readonly { offset: number; count: number }[]
  page(offset: number, count: number): string
}

export function createCatalogServer(options: CatalogOptions): CatalogServer {
  const { total, serverCap = Number.POSITIVE_INFINITY, metadata = 'none' } = options
  const requestLog: { offset: number; count: number }[] = []

  return {
    requestLog,
    page(offset: number, count: number): string {
      requestLog.push({ offset, count })
      const size = Math.min(count, serverCap)
      const slice = Array.from({ length: Math.max(0, Math.min(size, total - offset)) }, (_, i) =>
        product(offset + i),
      )
      const envelope: Record<string, unknown> = {
        code: 0,
        message: 'success',
        data: { products: slice },
      }
      const data = envelope['data'] as Record<string, unknown>
      if (metadata === 'has_more') data['has_more'] = offset + slice.length < total
      if (metadata === 'next_offset') data['next_offset'] = offset + slice.length
      if (metadata === 'total') data['total'] = total
      return JSON.stringify(envelope)
    },
  }
}

/** FX05 — หน้าที่ ID คาบเกี่ยวกับหน้าก่อน และหน้าที่ซ้ำทั้งหน้า */
export function overlappingPage(startIndex: number, size: number): string {
  return JSON.stringify({
    code: 0,
    message: 'success',
    data: {
      products: Array.from({ length: size }, (_, i) => product(startIndex + i)),
    },
  })
}
