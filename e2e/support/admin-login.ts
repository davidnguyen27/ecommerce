import type { Page } from '@playwright/test'

/** Đăng nhập trang quản trị bằng form, như nhân viên; xong thì đang ở bảng điều khiển. */
export async function adminLogin(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/admin/login')
  await page.getByLabel('Địa chỉ Email nhân sự').fill(credentials.email)
  await page.getByLabel('Mật khẩu xác thực').fill(credentials.password)
  await page.getByRole('button', { name: /đăng nhập/i }).click()
  await page.waitForURL((url) => url.pathname.replace(/\/$/, '') === '/admin')
}
