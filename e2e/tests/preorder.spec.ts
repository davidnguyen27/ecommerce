// Vòng đời một đơn đặt trước qua giao diện thật (M4): chủ cửa hàng mở đợt cho biến thể hết hàng, khách đặt trước 2 đôi
// và trả cọc, kho ghi hai phiếu nhập (hàng về được chia cho đơn trước, dư mới thành hàng sẵn), khách trả phần còn lại,
// kho soạn, bàn giao, giao. Sau mỗi bước kiểm tồn, số đang giữ, sổ xuất nhập, ba trạng thái của đơn (qua API quản trị)
// và tình trạng biến thể khách thấy (qua API sản phẩm công khai).
import { expect, test, type Page } from '@playwright/test'
import type { AdminOrder, AdminOrderPage, PreorderCampaignPage, PublicProduct } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { AdminApi, BASE_URL, OWNER, PROVINCE_CODE, SHIPPING_FEE, WAREHOUSE } from '../support/stack.ts'

/** Biến thể hết hàng của sản phẩm seed: smoke không nhập hàng cho nó. */
const SKU = 'AM90-TRANG-41'
const QUANTITY = 2
const DEPOSIT_PERCENT = 30

const runId = Date.now().toString().slice(-8)
// Trang sản phẩm được cache theo URL tới 60 giây (ADR 0006), và smoke đã mở trang này lúc biến thể còn "Hết hàng":
// thêm tham số riêng của lượt chạy để đọc trang dựng sau khi mở đợt.
const PRODUCT_PATH = `/san-pham/air-max-90?sku=${SKU}&e2e=${runId}`
const BUYER = { name: 'Trần Thị Đặt Trước', phone: `08${runId}`, email: `dat-truoc-${runId}@example.com` }

type Status = Pick<AdminOrder, 'status' | 'paymentStatus' | 'fulfillmentStatus'>

/** Tình trạng biến thể khách thấy, từ API sản phẩm công khai (trang sản phẩm cache tới 60 giây nên không đọc HTML). */
async function availability() {
  const product = (await (await fetch(`${BASE_URL}/api/products/air-max-90`)).json()) as PublicProduct
  return product.variants.find((v) => v.sku === SKU)!
}

/** Đưa biến thể về trạng thái seed: không còn hàng sẵn, đợt cũ của sản phẩm (từ lượt chạy trước) đã đóng. */
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

/** Ghi phiếu nhập qua form, có bước xem trước; trả chữ của ô xem trước. */
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
  // Lượt trước dừng giữa chừng có thể để lại đơn đã cọc chờ hàng; hàng nhập về sẽ chia cho đơn đó trước.
  const waiting = await api.get<AdminOrderPage>(
    '/api/admin/orders?kind=preorder&status=processing&paymentStatus=deposit_paid&fulfillmentStatus=all&pageSize=1',
  )
  if (waiting.total > 0) throw new Error('Stack còn đơn đặt trước đã cọc từ lượt trước; dựng lại: pnpm smoke --keep')
  await resetVariant(api)
  const before = await api.stockOf(SKU)
  const ledgerBefore = await api.movementsOf(before.variantId)
  const price = (await availability()).price
  // 30% tiền hàng, làm tròn lên 1.000 (depositFor); phần còn lại gồm phí giao.
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

  // 1. Chủ cửa hàng mở đợt đặt trước cho biến thể hết hàng, ở trang quản trị.
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

  // 2. Khách thấy "Đặt trước" ở trang sản phẩm và đặt 2 đôi.
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

  // Cổng giả lập đòi đúng tiền cọc. Đơn chờ cọc chiếm suất, không giữ hàng, không ghi sổ.
  await expect(page.getByRole('heading', { level: 1, name: 'Cổng thanh toán giả lập' })).toBeVisible()
  const code = new URL(page.url()).searchParams.get('orderCode')!
  await expect(page.getByTestId('simulator-amount')).toHaveText(vnd(deposit))
  await expectOrder(code, { status: 'pending_payment', paymentStatus: 'unpaid', fulfillmentStatus: 'not_prepared' })
  await expectStock(before.onHand, before.reserved)
  await expectLedger(0)

  // 3. Giả lập đã trả cọc: đơn đã cọc, vẫn chưa có hàng.
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

  // 4. Kho ghi phiếu nhập 1 đôi: giữ hết cho đơn đã cọc, không thành hàng sẵn.
  const warehouse = await browser.newContext()
  const admin = await warehouse.newPage()
  admin.on('dialog', (dialog) => void dialog.accept())
  await adminLogin(admin, WAREHOUSE)
  expect(await receive(admin, 1)).toBe('1 cho 1 đơn · 0 thành hàng sẵn')
  expect((await api.order(code)).preorder).toMatchObject({ arrivedQuantity: 1, quantity: QUANTITY, arrivedAt: null })
  await expectStock(before.onHand + 1, before.reserved + 1)
  expect((await expectLedger(1)).items[0]).toMatchObject({ kind: 'receipt', quantity: 1 })
  expect((await availability()).availability).toBe('preorder')

  // Thêm 2 đôi: 1 đủ đơn (hàng đã về), 1 dư thành hàng sẵn.
  expect(await receive(admin, 2)).toBe('1 cho 1 đơn (1 đơn về đủ) · 1 thành hàng sẵn')
  const arrived = await api.order(code)
  expect(arrived.preorder).toMatchObject({ arrivedQuantity: QUANTITY, arrivedAt: expect.any(String) })
  await expectStock(before.onHand + 3, before.reserved + QUANTITY)
  await expectLedger(2)
  expect((await availability()).availability).toBe('in_stock')

  // 5. Khách trả phần còn lại từ trang đơn.
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

  // 6. Kho soạn, bàn giao (trừ tồn và nhả số đang giữ, ghi sổ xuất bán), đã giao.
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

  // Dọn để chạy lại trên cùng stack: đóng đợt, đưa biến thể về hết hàng.
  await resetVariant(api)
})

/** Định dạng tiền như `formatVnd` của web: `3.530.000 ₫`. */
function vnd(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`
}
