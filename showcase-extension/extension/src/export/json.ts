import type { NormalizedProduct } from '../domain/product.js'
import type { RunReport } from '../core/runner.js'

/**
 * §10 — export มี resultKind, runId, exportedAt, adapterVersion, sourceRef, coverage, quality,
 * selected IDs และ normalized products เท่านั้น ไม่มี headers/token
 * key set นี้คือ allowlist ทั้งหมด ห้ามเพิ่มโดยไม่แก้ที่นี่
 *
 * `resultKind` มีเพื่อไม่ให้ไฟล์ที่ส่งออกจากการ **ทดลองอ่านหนึ่งหน้า** ถูกเข้าใจผิดว่าเป็นข้อมูล
 * ทั้ง Showcase — ไฟล์บอกตัวเองได้เสมอว่ามาจากไหน โดยไม่ต้องพึ่งชื่อไฟล์หรือความทรงจำของผู้ใช้
 */
export interface ExportPayload {
  readonly resultKind: 'full_scan' | 'single_page_probe'
  readonly runId: string
  readonly exportedAt: string
  readonly adapterVersion: string
  readonly sourceRef: string
  readonly scanCoverage: RunReport['scanCoverage']
  /**
   * ทำไมการอ่านถึงหยุด — คู่กับ `scanCoverage` เพื่อให้ไฟล์ที่ไม่ครบอธิบายตัวเองได้ว่าขาดเพราะอะไร
   * (ยกเลิกเอง / โดน rate limit / ชน challenge / ...) ไม่ใช่แค่บอกว่า "partial" แล้วจบ
   * เป็น enum ปิดจาก runner ไม่ใช่ข้อความอิสระ จึงไม่มีทางพาข้อมูลอ่อนไหวออกมา
   */
  readonly stopReason: RunReport['stopReason']
  readonly dataQuality: RunReport['dataQuality']
  readonly selectedProductIds: readonly string[]
  readonly products: readonly NormalizedProduct[]
}

/**
 * ส่งออกเฉพาะสินค้าที่ผู้ใช้เลือกจริง (UI02) พร้อม metadata ว่าการสแกนครบหรือไม่ (UI03)
 * ไม่ relabel partial/unknown ให้ดูเหมือน success — scanCoverage/dataQuality มาจาก report ตรงๆ
 */
export function buildExport(
  report: RunReport,
  selectedIds: readonly string[],
  now: () => number,
): ExportPayload {
  const validIds = new Set(report.productIds)
  const selected = new Set<string>()
  for (const id of selectedIds) {
    if (validIds.has(id)) selected.add(id)
  }

  return {
    resultKind: 'full_scan',
    runId: report.runId,
    exportedAt: new Date(now()).toISOString(),
    adapterVersion: report.adapterVersion,
    sourceRef: report.sourceRef,
    scanCoverage: report.scanCoverage,
    stopReason: report.stopReason,
    dataQuality: report.dataQuality,
    selectedProductIds: [...selected],
    // เรียงตามลำดับของ report ไม่ใช่ลำดับที่ผู้ใช้กดเลือก เพื่อให้ export ทำซ้ำได้ (deterministic)
    products: report.products.filter((p) => selected.has(p.productId)),
  }
}

export interface ProbeExportInput {
  readonly adapterVersion: string
  readonly sourceRef: string
  readonly products: readonly NormalizedProduct[]
}

/**
 * ส่งออกผลของ **การทดลองอ่านหนึ่งหน้า** ด้วย payload shape เดียวกับ full scan (exporter เดิม)
 * แต่บอกความจริงทุกช่องว่าไม่ใช่ข้อมูลครบ:
 *
 * - `resultKind: 'single_page_probe'` — ป้ายหลักที่อ่านได้จากตัวไฟล์เอง
 * - `scanCoverage: 'partial'` — หนึ่งหน้าไม่เคยเป็น `reached_endpoint_end` แม้หน้านั้นจะอ่านครบ
 * - `runId` เป็น `probe-<timestamp>` ไม่ใช่ runId ของ run จริง เพราะไม่มี run เกิดขึ้น
 * - `stopReason: 'request_limit_reached'` — probe ยิงได้ครั้งเดียวตามนิยามของมัน จึงหยุดเพราะ
 *   ชนเพดานจำนวน request เสมอ ไม่ใช่เพราะอ่านถึงปลายทาง
 * - ไม่มีการเลือก/กรอง — ส่งออกทุกแถวที่อ่านได้ในหน้านั้นตามที่เห็น
 */
export function buildProbeExport(input: ProbeExportInput, now: () => number): ExportPayload {
  const at = now()
  return {
    resultKind: 'single_page_probe',
    runId: `probe-${String(at)}`,
    exportedAt: new Date(at).toISOString(),
    adapterVersion: input.adapterVersion,
    sourceRef: input.sourceRef,
    scanCoverage: 'partial',
    stopReason: 'request_limit_reached',
    dataQuality: input.products.some((p) => p.validationWarnings.length > 0) ? 'warnings' : 'clean',
    selectedProductIds: input.products.map((p) => p.productId),
    products: input.products,
  }
}
