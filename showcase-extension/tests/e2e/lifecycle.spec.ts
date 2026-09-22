// ไม่ใช้ fixture `context` เพราะ test นี้ต้องคุมการเปิด/ปิด context เองด้วย user-data dir ที่กำหนด
import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchExtensionContext, extensionIdOf } from './fixtures/extension.js'

/**
 * D5 — พิสูจน์ว่า service worker ถูกฆ่าจริงผ่าน CDP (ไม่ใช่การเดาจาก timeout) แล้วคืน worker
 * version ตัวที่ `runningStatus === 'stopped'` มาให้ caller ตรวจได้ — สกัดจาก LC03 ที่เคยเขียนแบบ
 * inline ไว้ก่อน ตอนนี้ใช้ซ้ำในสองเทสต์ (LC03, D5) จึงย้ายมาเป็น helper กลาง
 */
async function stopServiceWorkerConfirmed(
  context: Awaited<ReturnType<typeof launchExtensionContext>>,
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchExtensionContext>>['newPage']>>,
): Promise<void> {
  const cdp = await context.newCDPSession(page)
  type WorkerVersion = { runningStatus: string; scriptURL: string }
  const stoppedConfirmed = new Promise<WorkerVersion>((resolve) => {
    cdp.on('ServiceWorker.workerVersionUpdated', (params) => {
      const stopped = (params.versions as WorkerVersion[]).find((v) => v.runningStatus === 'stopped')
      if (stopped) resolve(stopped)
    })
  })
  // ต้องเรียก enable ก่อน stopAllWorkers เสมอ มิฉะนั้นพลาด event (ยืนยันแล้วจาก spike — ลำดับสำคัญ)
  await cdp.send('ServiceWorker.enable')
  await cdp.send('ServiceWorker.stopAllWorkers')
  const stopped = await Promise.race([
    stoppedConfirmed,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ])
  if (stopped === null) {
    throw new Error('service worker did not report stopped within 5s — cannot proceed')
  }
}

test('LC06 — ปิดและเปิด browser บน profile เดิม แล้วเสนอ scan ใหม่จาก 0 ไม่อ้างว่า completed', async () => {
  // temp dir ที่สร้างเอง — ไม่ใช่ profile จริงของผู้ใช้ (spec §13.1)
  const userDataDir = await mkdtemp(join(tmpdir(), 'flow-a-e2e-'))
  try {
    const first = await launchExtensionContext(userDataDir)
    const idA = await extensionIdOf(first)
    const pageA = await first.newPage()
    await pageA.goto(`chrome-extension://${idA}/dashboard/index.html`)
    await pageA.locator('#start-button').click()
    // รอให้ commit อย่างน้อยหนึ่งหน้า แล้วปิดทั้ง browser กลาง scan
    await expect(pageA.locator('#run-status')).toContainText(/[1-9]\d*\s*รายการ/, { timeout: 20_000 })
    await first.close()

    const second = await launchExtensionContext(userDataDir)
    const idB = await extensionIdOf(second)
    const pageB = await second.newPage()
    await pageB.goto(`chrome-extension://${idB}/dashboard/index.html`)

    const statusText = await pageB.locator('#run-status').textContent({ timeout: 15_000 })
    expect(statusText ?? '').not.toContain('ready_complete')
    expect(statusText ?? '').not.toContain('กำลังสแกน')

    // ต้องเริ่มใหม่ได้จริง ไม่ติด run_already_active
    await pageB.locator('#start-button').click()
    await expect(pageB.locator('#preview-section')).toBeVisible({ timeout: 30_000 })
    await expect(pageB.locator('#run-status')).not.toContainText('เริ่มสแกนไม่ได้')

    await second.close()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('LC03 — หยุด service worker หลัง commit หน้าแรก แล้ว dashboard รายงาน interrupted พร้อมจำนวน staged', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'flow-a-lc03-'))
  try {
    const context = await launchExtensionContext(userDataDir)
    const id = await extensionIdOf(context)
    const page = await context.newPage()
    await page.goto(`chrome-extension://${id}/dashboard/index.html`)
    await page.locator('#start-button').click()
    await expect(page.locator('#run-status')).toContainText(/[1-9]\d*\s*รายการ/, { timeout: 20_000 })

    // หยุด service worker จริง — วิธีที่ spike (Task 1) พิสูจน์แล้วเท่านั้น
    // context.serviceWorkers().length และ Worker.on('close') ไม่น่าเชื่อถือ (พิสูจน์แล้วว่าไม่เปลี่ยนค่า
    // แม้ worker หยุดจริง เทียบกับ ground truth จาก chrome://serviceworker-internals/ 6 รอบ)
    // สัญญาณที่เชื่อถือได้คือ CDP event ServiceWorker.workerVersionUpdated ที่ runningStatus === 'stopped'
    // (stopServiceWorkerConfirmed ยืนยันด้วย CDP protocol event จริง ไม่ใช่การเดาฝั่ง Playwright —
    // เชื่อถือได้กว่า serviceWorkers().length หรือ 'close' event)
    await stopServiceWorkerConfirmed(context, page)

    // เปิดหน้า dashboard ใหม่ — ข้อความไปยัง service worker ที่หยุดแล้วจะปลุกตัวใหม่ขึ้นมาด้วย
    // registry ในหน่วยความจำที่ว่างเปล่า (background.ts เก็บ registry เป็น module-level state)
    await page.reload()
    const text = await page.locator('#run-status').textContent({ timeout: 15_000 })
    expect(text ?? '').toContain('ถูกขัดจังหวะ') // ไม่ค้าง Running ไม่แสดงว่าพร้อมเริ่มเฉย ๆ
    expect(text ?? '').not.toContain('ready_complete') // ไม่ falsely complete
    // ต้องรายงานจำนวน staged ที่เก็บไปแล้วก่อนโดนหยุด (มากกว่า 0)
    expect(text ?? '').toMatch(/[1-9]\d*\s*รายการ/)

    // Start ต้องใช้ได้ ไม่ติด lease ค้าง
    await page.locator('#start-button').click()
    await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })

    await context.close()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

/**
 * D5 — สแกนจนจบสมบูรณ์ แล้ว service worker ถูก Chrome idle-kill ไป **ก่อน**ที่ผู้ใช้จะกด Export
 * (สถานการณ์จริงที่เจอ: ผู้ใช้เลือกสินค้าอยู่นาน 198 รายการ นานกว่า MV3 idle timeout) — สำคัญที่ไม่
 * reload หน้า เพราะสถานการณ์จริงคือ dashboard ยังเปิดค้างอยู่ ไม่รู้ตัวว่า service worker ตายไปแล้ว
 * จนกว่าจะกด action ที่ยิง message ไปหามัน ก่อนแก้ D5 ปุ่ม Export จะ error ด้วย `no_report` ตรงนี้
 * เพราะ RunReport เก็บอยู่แค่ใน memory ของ service worker (registry.currentReport) ไม่เคย persist —
 * ตอนนี้ persist ลง IndexedDB แล้ว (extension/src/storage/checkpoints.ts, STORE_FINISHED_REPORT)
 */
test('D5 — service worker ถูกฆ่าหลัง scan เสร็จสมบูรณ์ (ไม่ reload หน้า) กด Export ยังสำเร็จ', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'flow-a-d5-'))
  try {
    const context = await launchExtensionContext(userDataDir)
    const id = await extensionIdOf(context)
    const page = await context.newPage()
    await page.goto(`chrome-extension://${id}/dashboard/index.html`)
    await page.locator('#start-button').click()
    // ต้องรอจนจบสมบูรณ์จริง (ไม่ใช่แค่หน้าแรกเหมือน LC03) เพราะ D5 ต้องพิสูจน์ว่าผล "จบแล้ว" รอดจาก
    // service worker ตาย ไม่ใช่ผล "กำลังวิ่งอยู่" ซึ่งมี checkpoint ใน IndexedDB คุ้มครองอยู่แล้ว
    await expect(page.locator('#preview-section')).toBeVisible({ timeout: 30_000 })
    // mock catalog ทั้ง 20 ตัวอยู่ใน tab "other" ไม่ใช่ "candidate" (eligibility เป็น unknown เสมอ
    // จนกว่า enum จะถูกยืนยันจาก TikTok จริง — ดู scan-flow.spec.ts "select all แล้ว export ได้ครบ
    // 20 ตัว" ที่ทำแบบเดียวกัน) ต้องสลับ tab ก่อน ไม่งั้น select-all ที่ tab default (candidate)
    // จะเลือกได้ 0 รายการ แล้ว assertion ด้านล่างที่ต้องการ products > 0 จะ fail
    await page.locator('.tab-button[data-filter="other"]').click()
    await page.locator('#select-all-button').click()

    await stopServiceWorkerConfirmed(context, page)

    // ไม่ page.reload() — จำลองผู้ใช้จริงที่ปล่อยหน้าไว้แล้วกด Export ตรง ๆ โดยไม่รู้ว่า service
    // worker ถูกฆ่าไปแล้ว dashboard ยังโชว์ preview เดิมค้างอยู่ใน memory ของตัวหน้าเว็บเองตามปกติ
    const downloadPromise = page.waitForEvent('download')
    await page.locator('#export-button').click()
    const download = await downloadPromise
    const payload = JSON.parse(
      await readFile((await download.path()) as string, 'utf8'),
    ) as Record<string, unknown>

    expect(payload['resultKind']).toBe('full_scan')
    expect(payload['scanCoverage']).toBe('reached_endpoint_end')
    expect((payload['products'] as unknown[]).length).toBeGreaterThan(0)

    await context.close()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})
