// E2E bằng trình duyệt thật trên stack của `pnpm smoke --keep` (http://localhost:8081), cổng thanh toán giả lập.
// Chạy: pnpm smoke --keep && pnpm e2e; xong thì `docker compose -p ecommerce-smoke down -v`.
// Trình duyệt: Chromium của Playwright (`pnpm --filter @ecommerce/e2e exec playwright install chromium`).
// Máy đã có Edge thì chạy được không cần tải: E2E_CHANNEL=msedge pnpm e2e.
// Chạy lại trên cùng stack được khoảng 4 lượt mỗi giờ (giới hạn 5 lần đặt mua mỗi IP mỗi giờ, 10 lần đăng nhập mỗi
// email trong 15 phút); quá thì dựng lại stack.
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './support/stack.ts'

export default defineConfig({
  testDir: './tests',
  globalSetup: './support/global-setup.ts',
  // Các kịch bản dùng chung một stack và một biến thể còn ít hàng, nên chạy tuần tự.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Không retry, như các job CI khác: E2E đỏ là có lỗi cần xem trace.
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
