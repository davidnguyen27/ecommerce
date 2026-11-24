import { defineConfig } from 'vitest/config'

// Pure logic only, no Nuxt environment; the UI is covered by E2E (ticket 14).
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
