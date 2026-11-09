// Luồng mua hàng trọn vẹn: khách đặt mua, cổng giả lập báo đã trả, nhân viên kho chuẩn bị, bàn giao, đánh dấu đã giao.
// Sau mỗi bước kiểm tồn, số đang giữ, sổ xuất nhập (qua API quản trị) và trạng thái đơn.
import { expect, test } from '@playwright/test'
import type { AdminOrder } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { AdminApi, PRICE, PRODUCT_PATH, PROVINCE_CODE, SHIPPING_FEE, SKU, WAREHOUSE } from '../support/stack.ts'

/** Email và số điện thoại riêng cho mỗi lượt, để chạy lại không vướng giới hạn 3 đơn chờ mỗi email/số điện thoại. */
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
  /** Chưa bàn giao thì không có dòng sổ nào mới cho biến thể. */
  const expectNoNewMovement = async () => {
    expect((await api.movementsOf(before.variantId)).total).toBe(ledgerBefore.total)
  }

  // 1. Khách thêm vào giỏ.
  await page.goto(PRODUCT_PATH)
  await page.getByRole('button', { name: 'Thêm vào giỏ' }).click()
  // Tên đọc được của link là "Giỏ hàng , 1 món": trình duyệt chèn dấu cách giữa các span.
  const cartLink = page.getByRole('link', { name: /^Giỏ hàng\s*, 1 món$/ })
  await expect(cartLink).toBeVisible()

  await cartLink.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Giỏ hàng' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Air Max 90' })).toBeVisible()
  await page.getByRole('link', { name: 'Đặt mua' }).click()

  // 2. Đặt mua.
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt mua' })).toBeVisible()
  await page.getByLabel('Họ tên người nhận').fill(BUYER.name)
  await page.getByLabel('Số điện thoại').fill(BUYER.phone)
  await page.getByLabel('Email').fill(BUYER.email)
  // Nhãn "Tỉnh/thành" cũng khớp ô phường/xã (option "Chọn tỉnh/thành trước"), nên chọn theo name.
  await page.locator('select[name=province]').selectOption(PROVINCE_CODE)
  const ward = page.locator('select[name=ward]')
  await expect(ward).toBeEnabled()
  await ward.selectOption({ index: 1 })
  await page.getByLabel('Số nhà, tên đường').fill(BUYER.street)
  await expect(page.getByTestId('shipping-fee')).toHaveText(vnd(SHIPPING_FEE))
  await expect(page.getByTestId('total')).toHaveText(vnd(PRICE + SHIPPING_FEE))
  await page.getByRole('checkbox', { name: /chính sách bảo mật/ }).check()
  await page.getByRole('button', { name: 'Đặt mua và thanh toán' }).click()

  // Chuyển sang cổng thanh toán giả lập, link mang mã đơn và số tiền.
  await expect(page.getByRole('heading', { level: 1, name: 'Cổng thanh toán giả lập' })).toBeVisible()
  const code = new URL(page.url()).searchParams.get('orderCode')
  expect(code).toMatch(/^\d+$/)
  await expect(page.getByTestId('simulator-amount')).toHaveText(vnd(PRICE + SHIPPING_FEE))

  // Đặt mua giữ một cái, chưa trừ tồn, chưa ghi sổ.
  await expectOrder(code!, { status: 'pending_payment', paymentStatus: 'unpaid', fulfillmentStatus: 'not_prepared' })
  await expectStock(before.onHand, before.reserved + 1)
  await expectNoNewMovement()

  // 3. Giả lập đã thanh toán, rồi quay về trang đơn.
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

  // 4. Nhân viên kho xử lý đơn ở trang quản trị, trong một phiên trình duyệt riêng.
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

  // Bàn giao trừ tồn và nhả số đang giữ cùng lúc, ghi một dòng xuất bán.
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

  // 5. Đã giao: đơn hoàn tất, kho không đổi thêm.
  await admin.getByRole('button', { name: 'Đã giao', exact: true }).click()
  await expect(admin.getByTestId('admin-order-status')).toHaveText('Hoàn tất')
  await expectOrder(code!, { status: 'completed', paymentStatus: 'paid', fulfillmentStatus: 'delivered' })
  await expectStock(before.onHand - 1, before.reserved)
  expect((await api.movementsOf(before.variantId)).total).toBe(ledgerBefore.total + 1)
  await staff.close()

  // Khách mở lại đơn thấy đã giao và mã vận đơn.
  await page.goto(customerOrderUrl)
  await expect(page.getByTestId('order-status')).toHaveText('Hoàn tất')
  await expect(page.getByTestId('fulfillment-status')).toHaveText('Đã giao')
  await expect(page.getByTestId('order-tracking-number')).toHaveText(trackingNumber)
})

/** Định dạng tiền như `formatVnd` của web: `3.530.000 ₫`. */
function vnd(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`
}
