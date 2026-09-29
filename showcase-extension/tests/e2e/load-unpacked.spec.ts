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
  // ใช้ run.status (สถานะจริง) แทน status.get เดิม (hardcode 'idle' ตายตัว) — ไม่มี run ใด ๆ
  // เคยเริ่มในโปรไฟล์ทดสอบนี้เลย จึงต้องได้ phase idle แบบไม่มี resume ค้าง · ตอน idle การ์ดสถานะ
  // ซ่อนโดยตั้งใจ (ข้อความ idle ไม่มีประโยชน์กับผู้ใช้) data-phase จึงเป็นหลักฐานว่าคุยกับ worker ได้
  await expect(page.locator('#status-card')).toHaveAttribute('data-phase', 'idle')
  await expect(page.locator('#status-card')).toBeHidden()
  // โปรไฟล์ทดสอบไม่เคยให้สิทธิ์ localhost:3000 → ไฟเทา "ยังไม่ได้อนุญาต" และปุ่มสแกน+ส่งกดไม่ได้
  await expect(page.locator('#app-title')).toContainText('ยังไม่ได้อนุญาตให้เชื่อมต่อ Angle')
  await expect(page.locator('#scan-push')).toBeDisabled()
})

test('สแกนอัตโนมัติ — ยังไม่มีลิงก์ปลายทางต้องไม่สแกนเต็มแล้วส่งทั้ง Showcase', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)
  await expect(page.locator('#auto-status')).toBeHidden() // ไม่มีคำสั่ง = ไม่ทำอะไรเอง
  // จำลองปุ่มใน popup (requestAutoScan) — โปรไฟล์ทดสอบยังไม่มีลิงก์ปลายทาง จึงถามรายการที่ส่งแล้วไม่ได้
  await page.evaluate(() => chrome.storage.session.set({ autoScanRequestedAt: Date.now() }))
  await page.reload()
  await expect(page.locator('#auto-status')).toContainText('ยังไม่ได้ใส่ลิงก์ปลายทาง')
  await expect(page.locator('#start-button')).toBeVisible()
  // คำสั่งใช้ครั้งเดียว — refresh ต้องไม่รันซ้ำ
  await page.reload()
  await expect(page.locator('#auto-status')).toBeHidden()
})

test('หน้าจัดการ: ไม่มีส่วนขอสิทธิ์/secret แล้ว และส่วนตั้งค่ากางเองเมื่อยังไม่มีลิงก์', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)
  await expect(page.locator('#grant-permission-button')).toHaveCount(0)
  await expect(page.locator('#app-secret-input')).toHaveCount(0)
  await expect(page.locator('#settings')).toHaveAttribute('open', '')
  await page.locator('#destination-input').fill('http://example.com/hook')
  await page.locator('#save-destination-button').click()
  await expect(page.locator('#destination-status')).toContainText('https://')
  await page.locator('#destination-input').fill('http://localhost:3000/api/scanner?token=t')
  await page.locator('#save-destination-button').click()
  await expect(page.locator('#destination-status')).toContainText('บันทึกลิงก์แล้ว')
  await page.reload()
  await expect(page.locator('#settings')).not.toHaveAttribute('open', '')
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
