import { test as base, chromium, type BrowserContext } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** E2E ทดสอบ mock channel เท่านั้น — release channel ไม่มี adapter ให้สแกน */
const EXTENSION_PATH = resolve(HERE, '../../../dist')

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    // persistent context เท่านั้นที่โหลด extension ได้ และเป็น profile ชั่วคราวของ Playwright เอง
    // ไม่ใช่ profile หลักของผู้ใช้ (spec §13.1)
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    })
    await use(context)
    await context.close()
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers()
    worker ??= await context.waitForEvent('serviceworker')
    // URL เป็น chrome-extension://<id>/background.js
    const extensionId = worker.url().split('/')[2] ?? ''
    await use(extensionId)
  },
})

export const expect = test.expect

/**
 * เปิด context ด้วย user-data dir ที่ผู้เรียกกำหนด เพื่อทดสอบการปิด/เปิด browser ซ้ำบน profile เดิม (LC06)
 * ผู้เรียกต้องส่ง temp dir ที่สร้างเอง — ห้ามส่ง profile จริงของผู้ใช้เด็ดขาด
 */
export async function launchExtensionContext(userDataDir: string): Promise<BrowserContext> {
  return await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  })
}

export async function extensionIdOf(context: BrowserContext): Promise<string> {
  let [worker] = context.serviceWorkers()
  worker ??= await context.waitForEvent('serviceworker')
  return worker.url().split('/')[2] ?? ''
}
