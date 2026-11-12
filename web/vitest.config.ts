import { defineConfig } from 'vitest/config'

// Chỉ chạy logic thuần, không dựng môi trường Nuxt; giao diện do E2E (ticket 14) phủ.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
