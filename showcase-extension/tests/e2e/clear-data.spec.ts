import { test, expect } from './fixtures/extension.js'

test('PK05 — ล้างข้อมูลแล้ว staged products หายจริง และยังว่างหลัง reload', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await page.locator('#start-button').click()
  await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })

  const before = await page.evaluate(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'run.status' })
    return status?.resume?.productCount ?? status?.report?.counters?.uniqueValidProducts ?? 0
  })
  expect(before).toBeGreaterThan(0)

  await page.locator('#clear-data-button').click() // จังหวะที่ 1 — ติดอาวุธ
  await page.locator('#clear-data-button').click() // จังหวะที่ 2 — ล้างจริง
  await expect(page.locator('#run-status')).toContainText('ล้างข้อมูลแล้ว', { timeout: 10_000 })

  await page.reload()
  const after = await page.evaluate(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'run.status' })
    // run.status เมื่อ idle คืน resume เป็น object เสมอ (ResumeState) ไม่ใช่ null — ตรวจที่ .kind
    // แทนการตรวจว่าเป็น null (extension/src/dashboard/resume.ts: resumeDashboardState คืน
    // { kind: 'no_active_run' } เมื่อไม่มี active run ไม่เคยคืน null ตัว object เอง)
    return { resumeKind: status?.resume?.kind ?? null, phase: status?.phase ?? null }
  })
  expect(after.resumeKind).toBe('no_active_run')
  expect(after.phase).toBe('idle')
})

test('PK05 — data.clear ถูกปฏิเสธขณะ scan กำลังวิ่งอยู่จริง ไม่ล้างข้อมูลทิ้งกลางคัน', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/dashboard/index.html`)

  await page.locator('#start-button').click()
  // จับจังหวะที่ยังวิ่งอยู่จริง (ก่อน preview-section ปรากฏ) — cancel-button โผล่แปลว่า
  // currentController ยังไม่ใช่ null ฝั่ง service worker
  await expect(page.locator('#cancel-button')).toBeVisible({ timeout: 10_000 })

  const clearedWhileRunning = await page.evaluate(async () => {
    const result = await chrome.runtime.sendMessage({ type: 'data.clear' })
    return result
  })
  expect(clearedWhileRunning).toEqual({ ok: false, code: 'run_active' })

  // ต้องยังสแกนจบได้ตามปกติ ไม่ได้ถูกล้างทิ้งกลางคัน
  await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })
  const staged = await page.evaluate(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'run.status' })
    return status?.report?.counters?.uniqueValidProducts ?? 0
  })
  expect(staged).toBeGreaterThan(0)
})
