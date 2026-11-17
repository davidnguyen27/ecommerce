// E2E bằng trình duyệt thật trên stack của `pnpm smoke --keep` (http://localhost:8081), cổng thanh toán giả lập.
// Chạy: pnpm smoke --keep && pnpm e2e; xong thì `docker compose -p ecommerce-smoke down -v`.
// Trình duyệt: Chromium của Playwright (`pnpm --filter @ecommerce/e2e exec playwright install chromium`).
// Máy đã có Edge thì chạy được không cần tải: E2E_CHANNEL=msedge pnpm e2e.
// Một lượt đặt đúng 5 lần (mua hàng 1, đặt trước 1, mã giảm giá 3), bằng giới hạn 5 lần đặt mỗi IP mỗi giờ: chạy lại
// trên cùng stack phải chờ một giờ, hoặc dựng lại stack. Đăng nhập cũng giới hạn 10 lần mỗi email trong 15 phút.
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
