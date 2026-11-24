// The full purchase flow: a customer checks out, the simulator reports payment, the warehouse prepares, hands over and
// marks delivered. After each step it checks stock, reserved, ledger (admin API) and order status.
import { expect, test } from '@playwright/test'
import type { AdminOrder } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { AdminApi, PRICE, PRODUCT_PATH, PROVINCE_CODE, SHIPPING_FEE, SKU, WAREHOUSE } from '../support/stack.ts'

/** Unique email and phone per run, so reruns avoid the 3 pending orders per email/phone limit. */
const runId = Date.now().toString().slice(-8)
const BUYER = {
  name: 'Nguyễn Văn E2E',
  phone: `09${runId}`,
  email: `khach-${runId}@example.com`,
  street: '12 Nguyễn Huệ',
}

type Status = Pick<AdminOrder, 'status' | 'paymentStatus' | 'fulfillmentStatus'>

test('khách đặt mua, thanh toán giả lập, kho chuẩn bị, bàn giao và giao xong', async ({ page, browser }) => {
  const api = await AdminApi.owner()
  const before = await api.stockOf(SKU)
  const ledgerBefore = await api.movementsOf(before.variantId)

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
  /** Before handover there is no new ledger row for the variant. */
  const expectNoNewMovement = async () => {
    expect((await api.movementsOf(before.variantId)).total).toBe(ledgerBefore.total)
  }

  // 1. The customer adds to cart.
  await page.goto(PRODUCT_PATH)
  await page.getByRole('button', { name: 'Thêm vào giỏ' }).click()
  const cartLink = page.getByRole('link', { name: 'Giỏ hàng, 1 món', exact: true })
  await expect(cartLink).toBeVisible()

  await cartLink.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Giỏ hàng' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Air Max 90' })).toBeVisible()
  await page.getByRole('link', { name: 'Đặt mua' }).click()

  // 2. Checkout.
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt mua' })).toBeVisible()
  await page.getByLabel('Họ tên người nhận').fill(BUYER.name)
  await page.getByLabel('Số điện thoại').fill(BUYER.phone)
  await page.getByLabel('Email').fill(BUYER.email)
  // The "Tỉnh/thành" label also matches the ward field (option "Chọn tỉnh/thành trước"), so select by name.
  await page.locator('select[name=province]').selectOption(PROVINCE_CODE)
  const ward = page.locator('select[name=ward]')
  await expect(ward).toBeEnabled()
  await ward.selectOption({ index: 1 })
  await page.getByLabel('Số nhà, tên đường').fill(BUYER.street)
  await expect(page.getByTestId('shipping-fee')).toHaveText(vnd(SHIPPING_FEE))
  await expect(page.getByTestId('total')).toHaveText(vnd(PRICE + SHIPPING_FEE))
  await page.getByRole('checkbox', { name: /chính sách bảo mật/ }).check()
  await page.getByRole('button', { name: 'Đặt mua và thanh toán' }).click()

  // On to the payment simulator, the link carrying order code and amount.
  await expect(page.getByRole('heading', { level: 1, name: 'Cổng thanh toán giả lập' })).toBeVisible()
  const code = new URL(page.url()).searchParams.get('orderCode')
  expect(code).toMatch(/^\d+$/)
  await expect(page.getByTestId('simulator-amount')).toHaveText(vnd(PRICE + SHIPPING_FEE))

  // Checkout reserves one unit, deducts no stock, writes no ledger.
  await expectOrder(code!, { status: 'pending_payment', paymentStatus: 'unpaid', fulfillmentStatus: 'not_prepared' })
  await expectStock(before.onHand, before.reserved + 1)
  await expectNoNewMovement()

  // 3. Simulate payment, then back to the order page.
  await page.getByRole('button', { name: 'Giả lập đã thanh toán' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Đơn hàng #${code}` })).toBeVisible()
  await expect(page.getByTestId('order-status')).toHaveText('Đang xử lý')
  await expect(page.getByTestId('payment-status')).toHaveText('Đã thanh toán')
  await expect(page.getByTestId('fulfillment-status')).toHaveText('Chưa chuẩn bị')
  const customerOrderUrl = page.url()

  const paid = await expectOrder(code!, {
    status: 'processing',
    paymentStatus: 'paid',
    fulfillmentStatus: 'not_prepared',
  })
  expect(paid.payments.map((p) => ({ amount: p.amount, source: p.source }))).toEqual([
    { amount: PRICE + SHIPPING_FEE, source: 'simulator' },
  ])
  await expectStock(before.onHand, before.reserved + 1)
  await expectNoNewMovement()

  // 4. The warehouse clerk handles the order in admin, in a separate browser session.
  const staff = await browser.newContext()
  const admin = await staff.newPage()
  admin.on('dialog', (dialog) => void dialog.accept())
  await adminLogin(admin, WAREHOUSE)
  await admin.goto(`/admin/orders/${code}`)
  await expect(admin.getByRole('heading', { level: 1, name: `Đơn hàng #${code}` })).toBeVisible()
  await expect(admin.getByTestId('admin-order-status')).toHaveText('Đang xử lý')

  await admin.getByRole('button', { name: 'Bắt đầu chuẩn bị' }).click()
  await expect(admin.getByLabel('Đơn vị vận chuyển')).toBeVisible()
  await expectOrder(code!, { status: 'processing', paymentStatus: 'paid', fulfillmentStatus: 'preparing' })
  await expectStock(before.onHand, before.reserved + 1)
  await expectNoNewMovement()

  // Handover deducts stock and releases reserved together, writing one sale row.
  const trackingNumber = `GHN${runId}`
  await admin.getByLabel('Đơn vị vận chuyển').fill('Giao Hàng Nhanh')
  await admin.getByLabel('Mã vận đơn').fill(trackingNumber)
  await admin.getByRole('button', { name: 'Ghi bàn giao vận chuyển' }).click()
  await expect(admin.getByTestId('admin-order-shipment')).toContainText(trackingNumber)
  const handedOver = await expectOrder(code!, {
    status: 'processing',
    paymentStatus: 'paid',
    fulfillmentStatus: 'handed_over',
  })
  expect(handedOver.shipment).toMatchObject({ carrier: 'Giao Hàng Nhanh', trackingNumber })
  await expectStock(before.onHand - 1, before.reserved)
  const ledger = await api.movementsOf(before.variantId)
  expect(ledger.total).toBe(ledgerBefore.total + 1)
  expect(ledger.items[0]).toMatchObject({
    kind: 'sale',
    quantity: -1,
    onHandAfter: before.onHand - 1,
    orderCode: Number(code),
  })

  // 5. Delivered: the order completes, stock unchanged.
  await admin.getByRole('button', { name: 'Đã giao', exact: true }).click()
  await expect(admin.getByTestId('admin-order-status')).toHaveText('Hoàn tất')
  await expectOrder(code!, { status: 'completed', paymentStatus: 'paid', fulfillmentStatus: 'delivered' })
  await expectStock(before.onHand - 1, before.reserved)
  expect((await api.movementsOf(before.variantId)).total).toBe(ledgerBefore.total + 1)
  await staff.close()

  // The customer reopens the order and sees delivered with the tracking number.
  await page.goto(customerOrderUrl)
  await expect(page.getByTestId('order-status')).toHaveText('Hoàn tất')
  await expect(page.getByTestId('fulfillment-status')).toHaveText('Đã giao')
  await expect(page.getByTestId('order-tracking-number')).toHaveText(trackingNumber)
})

/** Money formatted like the web's `formatVnd`: `3.530.000 ₫`. */
function vnd(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`
}
