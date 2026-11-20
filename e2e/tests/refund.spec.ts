// Hủy đơn đã trả và hoàn tiền (M6a), bằng trình duyệt thật trên stack smoke với cổng giả lập:
// 1. Khách mua và trả; nhân viên bán hàng hủy đơn, đề xuất hoàn đủ; kế toán ghi chuyển khoản; khách thấy "đã hoàn".
// 2. Đơn đã bàn giao thì giao thất bại; kho nhận hàng hoàn về; bán hàng hủy; kế toán hoàn qua cổng (giả lập).
// Mỗi luồng tự dọn: hàng giữ được nhả, hàng hoàn về nhập lại tồn, nên tồn của biến thể seed như trước khi chạy.
import { expect, test, type Browser } from '@playwright/test'
import type { AdminOrder } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { buyAndPay } from '../support/purchase.ts'
import { resetRateLimits } from '../support/rate-limit.ts'
import { ACCOUNTANT, AdminApi, PRICE, SALES, SHIPPING_FEE, SKU, WAREHOUSE } from '../support/stack.ts'

const TOTAL = PRICE + SHIPPING_FEE
const runId = Date.now().toString().slice(-7)

test.beforeAll(async () => {
  // Hai luồng dưới đặt thêm hai đơn, vượt giới hạn 5 lần đặt mỗi IP mỗi giờ của cả lượt: xóa bộ đếm của stack smoke.
  resetRateLimits()
  // Mỗi luồng cần một cái bán được; các spec trước có thể đã bán bớt.
  const api = await AdminApi.owner()
  const stock = await api.stockOf(SKU)
  if (stock.onHand - stock.reserved < 1) {
    await api.send('POST', '/api/admin/stock/adjustments', {
      variantId: stock.variantId,
      reason: 'stocktake',
      countedQuantity: stock.reserved + 2,
      expectedOnHand: stock.onHand,
      note: 'E2E hoàn tiền: bổ sung hàng',
    })
  }
})

/** Trang quản trị của một nhân viên trong phiên trình duyệt riêng, tự đồng ý mọi hộp `confirm`. */
async function staffPage(browser: Browser, credentials: { email: string; password: string }, code: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('dialog', (dialog) => void dialog.accept())
  await adminLogin(page, credentials)
  await page.goto(`/admin/orders/${code}`)
  await expect(page.getByRole('heading', { level: 1, name: `Đơn hàng #${code}` })).toBeVisible()
  return { page, close: () => context.close() }
}

/** Nhân viên bán hàng hủy đơn đã trả với lý do đã chọn và số hoàn mặc định (toàn bộ). */
async function cancelPaid(browser: Browser, code: string, cause: string) {
  const sales = await staffPage(browser, SALES, code)
  await sales.page.getByTestId('admin-order-cancel-paid').click()
  await sales.page.getByTestId('cancel-paid-cause').selectOption({ label: cause })
  await expect(sales.page.getByTestId('cancel-paid-amount')).toHaveValue(String(TOTAL))
  await sales.page.getByTestId('cancel-paid-submit').click()
  await expect(sales.page.getByTestId('admin-order-status')).toHaveText('Đã hủy')
  await expect(sales.page.getByTestId('admin-refund-status')).toHaveText('Chờ hoàn')
  await sales.close()
}

type Status = Pick<AdminOrder, 'status' | 'paymentStatus' | 'fulfillmentStatus'>
const statusOf = (order: AdminOrder): Status => ({
  status: order.status,
  paymentStatus: order.paymentStatus,
  fulfillmentStatus: order.fulfillmentStatus,
})

test('hủy đơn đã trả, kế toán ghi chuyển khoản, khách thấy đã hoàn', async ({ page, browser }) => {
  const api = await AdminApi.owner()
  const before = await api.stockOf(SKU)
  const { code, url } = await buyAndPay(page, 'hoan', '1')
  expect((await api.stockOf(SKU)).reserved).toBe(before.reserved + 1)

  await cancelPaid(browser, code, 'Khách đổi ý')
  const cancelled = await api.order(code)
  expect(statusOf(cancelled)).toEqual({ status: 'cancelled', paymentStatus: 'paid', fulfillmentStatus: 'not_prepared' })
  expect(cancelled).toMatchObject({ cancelCause: 'changed_mind', received: TOTAL, refunding: TOTAL })
  // Hàng giữ cho đơn được nhả.
  expect((await api.stockOf(SKU)).reserved).toBe(before.reserved)

  // Khách thấy đơn đã hủy và khoản đang hoàn.
  await page.goto(url)
  await expect(page.getByTestId('order-cancelled')).toContainText('theo yêu cầu của bạn')
  await expect(page.getByTestId('order-refund')).toContainText('Đang hoàn')

  // Kế toán chuyển khoản ngoài hệ thống rồi ghi lại.
  const accountant = await staffPage(browser, ACCOUNTANT, code)
  await accountant.page.getByLabel('Mã giao dịch ngân hàng').fill(`FT${runId}`)
  await accountant.page.getByTestId('refund-manual').click()
  await expect(accountant.page.getByTestId('admin-refund-status')).toHaveText('Đã hoàn')
  await accountant.close()
  expect(await api.order(code)).toMatchObject({ refunded: TOTAL, refunding: 0 })

  await page.reload()
  await expect(page.getByTestId('order-refund')).toContainText('Đã hoàn')
  await expect(page.getByTestId('order-refunds')).not.toContainText(`FT${runId}`)
})

test('giao thất bại, nhận hàng hoàn về, hủy và hoàn qua cổng giả lập', async ({ page, browser }) => {
  const api = await AdminApi.owner()
  const before = await api.stockOf(SKU)
  const { code, url } = await buyAndPay(page, 'hoan', '2')

  // Kho chuẩn bị, bàn giao, rồi báo giao thất bại.
  const warehouse = await staffPage(browser, WAREHOUSE, code)
  await warehouse.page.getByRole('button', { name: 'Bắt đầu chuẩn bị' }).click()
  await warehouse.page.getByLabel('Đơn vị vận chuyển').fill('Giao Hàng Nhanh')
  await warehouse.page.getByLabel('Mã vận đơn').fill(`GHN${runId}`)
  await warehouse.page.getByRole('button', { name: 'Ghi bàn giao vận chuyển' }).click()
  await expect(warehouse.page.getByTestId('admin-order-shipment')).toContainText(`GHN${runId}`)
  expect((await api.stockOf(SKU)).onHand).toBe(before.onHand - 1)
  await warehouse.page.getByTestId('admin-order-delivery-failed').click()
  await expect(warehouse.page.getByTestId('admin-order-return-to-stock')).toBeVisible()

  // Hàng hoàn về nguyên vẹn: nhập lại tồn cả dòng (mặc định của form), ghi sổ "Hàng hoàn về" trỏ về đơn.
  await warehouse.page.getByRole('button', { name: 'Ghi nhận hàng hoàn về' }).click()
  await expect(warehouse.page.getByTestId('admin-order-returned-lines')).toContainText('nhập lại 1')
  await warehouse.close()
  expect(statusOf(await api.order(code))).toEqual({
    status: 'processing',
    paymentStatus: 'paid',
    fulfillmentStatus: 'returned',
  })
  const stock = await api.stockOf(SKU)
  expect(stock.onHand).toBe(before.onHand)
  expect((await api.movementsOf(stock.variantId)).items[0]).toMatchObject({
    kind: 'return',
    quantity: 1,
    orderCode: Number(code),
  })

  await cancelPaid(browser, code, 'Giao thất bại')
  expect(await api.order(code)).toMatchObject({ status: 'cancelled', cancelCause: 'delivery_failed' })

  // Kế toán hoàn qua cổng: trên stack smoke là cổng giả lập; số tiền tròn nên giả lập báo đã hoàn.
  const accountant = await staffPage(browser, ACCOUNTANT, code)
  await accountant.page.getByTestId('refund-gateway').click()
  await expect(accountant.page.getByTestId('admin-refund-status')).toHaveText('Đã hoàn')
  await accountant.close()
  const refunded = await api.order(code)
  expect(refunded).toMatchObject({ refunded: TOTAL, refunding: 0, refundable: 0 })
  expect(refunded.refunds[0]).toMatchObject({ method: 'vnpay', status: 'succeeded' })

  await page.goto(url)
  await expect(page.getByTestId('order-cancelled')).toContainText('đơn vị vận chuyển không giao được hàng')
  await expect(page.getByTestId('order-refund')).toContainText('Đã hoàn')
})
