// A pre-order's lifecycle through the real UI (M4): the owner opens a campaign for an out-of-stock variant, a customer
// pre-orders 2 pairs and pays the deposit, the warehouse records two receipts (arrivals go to the order first, the rest
// becomes regular stock), the customer pays the remainder, the warehouse packs, hands over, delivers. After each step
// it checks stock, reserved, ledger, the order's three statuses (admin API) and the variant status customers see
// (public product API).
import { expect, test, type Page } from '@playwright/test'
import type { AdminOrder, AdminOrderPage, PreorderCampaignPage, PublicProduct } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { AdminApi, BASE_URL, OWNER, PROVINCE_CODE, SHIPPING_FEE, WAREHOUSE } from '../support/stack.ts'

/** The seed product's out-of-stock variant: smoke never stocks it. */
const SKU = 'AM90-TRANG-41'
const QUANTITY = 2
const DEPOSIT_PERCENT = 30

const runId = Date.now().toString().slice(-8)
// Product pages are cached per URL for up to 60 seconds (ADR 0006), and smoke opened this one while "Hết hàng": add a
// per-run param to read a page built after the campaign opened.
const PRODUCT_PATH = `/san-pham/air-max-90?sku=${SKU}&e2e=${runId}`
const BUYER = { name: 'Trần Thị Đặt Trước', phone: `08${runId}`, email: `dat-truoc-${runId}@example.com` }

type Status = Pick<AdminOrder, 'status' | 'paymentStatus' | 'fulfillmentStatus'>

/** The variant status customers see, from the public product API (product pages are cached 60 s, so not the HTML). */
async function availability() {
  const product = (await (await fetch(`${BASE_URL}/api/products/air-max-90`)).json()) as PublicProduct
  return product.variants.find((v) => v.sku === SKU)!
}

/** Resets the variant to its seed state: no regular stock, the product's old campaign (from a previous run) closed. */
async function resetVariant(api: AdminApi) {
  const stock = await api.stockOf(SKU)
  if (stock.onHand !== stock.reserved) {
    await api.send('POST', '/api/admin/stock/adjustments', {
      variantId: stock.variantId,
      reason: 'stocktake',
      countedQuantity: stock.reserved,
      expectedOnHand: stock.onHand,
      note: 'E2E: đưa biến thể đặt trước về hết hàng',
    })
  }
  const open = await api.get<PreorderCampaignPage>('/api/admin/preorder-campaigns?state=open')
  for (const campaign of open.items.filter((c) => c.product.slug === 'air-max-90')) {
    await api.send('POST', `/api/admin/preorder-campaigns/${campaign.id}/close`)
  }
}

/** Records a receipt through the form, with the preview step; returns the preview text. */
async function receive(admin: Page, quantity: number) {
  await admin.goto('/admin/stock/receipts')
  await admin.getByRole('button', { name: '+ Tạo phiếu nhập' }).click()
  await admin.getByLabel('Nhà cung cấp *').fill('Nike Việt Nam')
  await admin.getByLabel('SKU').fill(SKU)
  await admin.getByLabel('Số lượng').fill(String(quantity))
  await admin.getByRole('button', { name: 'Xem trước phần chia' }).click()
  const preview = admin.getByTestId('receipt-preview')
  await expect(preview).toBeVisible()
  const text = (await preview.innerText()).replace(/\s+/g, ' ').trim()
  await admin.getByRole('button', { name: 'Ghi phiếu nhập' }).click()
  await expect(admin.getByRole('status')).toContainText('Đã ghi phiếu nhập')
  return text
}

test('mở đợt, đặt trước và cọc, hàng về hai lần, trả phần còn lại, rồi soạn, bàn giao, giao', async ({
  page,
  browser,
}) => {
  const api = await AdminApi.owner()
  // A previous run stopped midway may leave a deposited order awaiting stock; arrivals go to that order first.
  const waiting = await api.get<AdminOrderPage>(
    '/api/admin/orders?kind=preorder&status=processing&paymentStatus=deposit_paid&fulfillmentStatus=all&pageSize=1',
  )
  if (waiting.total > 0) throw new Error('Stack còn đơn đặt trước đã cọc từ lượt trước; dựng lại: pnpm smoke --keep')
  await resetVariant(api)
  const before = await api.stockOf(SKU)
  const ledgerBefore = await api.movementsOf(before.variantId)
  const price = (await availability()).price
  // 30% of goods, rounded up to 1,000 (depositFor); the remainder includes shipping.
  const deposit = Math.ceil((price * QUANTITY * DEPOSIT_PERCENT) / 100 / 1000) * 1000
  const remaining = price * QUANTITY + SHIPPING_FEE - deposit

  const expectStock = async (onHand: number, reserved: number) => {
    const now = await api.stockOf(SKU)
    expect({ onHand: now.onHand, reserved: now.reserved }).toEqual({ onHand, reserved })
  }
  const expectOrder = async (code: string, status: Status) => {
    const order = await api.order(code)
    expect({
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
    }).toEqual(status)
    return order
  }
  const expectLedger = async (added: number) => {
    const ledger = await api.movementsOf(before.variantId)
    expect(ledger.total).toBe(ledgerBefore.total + added)
    return ledger
  }

  // 1. The owner opens a pre-order campaign for the out-of-stock variant in admin.
  expect((await availability()).availability).toBe('out_of_stock')
  const ownerContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  await adminLogin(owner, OWNER)
  await owner.goto('/admin/preorders/new')
  const productOption = owner.locator('#preorder-product option', { hasText: 'Air Max 90' })
  await owner.getByLabel('Sản phẩm (đã xuất bản) *').selectOption((await productOption.getAttribute('value'))!)
  await owner.getByLabel('Mức cọc (%) *').fill(String(DEPOSIT_PERCENT))
  await owner.getByLabel('Giao dự kiến từ ngày *').fill('2026-12-10')
  await owner.getByLabel('đến ngày *').fill('2026-12-20')
  const closesAt = new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString().slice(0, 16)
  await owner.getByLabel('Hạn đóng nhận đặt *').fill(closesAt)
  await owner.getByLabel(`Nhận đặt ${SKU}`).check()
  await owner.getByLabel(`Số suất ${SKU}`).fill('5')
  await owner.getByRole('button', { name: 'Mở đợt' }).click()
  await owner.waitForURL(/\/admin\/preorders\/[0-9a-f-]{36}$/)
  const campaignId = owner.url().split('/').pop()!
  await expect(owner.getByRole('heading', { level: 1 })).toContainText('Air Max 90')
  await ownerContext.close()
  expect(await availability()).toMatchObject({
    availability: 'preorder',
    preorder: { campaignId, depositPercent: DEPOSIT_PERCENT, deliveryFrom: '2026-12-10', deliveryTo: '2026-12-20' },
  })

  // 2. The customer sees "Đặt trước" on the product page and pre-orders 2 pairs.
  await page.goto(PRODUCT_PATH)
  await expect(page.getByTestId('availability')).toHaveText('Đặt trước')
  await expect(page.getByTestId('preorder-offer')).toContainText(`Cọc ${DEPOSIT_PERCENT}%`)
  await page.getByRole('link', { name: 'Đặt trước', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt trước' })).toBeVisible()
  await page.locator('select[name=quantity]').selectOption(String(QUANTITY))
  await page.getByLabel('Họ tên người nhận').fill(BUYER.name)
  await page.getByLabel('Số điện thoại').fill(BUYER.phone)
  await page.getByLabel('Email').fill(BUYER.email)
  await page.locator('select[name=province]').selectOption(PROVINCE_CODE)
  const ward = page.locator('select[name=ward]')
  await expect(ward).toBeEnabled()
  await ward.selectOption({ index: 1 })
  await page.getByLabel('Số nhà, tên đường').fill('34 Lê Lợi')
  await expect(page.getByTestId('deposit')).toHaveText(vnd(deposit))
  await expect(page.getByTestId('remaining')).toHaveText(vnd(remaining))
  await page.getByRole('checkbox', { name: /chính sách đặt trước/ }).check()
  await page.getByRole('checkbox', { name: /chính sách bảo mật/ }).check()
  await page.getByRole('button', { name: 'Đặt trước và trả cọc' }).click()

  // The simulator asks for exactly the deposit. A pending deposit takes allocation, reserves no stock, writes no
  // ledger.
  await expect(page.getByRole('heading', { level: 1, name: 'Cổng thanh toán giả lập' })).toBeVisible()
  const code = new URL(page.url()).searchParams.get('orderCode')!
  await expect(page.getByTestId('simulator-amount')).toHaveText(vnd(deposit))
  await expectOrder(code, { status: 'pending_payment', paymentStatus: 'unpaid', fulfillmentStatus: 'not_prepared' })
  await expectStock(before.onHand, before.reserved)
  await expectLedger(0)

  // 3. Simulate the deposit: the order is deposited, still no stock.
  await page.getByRole('button', { name: 'Giả lập đã thanh toán' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Đơn hàng #${code}` })).toBeVisible()
  await expect(page.getByTestId('payment-status')).toHaveText('Đã cọc')
  await expect(page.getByTestId('order-deposit')).toHaveText(vnd(deposit))
  const customerOrderUrl = page.url()
  const deposited = await expectOrder(code, {
    status: 'processing',
    paymentStatus: 'deposit_paid',
    fulfillmentStatus: 'not_prepared',
  })
  expect(deposited.payments.map((p) => ({ purpose: p.purpose, amount: p.amount }))).toEqual([
    { purpose: 'deposit', amount: deposit },
  ])
  await expectStock(before.onHand, before.reserved)
  expect((await availability()).availability).toBe('preorder')

  // 4. The warehouse receives 1 pair: all reserved for the deposited order, none becomes regular stock.
  const warehouse = await browser.newContext()
  const admin = await warehouse.newPage()
  admin.on('dialog', (dialog) => void dialog.accept())
  await adminLogin(admin, WAREHOUSE)
  expect(await receive(admin, 1)).toBe('1 cho 1 đơn · 0 thành hàng sẵn')
  expect((await api.order(code)).preorder).toMatchObject({ arrivedQuantity: 1, quantity: QUANTITY, arrivedAt: null })
  await expectStock(before.onHand + 1, before.reserved + 1)
  expect((await expectLedger(1)).items[0]).toMatchObject({ kind: 'receipt', quantity: 1 })
  expect((await availability()).availability).toBe('preorder')

  // 2 more pairs: 1 completes the order (arrived), 1 left becomes regular stock.
  expect(await receive(admin, 2)).toBe('1 cho 1 đơn (1 đơn về đủ) · 1 thành hàng sẵn')
  const arrived = await api.order(code)
  expect(arrived.preorder).toMatchObject({ arrivedQuantity: QUANTITY, arrivedAt: expect.any(String) })
  await expectStock(before.onHand + 3, before.reserved + QUANTITY)
  await expectLedger(2)
  expect((await availability()).availability).toBe('in_stock')

  // 5. The customer pays the remainder from the order page.
  await page.goto(customerOrderUrl)
  await expect(page.getByTestId('order-remainder')).toContainText(vnd(remaining))
  await page.getByRole('button', { name: 'Trả phần còn lại' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Cổng thanh toán giả lập' })).toBeVisible()
  await expect(page.getByTestId('simulator-amount')).toHaveText(vnd(remaining))
  await page.getByRole('button', { name: 'Giả lập đã thanh toán' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Đơn hàng #${code}` })).toBeVisible()
  await expect(page.getByTestId('payment-status')).toHaveText('Đã thanh toán')
  const paid = await expectOrder(code, {
    status: 'processing',
    paymentStatus: 'paid',
    fulfillmentStatus: 'not_prepared',
  })
  expect(paid.payments.map((p) => ({ purpose: p.purpose, amount: p.amount }))).toEqual([
    { purpose: 'deposit', amount: deposit },
    { purpose: 'remainder', amount: remaining },
  ])
  await expectStock(before.onHand + 3, before.reserved + QUANTITY)

  // 6. The warehouse packs, hands over (deducts stock and releases reserved, sale ledger row), delivers.
  await admin.goto(`/admin/orders/${code}`)
  await admin.getByRole('button', { name: 'Bắt đầu chuẩn bị' }).click()
  await expect(admin.getByLabel('Đơn vị vận chuyển')).toBeVisible()
  await expectOrder(code, { status: 'processing', paymentStatus: 'paid', fulfillmentStatus: 'preparing' })
  const trackingNumber = `GHTK${runId}`
  await admin.getByLabel('Đơn vị vận chuyển').fill('Giao Hàng Tiết Kiệm')
  await admin.getByLabel('Mã vận đơn').fill(trackingNumber)
  await admin.getByRole('button', { name: 'Ghi bàn giao vận chuyển' }).click()
  await expect(admin.getByTestId('admin-order-shipment')).toContainText(trackingNumber)
  await expectOrder(code, { status: 'processing', paymentStatus: 'paid', fulfillmentStatus: 'handed_over' })
  await expectStock(before.onHand + 1, before.reserved)
  expect((await expectLedger(3)).items[0]).toMatchObject({
    kind: 'sale',
    quantity: -QUANTITY,
    onHandAfter: before.onHand + 1,
    orderCode: Number(code),
  })
  await admin.getByRole('button', { name: 'Đã giao', exact: true }).click()
  await expect(admin.getByTestId('admin-order-status')).toHaveText('Hoàn tất')
  await expectOrder(code, { status: 'completed', paymentStatus: 'paid', fulfillmentStatus: 'delivered' })
  await warehouse.close()

  // Clean up for reruns on the same stack: close the campaign, return the variant to out of stock.
  await resetVariant(api)
})

/** Money formatted like the web's `formatVnd`: `3.530.000 ₫`. */
function vnd(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`
}
