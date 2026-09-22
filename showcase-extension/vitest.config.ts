import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    setupFiles: ['./tests/setup/no-network.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['extension/src/**/*.ts'],
      // §16 G1 — เกณฑ์ใช้กับกลุ่ม parser/pagination/error state เท่านั้น
      // UI/adapters/messaging มี E2E และ static guard คุมอยู่แล้ว
      thresholds: {
        'extension/src/domain/envelope.ts': { branches: 90 },
        'extension/src/domain/product.ts': { branches: 90 },
        'extension/src/domain/page.ts': { branches: 90 },
        'extension/src/domain/json-lossless.ts': { branches: 90 },
        'extension/src/core/pagination.ts': { branches: 90 },
        'extension/src/core/retry.ts': { branches: 90 },
        'extension/src/core/runner.ts': { branches: 90 },
      },
    },
  },
})
