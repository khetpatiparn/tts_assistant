import type { NormalizedProduct } from '../domain/product.js'

/**
 * §8.3 — Preview แยกแถบ Candidate / Other status / Rejected
 * Rejected ไม่ใช่ NormalizedProduct (เป็น QuarantinedRecord จาก runner) จึงไม่มี selection —
 * โมดูลนี้จัดการเฉพาะสองแท็บที่เลือกได้
 */
export type SelectableFilter = 'candidate' | 'other'

export function productsInFilter(
  products: readonly NormalizedProduct[],
  filter: SelectableFilter,
): NormalizedProduct[] {
  return products.filter((p) => (filter === 'candidate' ? p.eligibility === 'candidate' : p.eligibility !== 'candidate'))
}

/**
 * §8.3 — "เลือกทั้งหมด" หมายถึงทุกแถวที่ผ่าน filter ไม่ใช่ทุก record ใน API
 * ไม่แตะ selection เดิมที่อยู่นอก filter (เช่น สลับมาดูแท็บอื่นแล้วเลือกทั้งหมด ไม่ล้างของแท็บก่อน)
 */
export function selectAllInFilter(
  selected: ReadonlySet<string>,
  filtered: readonly NormalizedProduct[],
): ReadonlySet<string> {
  const next = new Set(selected)
  for (const p of filtered) next.add(p.productId)
  return next
}

export function deselectAllInFilter(
  selected: ReadonlySet<string>,
  filtered: readonly NormalizedProduct[],
): ReadonlySet<string> {
  const next = new Set(selected)
  for (const p of filtered) next.delete(p.productId)
  return next
}

export function toggleSelection(selected: ReadonlySet<string>, productId: string): ReadonlySet<string> {
  const next = new Set(selected)
  if (next.has(productId)) next.delete(productId)
  else next.add(productId)
  return next
}

export function countSelectedInFilter(
  selected: ReadonlySet<string>,
  filtered: readonly NormalizedProduct[],
): number {
  let count = 0
  for (const p of filtered) if (selected.has(p.productId)) count += 1
  return count
}
