import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures/extension.js'

test('Start → scan → select → export ครบวงจรในเบราว์เซอร์จริง', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await expect(page.locator('#start-button')).toBeVisible()
  await page.locator('#start-button').click()

  // สแกนจบแล้ว preview จะโผล่ (mock 20 ตัว, หน่วงหน้าละ 1 วินาที)
  await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('#run-status')).toContainText('ready_complete')

  // ทุกตัวเป็น unknown จึงอยู่แท็บ Other status
  await expect(page.locator('#count-other')).toHaveText('20')
  await expect(page.locator('#count-candidate')).toHaveText('0')

  await page.locator('.tab-button[data-filter="other"]').click()
  const checkboxes = page.locator('#product-list input[type=checkbox]')
  await expect(checkboxes).toHaveCount(20)

  // index 1 และ 2 ของหน้าแรก (mock catalog) มาเป็น product_id แบบเลขไม่ใส่ quotes บน wire —
  // เลือกสองแถวนี้เพื่อพิสูจน์ว่า lossless path เดินจริงจนถึงไฟล์ export
  await checkboxes.nth(1).check()
  await checkboxes.nth(2).check()
  await expect(page.locator('#selected-count')).toContainText('เลือกทั้งหมด: 2')

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#export-button').click()
  const download = await downloadPromise

  const filePath = await download.path()
  expect(filePath).not.toBeNull()
  const payload = JSON.parse(await readFile(filePath as string, 'utf8')) as {
    selectedProductIds: string[]
    products: { productId: string }[]
    scanCoverage: string
    adapterVersion: string
  }

  expect(payload.selectedProductIds).toHaveLength(2)
  expect(payload.products).toHaveLength(2)

  // V03 — ID ที่มาเป็นเลขไม่ใส่ quotes ต้องออกมาครบทุกหลักในไฟล์ export (เทียบกับค่าที่ hardcode ไว้
  // ไม่ใช่เทียบกับ selectedProductIds ที่อ่านจากไฟล์เดียวกันเอง — ของเดิม vacuous เพราะ ID ที่เพี้ยน
  // ทั้งชุดก็ยังผ่าน assertion แบบนั้นได้)
  expect(payload.products.map((p) => p.productId)).toContain('1736749159048840634')
  expect(payload.products.map((p) => p.productId)).toContain('1736749159048840635')
  // ค่าที่ถูกปัดแล้ว (naive JSON.parse บนเลข 19 หลักนี้) ต้องไม่ปรากฏที่ใดในไฟล์
  expect(JSON.stringify(payload)).not.toContain('1736749159048840700')

  expect(payload.scanCoverage).toBe('reached_endpoint_end')
  expect(payload.adapterVersion).toBe('mock-v0')
})

test('select all แล้ว export ได้ครบ 20 ตัว', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)
  await page.locator('#start-button').click()
  await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })

  await page.locator('.tab-button[data-filter="other"]').click()
  await page.locator('#select-all-button').click()
  await expect(page.locator('#selected-count')).toContainText('เลือกทั้งหมด: 20')

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#export-button').click()
  const download = await downloadPromise
  const payload = JSON.parse(await readFile((await download.path()) as string, 'utf8')) as {
    products: unknown[]
  }
  expect(payload.products).toHaveLength(20)
})

test('export โดยไม่เลือกอะไรได้ไฟล์ว่างพร้อม metadata ครบ ไม่ใช่ error', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)
  await page.locator('#start-button').click()
  await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#export-button').click()
  const payload = JSON.parse(
    await readFile((await (await downloadPromise).path()) as string, 'utf8'),
  ) as Record<string, unknown>

  expect(payload['products']).toEqual([])
  expect(payload['scanCoverage']).toBe('reached_endpoint_end')
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
  // ไฟล์จาก full scan ต้องบอกตัวเองว่าเป็น full_scan ไม่ใช่ผลทดสอบหนึ่งหน้า
  expect(payload['resultKind']).toBe('full_scan')
})

test('V03 — runtime ของ extension รองรับ JSON.parse source-text reviver จริง', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  const supported = await page.evaluate(() => {
    let source: string | null = null
    type SourceReviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown
    const reviver: SourceReviver = (_key, value, context) => {
      if (context?.source !== undefined) source = context.source
      return value
    }
    JSON.parse('{"big":1736749159048840634}', reviver as (key: string, value: unknown) => unknown)
    return source
  })

  expect(supported).toBe('1736749159048840634')
})

test('จำกัดจำนวนหน้า — กด "2 หน้า" แล้วสแกนได้แค่ 12 ชิ้น (2×6) พร้อม banner บอกว่าไม่ครบ', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await page.locator('#max-pages-2').click()
  await expect(page.locator('#max-pages-input')).toHaveValue('2')

  await page.locator('#start-button').click()
  await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })

  // 12 จาก 20 ชิ้นทั้งหมด (mock 6 ชิ้นต่อหน้า) — ต้องไม่ข้ามไปหน้าที่ 3 แล้วค่อยหยุด
  await expect(page.locator('#count-other')).toHaveText('12')
  await expect(page.locator('#run-status')).toContainText('page_limit_reached')
  // แถบเตือนสีแดง "ข้อมูลยังไม่ครบ" ต้องโผล่ ไม่ใช่แสดงเหมือนสแกนครบปกติ
  await expect(page.locator('#run-status')).toContainText('ข้อมูลยังไม่ครบ')

  // export ต้องยังทำได้ และไฟล์ต้องบอกตัวเองว่าไม่ครบเหมือนกัน (ไม่ปิดบังผ่าน UI แต่ปล่อยไฟล์โกหก)
  await page.locator('.tab-button[data-filter="other"]').click()
  await page.locator('#select-all-button').click()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('#export-button').click()
  const download = await downloadPromise
  const payload = JSON.parse(await readFile((await download.path()) as string, 'utf8')) as {
    scanCoverage: string
    stopReason: string
    products: unknown[]
  }
  expect(payload.scanCoverage).toBe('partial')
  expect(payload.stopReason).toBe('page_limit_reached')
  expect(payload.products).toHaveLength(12)
})

test('เว้นช่องจำนวนหน้าว่างไว้ (ค่าเริ่มต้น) — ยังสแกนจนจบทั้งหมดเหมือนเดิม ไม่กระทบของเดิม', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await expect(page.locator('#max-pages-input')).toHaveValue('')
  await page.locator('#start-button').click()
  await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('#run-status')).toContainText('ready_complete')
  await expect(page.locator('#count-other')).toHaveText('20')
})
