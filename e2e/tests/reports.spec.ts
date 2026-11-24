// Reports (M7), in a real browser on the smoke stack:
// 1. A customer buys and pays; the order is delivered. The owner opens Reports and sees the period's revenue matching
//    the API; switches to last month; Excel export downloads a correctly named file.
// 2. The accountant sees Reports and the "Cần xử lý" block on the home page; the warehouse clerk sees neither.
// Figures are compared with the admin API, not fixed numbers, since other specs deliver orders on the same stack.
import { expect, test, type Browser } from '@playwright/test'
import type { RevenueReport } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { buyAndPay, ensureSellable } from '../support/purchase.ts'
import { resetRateLimits } from '../support/rate-limit.ts'
import { ACCOUNTANT, AdminApi, OWNER, PRICE, WAREHOUSE } from '../support/stack.ts'

const DAY = 24 * 60 * 60_000
/** Vietnam-time calendar day `YYYY-MM-DD`. */
const vnDate = (date: Date) => new Date(date.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10)
/** Like the admin page's `formatVnd`. */
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

  // Last month: its last day is the day before the 1st of this month.
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

/** A staff member's admin home in a separate browser session. */
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
