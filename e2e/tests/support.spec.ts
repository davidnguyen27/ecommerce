// Support requests, returns, exchanges (M6b), in a real browser on the smoke stack with the simulator:
// 1. A customer buys, pays, the warehouse delivers; the customer sends a return with an image; sales takes and accepts
//    it; the warehouse receives the goods; sales proposes the refund; accounting records the transfer; the customer
// sees
//    the request done and the refund completed.
// 2. The customer exchanges to an in-stock variant at the same price; sales accepts (the new item is reserved); the
//    warehouse receives the old item then hands over the new one; the customer sees the tracking number.
// Each flow cleans up: returned goods restocked; the exchange variant's price and stock reset to the seed after the
// run.
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { AdminSupportRequest, StockItem } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { resetRateLimits } from '../support/rate-limit.ts'
import { ACCOUNTANT, AdminApi, PRICE, PRODUCT_PATH, PROVINCE_CODE, SALES, SKU, WAREHOUSE } from '../support/stack.ts'

const runId = Date.now().toString().slice(-7)
/**
 * The seed product's second variant: seeded at 3,200,000 and out of stock. The exchange flow briefly sets the same
 * price and one unit.
 */
const OTHER_SKU = 'AM90-TRANG-41'
const OTHER_SEED = { price: 3_200_000, attributes: { mau: 'Trắng', size: '41' } }
/** A valid 1×1 PNG for attachments (the API checks content and reprocesses images). */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.beforeAll(async () => {
  // Each flow places an order and sends a request: clear the smoke stack's rate limit counters.
  resetRateLimits()
  const api = await AdminApi.owner()
  const stock = await api.stockOf(SKU)
  if (stock.onHand - stock.reserved < 2) {
    await api.send('POST', '/api/admin/stock/adjustments', {
      variantId: stock.variantId,
      reason: 'stocktake',
      countedQuantity: stock.reserved + 3,
      expectedOnHand: stock.onHand,
      note: 'E2E hỗ trợ: bổ sung hàng',
    })
  }
})

/** Sets the exchange variant's price and stock (stock via stocktake: reserved + `available`). */
async function setOther(api: AdminApi, price: number, available: number) {
  const item: StockItem = await api.stockOf(OTHER_SKU)
  await api.send('PUT', `/api/admin/products/${item.product.id}/variants/${item.variantId}`, {
    sku: OTHER_SKU,
    attributes: OTHER_SEED.attributes,
    price,
  })
  if (item.onHand !== item.reserved + available) {
    await api.send('POST', '/api/admin/stock/adjustments', {
      variantId: item.variantId,
      reason: 'stocktake',
      countedQuantity: item.reserved + available,
      expectedOnHand: item.onHand,
      note: 'E2E đổi hàng',
    })
  }
}

/**
 * A guest buys one unit, pays via the simulator; the owner prepares, hands over and delivers. Returns code and link.
 */
async function deliveredOrder(page: Page, suffix: string) {
  await page.goto(PRODUCT_PATH)
  await page.getByRole('button', { name: 'Thêm vào giỏ' }).click()
  await page.getByRole('link', { name: 'Giỏ hàng, 1 món', exact: true }).click()
  await page.getByRole('link', { name: 'Đặt mua' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt mua' })).toBeVisible()
  await page.getByLabel('Họ tên người nhận').fill('Khách Đổi Trả')
  await page.getByLabel('Số điện thoại').fill(`07${runId}${suffix}`)
  await page.getByLabel('Email').fill(`doi-tra-${runId}-${suffix}@example.com`)
  await page.locator('select[name=province]').selectOption(PROVINCE_CODE)
  const ward = page.locator('select[name=ward]')
  await expect(ward).toBeEnabled()
  await ward.selectOption({ index: 1 })
  await page.getByLabel('Số nhà, tên đường').fill('1 Lê Lợi')
  await page.getByRole('checkbox', { name: /chính sách bảo mật/ }).check()
  await page.getByRole('button', { name: 'Đặt mua và thanh toán' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Cổng thanh toán giả lập' })).toBeVisible()
  const code = new URL(page.url()).searchParams.get('orderCode')!
  await page.getByRole('button', { name: 'Giả lập đã thanh toán' }).click()
  await expect(page.getByTestId('payment-status')).toHaveText('Đã thanh toán')
  const url = page.url()

  const api = await AdminApi.owner()
  await api.send('POST', `/api/admin/orders/${code}/prepare`)
  await api.send('POST', `/api/admin/orders/${code}/hand-over`, {
    carrier: 'Giao Hàng Nhanh',
    trackingNumber: `GHN${runId}${suffix}`,
  })
  await api.send('POST', `/api/admin/orders/${code}/deliver`)
  return { code, url }
}

/**
 * The customer opens the request form on the order page, picks the type, fills subject and body (`pick` picks lines).
 */
async function openRequest(page: Page, url: string, kind: string, pick: () => Promise<void>) {
  await page.goto(url)
  await page.getByRole('button', { name: 'Gửi yêu cầu' }).click()
  await page.getByLabel('Bạn cần gì').selectOption(kind)
  await pick()
  await page.getByLabel('Tiêu đề').fill(kind === 'return' ? 'Trả giày' : 'Đổi size')
  await page.getByLabel('Nội dung').fill(kind === 'return' ? 'Không vừa chân' : 'Chật, muốn đổi size 41')
}

/** Submits the form and waits for the request page; returns the request code and link. */
async function submitRequest(page: Page) {
  await page.getByRole('button', { name: 'Gửi yêu cầu' }).click()
  await page.waitForURL(/\/yeu-cau\/\d+/)
  await expect(page.getByTestId('support-status')).toHaveText('Đã gửi')
  return { code: Number(new URL(page.url()).pathname.split('/').at(-1)), url: page.url() }
}

/** A staff admin page in a separate browser session, accepting every `confirm` dialog. */
async function staffPage(browser: Browser, credentials: { email: string; password: string }, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('dialog', (dialog) => void dialog.accept())
  await adminLogin(page, credentials)
  await page.goto(path)
  return { page, close: () => context.close() }
}

/** The request page in a staff member's admin. */
async function staffSupport(browser: Browser, credentials: { email: string; password: string }, code: number) {
  const staff = await staffPage(browser, credentials, `/admin/support/${code}`)
  await expect(staff.page.getByTestId('admin-support-status')).toBeVisible()
  return staff
}

/** Sales takes the request, then accepts with a message. */
async function claimAndAccept(browser: Browser, code: number) {
  const sales = await staffSupport(browser, SALES, code)
  await sales.page.getByRole('button', { name: 'Nhận việc' }).click()
  await expect(sales.page.getByTestId('admin-support-assignee')).toContainText(SALES.name)
  await sales.page.getByLabel(/Lời nhắn cho khách/).fill('Bạn gửi hàng về địa chỉ cửa hàng giúp shop.')
  await sales.page.getByRole('button', { name: 'Chấp nhận' }).click()
  await expect(sales.page.getByTestId('admin-support-status')).toHaveText('Đang xử lý')
  await sales.close()
}

/** The warehouse records the goods received, restocking the whole line (form default); returns the page to continue. */
async function receive(browser: Browser, code: number) {
  const warehouse = await staffSupport(browser, WAREHOUSE, code)
  await warehouse.page.getByRole('button', { name: 'Ghi nhận hàng về' }).click()
  await expect(warehouse.page.getByTestId('admin-support-return')).toContainText('nhận hàng về')
  return warehouse
}

const supportOf = async (code: number) =>
  (await AdminApi.owner()).get<AdminSupportRequest>(`/api/admin/support-requests/${code}`)

test('trả hàng kèm ảnh: chấp nhận, nhận hàng về, đề xuất hoàn, kế toán ghi chuyển khoản', async ({ page, browser }) => {
  const api = await AdminApi.owner()
  const before = await api.stockOf(SKU)
  const order = await deliveredOrder(page, '1')
  expect((await api.stockOf(SKU)).onHand).toBe(before.onHand - 1)

  await openRequest(page, order.url, 'return', async () => {
    await page.getByRole('checkbox', { name: new RegExp(SKU) }).check()
  })
  await page.getByLabel(/Ảnh đính kèm/).setInputFiles({ name: 'loi.png', mimeType: 'image/png', buffer: PIXEL })
  const request = await submitRequest(page)
  await expect(page.getByTestId('support-message-item').first().locator('img')).toHaveCount(1)

  await claimAndAccept(browser, request.code)
  const warehouse = await receive(browser, request.code)
  await warehouse.close()
  // Returned goods are restocked, ledger kind "return".
  const stock = await api.stockOf(SKU)
  expect(stock.onHand).toBe(before.onHand)
  expect((await api.movementsOf(stock.variantId)).items[0]).toMatchObject({ kind: 'return', quantity: 1 })

  // Sales proposes the suggested refund (line price, shipping excluded).
  const sales = await staffSupport(browser, SALES, request.code)
  await expect(sales.page.getByLabel('Số tiền hoàn (VND)')).toHaveValue(String(PRICE))
  await sales.page.getByRole('button', { name: 'Đề xuất hoàn và đóng yêu cầu' }).click()
  await expect(sales.page.getByTestId('admin-support-status')).toHaveText('Đã xong')
  await sales.close()
  expect(await api.order(order.code)).toMatchObject({ status: 'completed', refunding: PRICE })

  // Accounting pays by transfer outside the system, then records it on the order page.
  const accountant = await staffPage(browser, ACCOUNTANT, `/admin/orders/${order.code}`)
  await accountant.page.getByLabel('Mã giao dịch ngân hàng').fill(`FT${runId}`)
  await accountant.page.getByTestId('refund-manual').click()
  await expect(accountant.page.getByTestId('admin-refund-status')).toHaveText('Đã hoàn')
  await accountant.close()
  expect(await api.order(order.code)).toMatchObject({ refunded: PRICE, refunding: 0 })

  await page.goto(request.url)
  await expect(page.getByTestId('support-status')).toHaveText('Đã xong')
  await page.goto(order.url)
  await expect(page.getByTestId('order-refund')).toContainText('Đã hoàn')
})

test.describe('đổi hàng', () => {
  test.afterAll(async () => {
    // Reset the exchange variant to the seed: old price, out of stock.
    await setOther(await AdminApi.owner(), OTHER_SEED.price, 0)
  })

  test('đổi sang biến thể cùng giá: giữ hàng, nhận hàng cũ, bàn giao hàng mới, khách thấy mã vận đơn', async ({
    page,
    browser,
  }) => {
    const api = await AdminApi.owner()
    await setOther(api, PRICE, 1)
    const before = await api.stockOf(SKU)
    const otherBefore = await api.stockOf(OTHER_SKU)
    const order = await deliveredOrder(page, '2')

    await openRequest(page, order.url, 'exchange', async () => {
      await page.getByRole('checkbox', { name: new RegExp(SKU) }).check()
      await expect(page.getByLabel('Đổi sang')).toContainText(OTHER_SKU)
    })
    const request = await submitRequest(page)
    await expect(page.getByTestId('support-lines')).toContainText(OTHER_SKU)

    // Accept: the new item is reserved at once.
    await claimAndAccept(browser, request.code)
    expect((await api.stockOf(OTHER_SKU)).reserved).toBe(otherBefore.reserved + 1)

    // The warehouse receives the old item (restocked), then hands over the new one.
    const warehouse = await receive(browser, request.code)
    await warehouse.page.getByLabel('Đơn vị vận chuyển').fill('Viettel Post')
    await warehouse.page.getByLabel('Mã vận đơn').fill(`VTP${runId}`)
    await warehouse.page.getByRole('button', { name: 'Bàn giao hàng đổi' }).click()
    await expect(warehouse.page.getByTestId('admin-exchange-shipment')).toContainText(`VTP${runId}`)
    await warehouse.close()

    expect(await supportOf(request.code)).toMatchObject({ status: 'resolved' })
    expect((await api.stockOf(SKU)).onHand).toBe(before.onHand)
    expect(await api.stockOf(OTHER_SKU)).toMatchObject({
      onHand: otherBefore.onHand - 1,
      reserved: otherBefore.reserved,
    })
    const other = await api.stockOf(OTHER_SKU)
    expect((await api.movementsOf(other.variantId)).items[0]).toMatchObject({ kind: 'sale', quantity: -1 })

    await page.goto(request.url)
    await expect(page.getByTestId('support-status')).toHaveText('Đã xong')
    await expect(page.getByTestId('support-exchange-shipment')).toContainText(`VTP${runId}`)
  })
})
