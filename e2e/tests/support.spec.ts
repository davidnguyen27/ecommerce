// Yêu cầu hỗ trợ, trả hàng, đổi hàng (M6b), bằng trình duyệt thật trên stack smoke với cổng giả lập:
// 1. Khách mua, trả, kho giao xong; khách gửi yêu cầu trả kèm ảnh; bán hàng nhận việc, chấp nhận; kho nhận hàng về; bán
//    hàng đề xuất hoàn; kế toán ghi chuyển khoản; khách thấy yêu cầu đã xong và khoản đã hoàn.
// 2. Khách đổi sang biến thể cùng giá còn hàng; bán hàng chấp nhận (hàng mới được giữ); kho nhận hàng cũ rồi bàn giao hàng
//    mới; khách thấy mã vận đơn.
// Mỗi luồng tự dọn: hàng trả về nhập lại tồn; biến thể đổi sang được đưa về giá và tồn như seed sau khi chạy.
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { AdminSupportRequest, StockItem } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { resetRateLimits } from '../support/rate-limit.ts'
import { ACCOUNTANT, AdminApi, PRICE, PRODUCT_PATH, PROVINCE_CODE, SALES, SKU, WAREHOUSE } from '../support/stack.ts'

const runId = Date.now().toString().slice(-7)
/** Biến thể thứ hai của sản phẩm seed: seed để giá 3.200.000 và hết hàng. Luồng đổi tạm đưa về cùng giá, có một cái. */
const OTHER_SKU = 'AM90-TRANG-41'
const OTHER_SEED = { price: 3_200_000, attributes: { mau: 'Trắng', size: '41' } }
/** Ảnh PNG 1×1 hợp lệ cho đính kèm (API kiểm nội dung và xử lý lại ảnh). */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.beforeAll(async () => {
  // Mỗi luồng đặt một đơn và gửi một yêu cầu: xóa bộ đếm giới hạn tần suất của stack smoke.
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

/** Đặt giá và tồn của biến thể đổi sang (tồn bằng kiểm kê: số đang giữ + `available`). */
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

/** Khách vãng lai mua một cái, trả qua cổng giả lập; owner chuẩn bị, bàn giao và ghi đã giao. Trả mã đơn và link đơn. */
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

/** Khách mở form gửi yêu cầu ở trang đơn, chọn loại, điền tiêu đề và nội dung (bước chọn dòng do `pick` làm). */
async function openRequest(page: Page, url: string, kind: string, pick: () => Promise<void>) {
  await page.goto(url)
  await page.getByRole('button', { name: 'Gửi yêu cầu' }).click()
  await page.getByLabel('Bạn cần gì').selectOption(kind)
  await pick()
  await page.getByLabel('Tiêu đề').fill(kind === 'return' ? 'Trả giày' : 'Đổi size')
  await page.getByLabel('Nội dung').fill(kind === 'return' ? 'Không vừa chân' : 'Chật, muốn đổi size 41')
}

/** Gửi form và chờ sang trang yêu cầu; trả mã yêu cầu và link trang yêu cầu. */
async function submitRequest(page: Page) {
  await page.getByRole('button', { name: 'Gửi yêu cầu' }).click()
  await page.waitForURL(/\/yeu-cau\/\d+/)
  await expect(page.getByTestId('support-status')).toHaveText('Đã gửi')
  return { code: Number(new URL(page.url()).pathname.split('/').at(-1)), url: page.url() }
}

/** Một trang quản trị của nhân viên, trong phiên trình duyệt riêng, tự đồng ý mọi hộp `confirm`. */
async function staffPage(browser: Browser, credentials: { email: string; password: string }, path: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('dialog', (dialog) => void dialog.accept())
  await adminLogin(page, credentials)
  await page.goto(path)
  return { page, close: () => context.close() }
}

/** Trang yêu cầu ở trang quản trị của một nhân viên. */
async function staffSupport(browser: Browser, credentials: { email: string; password: string }, code: number) {
  const staff = await staffPage(browser, credentials, `/admin/support/${code}`)
  await expect(staff.page.getByTestId('admin-support-status')).toBeVisible()
  return staff
}

/** Bán hàng nhận việc rồi chấp nhận kèm lời nhắn. */
async function claimAndAccept(browser: Browser, code: number) {
  const sales = await staffSupport(browser, SALES, code)
  await sales.page.getByRole('button', { name: 'Nhận việc' }).click()
  await expect(sales.page.getByTestId('admin-support-assignee')).toContainText(SALES.name)
  await sales.page.getByLabel(/Lời nhắn cho khách/).fill('Bạn gửi hàng về địa chỉ cửa hàng giúp shop.')
  await sales.page.getByRole('button', { name: 'Chấp nhận' }).click()
  await expect(sales.page.getByTestId('admin-support-status')).toHaveText('Đang xử lý')
  await sales.close()
}

/** Kho ghi nhận hàng khách gửi về, nhập lại tồn cả dòng (mặc định của form); trả trang để làm tiếp. */
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
  // Hàng trả về nhập lại tồn, sổ loại "return".
  const stock = await api.stockOf(SKU)
  expect(stock.onHand).toBe(before.onHand)
  expect((await api.movementsOf(stock.variantId)).items[0]).toMatchObject({ kind: 'return', quantity: 1 })

  // Bán hàng đề xuất hoàn số gợi ý (giá dòng, không gồm phí giao).
  const sales = await staffSupport(browser, SALES, request.code)
  await expect(sales.page.getByLabel('Số tiền hoàn (VND)')).toHaveValue(String(PRICE))
  await sales.page.getByRole('button', { name: 'Đề xuất hoàn và đóng yêu cầu' }).click()
  await expect(sales.page.getByTestId('admin-support-status')).toHaveText('Đã xong')
  await sales.close()
  expect(await api.order(order.code)).toMatchObject({ status: 'completed', refunding: PRICE })

  // Kế toán chuyển khoản ngoài hệ thống rồi ghi lại ở trang đơn.
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
    // Đưa biến thể đổi sang về như seed: giá cũ, hết hàng.
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

    // Chấp nhận: hàng mới được giữ ngay.
    await claimAndAccept(browser, request.code)
    expect((await api.stockOf(OTHER_SKU)).reserved).toBe(otherBefore.reserved + 1)

    // Kho nhận hàng cũ (nhập lại tồn) rồi bàn giao hàng mới.
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
