// Real-browser E2E on the `pnpm smoke --keep` stack (http://localhost:8081), with the payment simulator.
// Run: pnpm smoke --keep && pnpm e2e; then `docker compose -p ecommerce-smoke down -v`.
// Browser: Playwright's Chromium (`pnpm --filter @ecommerce/e2e exec playwright install chromium`).
// With Edge installed, no download is needed: E2E_CHANNEL=msedge pnpm e2e.
// One run places 7 orders (purchase 1, pre-order 1, voucher 3, refund 2), over the 5 per IP per hour limit:
// global-setup and the refund spec clear the smoke stack's counters (support/rate-limit.ts, needs the Docker CLI), so
// reruns on the same stack work. Sign-in is limited to 10 per email per 15 minutes.
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './support/stack.ts'

export default defineConfig({
  testDir: './tests',
  globalSetup: './support/global-setup.ts',
  // Scenarios share one stack and a low-stock variant, so they run serially.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retries, like the other CI jobs: a red E2E is a bug to inspect via the trace.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.E2E_CHANNEL || undefined },
    },
  ],
})
