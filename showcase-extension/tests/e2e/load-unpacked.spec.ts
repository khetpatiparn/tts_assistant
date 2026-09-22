import { test, expect } from './fixtures/extension.js'

test('extension โหลดได้และ service worker ลงทะเบียน', async ({ context, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/)
  expect(context.serviceWorkers().length).toBeGreaterThan(0)
})

test('dashboard เปิดได้ แสดง banner mock-only และ build info', async ({ context, extensionId }) => {
  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await expect(page.locator('.banner')).toContainText('MOCK-ONLY')
  // build info เติมผ่าน message ไปยัง service worker — ถ้า messaging พัง ค่านี้จะไม่ขึ้น
  await expect(page.locator('#build-info')).toContainText('mock')
  await expect(page.locator('#start-button')).toBeVisible()

  expect(consoleErrors).toEqual([])
})

test('popup เปิดได้และแสดงสถานะจาก service worker', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`)
  await expect(page.locator('#status')).toContainText('idle')
})

test('.product-image-gallery[hidden] ซ่อนจริงในเบราว์เซอร์จริง (ไม่ใช่แค่ attribute)', async ({
  context,
  extensionId,
}) => {
  // regression ของบั๊กจริงที่เจอ: `.product-image-gallery { display: flex }` มี CSS specificity
  // เท่ากับกฎ `[hidden] { display: none }` ของ user-agent stylesheet พอดี ทำให้กฎของเราชนะแล้ว
  // element ที่ตั้ง hidden=true ยังโชว์อยู่จริงในเบราว์เซอร์ (jsdom unit test จับไม่ได้เพราะเช็คแค่
  // ค่า attribute ไม่ได้ render CSS จริง) — สร้าง element สังเคราะห์ตรง ๆ ไม่ผ่านการสแกน/รูปสินค้า
  // เลย เพื่อตรวจ CSS ล้วน ๆ โดยไม่เสี่ยงให้ browser ยิง request จริงไปหา host รูปใด ๆ
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  const isHiddenVisually = await page.evaluate(() => {
    const el = document.createElement('div')
    el.className = 'product-image-gallery'
    el.hidden = true
    document.body.append(el)
    const visible = el.offsetParent !== null || el.getClientRects().length > 0
    el.remove()
    return !visible
  })

  expect(isHiddenVisually).toBe(true)
})
