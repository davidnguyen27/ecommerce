// Báo cáo (M7), bằng trình duyệt thật trên stack smoke:
// 1. Khách mua và trả; đơn được giao. Owner mở Báo cáo, thấy doanh thu của kỳ khớp API; đổi kỳ sang tháng trước;
//    xuất Excel tải được file đúng tên.
// 2. Kế toán thấy mục Báo cáo và khối "Cần xử lý" ở trang chủ; nhân viên kho không thấy cả hai.
// Số liệu so với API quản trị chứ không so với số cố định, vì các spec khác cũng giao đơn trên cùng stack.
import { expect, test, type Browser } from '@playwright/test'
import type { RevenueReport } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { buyAndPay, ensureSellable } from '../support/purchase.ts'
import { resetRateLimits } from '../support/rate-limit.ts'
import { ACCOUNTANT, AdminApi, OWNER, PRICE, WAREHOUSE } from '../support/stack.ts'

const DAY = 24 * 60 * 60_000
/** Ngày lịch theo giờ Việt Nam `YYYY-MM-DD`. */
const vnDate = (date: Date) => new Date(date.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10)
/** Như `formatVnd` của trang quản trị. */
const vnd = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`

test.beforeAll(async () => {
  resetRateLimits()
  await ensureSellable(1, 'E2E báo cáo: bổ sung hàng')
})

test('owner thấy doanh thu của đơn vừa giao, đổi kỳ sang tháng trước, xuất Excel', async ({ page }) => {
  const { code } = await buyAndPay(page, 'bao-cao', '7')
  const api = await AdminApi.owner()
  await api.send('POST', `/api/admin/orders/${code}/prepare`)
  await api.send('POST', `/api/admin/orders/${code}/hand-over`, { carrier: 'GHN', trackingNumber: `GHN${code}` })
  await api.send('POST', `/api/admin/orders/${code}/deliver`)

  const today = vnDate(new Date())
  const monthStart = `${today.slice(0, 8)}01`
  const current = await api.get<RevenueReport>(`/api/admin/reports/revenue?from=${monthStart}&to=${today}`)
  expect(current.total.gross).toBeGreaterThanOrEqual(PRICE)

  await adminLogin(page, OWNER)
  await page.getByRole('link', { name: 'Báo cáo', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/reports\/revenue/)
  await expect(page.getByRole('heading', { level: 1, name: 'Báo cáo' })).toBeVisible()
  await expect(page.getByTestId('revenue-net')).toHaveText(vnd(current.total.net))

  // Tháng trước: ngày cuối là hôm trước ngày 1 của tháng này.
  const lastDay = vnDate(new Date(Date.parse(`${monthStart}T00:00:00+07:00`) - DAY))
  const from = `${lastDay.slice(0, 8)}01`
  const previous = await api.get<RevenueReport>(`/api/admin/reports/revenue?from=${from}&to=${lastDay}`)
  await page.getByLabel('Từ ngày').fill(from)
  await page.getByLabel('Đến ngày').fill(lastDay)
  await page.getByRole('button', { name: 'Xem' }).click()
  await expect(page).toHaveURL(new RegExp(`from=${from}&to=${lastDay}`))
  await expect(page.getByTestId('revenue-net')).toHaveText(vnd(previous.total.net))

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Xuất Excel' }).click(),
  ])
  expect(download.suggestedFilename()).toBe(`bao-cao-doanh-thu-${from}-${lastDay}.xlsx`)
})

/** Trang chủ quản trị của một nhân viên trong phiên trình duyệt riêng. */
async function dashboardOf(browser: Browser, credentials: { email: string; password: string }) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await adminLogin(page, credentials)
  return { page, close: () => context.close() }
}

test('kế toán thấy mục Báo cáo và khối "Cần xử lý"; nhân viên kho không thấy', async ({ browser }) => {
  const accountant = await dashboardOf(browser, ACCOUNTANT)
  await expect(accountant.page.getByRole('heading', { name: 'Cần xử lý' })).toBeVisible()
  await expect(accountant.page.getByTestId('exceptions-low-stock')).toBeVisible()
  await expect(accountant.page.getByRole('link', { name: 'Báo cáo', exact: true })).toBeVisible()
  await accountant.close()

  const warehouse = await dashboardOf(browser, WAREHOUSE)
  await expect(warehouse.page.getByTestId('dashboard-to-pick')).toBeVisible()
  await expect(warehouse.page.getByRole('heading', { name: 'Cần xử lý' })).toHaveCount(0)
  await expect(warehouse.page.getByRole('link', { name: 'Báo cáo', exact: true })).toHaveCount(0)
  await warehouse.close()
})
