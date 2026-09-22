import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures/extension.js'
import { isExternalRequest } from './helpers/network.js'

/**
 * §14.1 adapter.probe — "ทดลองหนึ่งหน้าก่อน" ต้องแสดงผลชัดว่าเป็นผลของหน้าเดียว ไม่ใช่ full scan
 * และไม่แตะ network จริงแม้แต่ครั้งเดียว (build นี้เป็น mock channel — ยืนยันซ้ำเฉพาะจุดของ probe
 * นอกเหนือจาก network-isolation.spec.ts ที่ครอบคลุมทั้ง flow อยู่แล้ว)
 */
test('probe แสดงผลทดสอบหนึ่งหน้าพร้อมรายการ normalized ไม่ใช่ผลสแกนครบ และไม่แตะ network', async ({
  context,
  extensionId,
}) => {
  const external: string[] = []
  context.on('request', (request) => {
    if (isExternalRequest(request.url())) external.push(request.url())
  })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await page.locator('#probe-button').click()
  const result = page.locator('#probe-result')

  await expect(result).toContainText('ผลทดสอบหนึ่งหน้า')
  await expect(result).toContainText('http status')
  await expect(result).toContainText('200')
  await expect(result).toContainText('สถานะ envelope')
  await expect(result).toContainText('ok')
  // มี row ของสินค้าอย่างน้อยหนึ่งแถว (mock adapter มี fixture หลายสินค้าเสมอ)
  await expect(result.locator('.row')).not.toHaveCount(0)

  expect(external).toEqual([])
})

/**
 * ขั้นก่อนเปิดสแกนหลายหน้า — ปุ่ม "อ่านหน้าถัดไป" ต้องเลื่อน offset ทีละ count จริง และต้องเลื่อน
 * ก็ต่อเมื่อผู้ใช้กดเท่านั้น ไม่มีการอ่านหน้าถัดไปเองโดยอัตโนมัติ
 */
test('อ่านทีละหน้า — ปุ่มหน้าถัดไปเลื่อน offset 0 → 6 เมื่อกดเอง และไม่ยิงเองก่อนถูกกด', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  const result = page.locator('#probe-result')
  const nextButton = page.locator('#probe-next-button')

  // ยังไม่เคยอ่าน → ยังไม่รู้ว่ามีหน้าถัดไปไหม จึงต้องไม่มีปุ่มให้กด
  await expect(nextButton).toBeHidden()

  await page.locator('#probe-button').click()
  await expect(result).toContainText('offset ที่อ่าน')
  await expect(result).toContainText('0 (count=6)')

  // หน้าแรกเต็ม → เปิดให้กดหน้าถัดไปได้ พร้อมบอก offset ที่จะไปตรง ๆ บนตัวปุ่ม
  await expect(nextButton).toBeVisible()
  await expect(nextButton).toHaveText('อ่านหน้าถัดไป (offset=6)')

  // ผลยังเป็นของ offset=0 อยู่จนกว่าจะกด — พิสูจน์ว่าไม่มีการอ่านต่อเอง
  await expect(result).toContainText('0 (count=6)')

  await nextButton.click()
  await expect(result).toContainText('6 (count=6)')
})

/**
 * UI06 — ยังไม่มี UI ก่อนหน้านี้ที่แสดงสถานะสิทธิ์ host permission เลย ตอนนี้มีแล้วและต้องแสดง
 * สถานะที่ถูกต้องตั้งแต่เปิดหน้าครั้งแรก (ยังไม่เคยขอสิทธิ์นี้มาก่อนใน fresh profile)
 *
 * **ไม่คลิกปุ่ม "อนุญาต" ในเทสต์นี้** — chrome.permissions.request เปิด native permission prompt
 * ของเบราว์เซอร์ซึ่ง Playwright ไม่มีทางกดผ่านอัตโนมัติได้อย่างน่าเชื่อถือ (ไม่ใช่ DOM element ในหน้า)
 * นี่คือช่องว่างที่บันทึกไว้ตรง ๆ ใน docs/api-observations.md §6 ไม่ใช่สิ่งที่ข้ามไปเงียบ ๆ
 */
test('permission status แสดงว่ายังไม่มีสิทธิ์ shop.tiktok.com และปุ่มขอสิทธิ์แสดงอยู่ (UI06 พื้นฐาน)', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await expect(page.locator('#permission-status')).toContainText('ยังไม่มีสิทธิ์')
  await expect(page.locator('#grant-permission-button')).toBeVisible()
})

/**
 * export ผลตัวอย่างด้วย exporter เดิม — ไฟล์ต้องบอกตัวเองว่าเป็นผลทดสอบหนึ่งหน้า
 * ไม่ใช่ข้อมูลครบทั้ง Showcase (resultKind + scanCoverage)
 */
test('export ผลทดสอบหนึ่งหน้าได้ และไฟล์ไม่อ้างว่าเป็นข้อมูลครบทั้ง Showcase', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  // ปุ่ม export ของ probe ต้องยังไม่โผล่ก่อนกดทดสอบ
  await expect(page.locator('#probe-export-button')).toBeHidden()

  await page.locator('#probe-button').click()
  await expect(page.locator('#probe-result')).toContainText('ผลทดสอบหนึ่งหน้า')
  await expect(page.locator('#probe-export-button')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#probe-export-button').click()
  const download = await downloadPromise
  const payload = JSON.parse(await readFile((await download.path()) as string, 'utf8')) as {
    resultKind: string
    scanCoverage: string
    runId: string
    products: unknown[]
  }

  expect(payload.resultKind).toBe('single_page_probe')
  expect(payload.scanCoverage).toBe('partial')
  expect(payload.runId.startsWith('probe-')).toBe(true)
  expect(payload.products.length).toBeGreaterThan(0)
})
