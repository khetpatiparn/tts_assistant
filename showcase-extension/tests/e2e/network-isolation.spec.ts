import { test, expect } from './fixtures/extension.js'
import { isExternalRequest } from './helpers/network.js'

test('PK04 — ทั้ง flow ไม่มี request ออกนอกเครื่องแม้แต่ครั้งเดียว (ทุก scheme)', async ({
  context,
  extensionId,
}) => {
  const external: string[] = []
  context.on('request', (request) => {
    if (isExternalRequest(request.url())) external.push(request.url())
  })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)
  await page.locator('#start-button').click()
  await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })

  await page.locator('.tab-button[data-filter="other"]').click()
  await page.locator('#select-all-button').click()

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#export-button').click()
  await downloadPromise

  expect(external).toEqual([])
})

test('PK04 positive control — ตัวตรวจจับทำงานจริง ไม่ใช่ listener ที่เงียบ', async ({
  context,
  extensionId,
}) => {
  // ยิงไป loopback port ที่ปิดอยู่ — ไม่มีอะไรออกจากเครื่อง และไม่แตะ TikTok
  const PROBE = 'http://127.0.0.1:45871/__detector_probe__'
  const seen: string[] = []
  context.on('request', (request) => {
    if (request.url() === PROBE) seen.push(request.url())
  })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)
  await page.evaluate(async (url) => {
    try {
      await fetch(url)
    } catch {
      // ECONNREFUSED เป็นผลที่คาดไว้ — สิ่งที่ทดสอบคือ listener เห็น request หรือไม่
    }
  }, PROBE)

  await expect.poll(() => seen.length, { timeout: 10_000 }).toBeGreaterThan(0)
})
