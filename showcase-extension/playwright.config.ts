import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // extension ต้องใช้ persistent context ซึ่งรันขนานกันไม่ได้อย่างปลอดภัย
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { acceptDownloads: true },
  reporter: [['list']],
})
