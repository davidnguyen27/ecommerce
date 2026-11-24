// Vouchers through the real UI (M5). In stock: the owner creates a voucher in admin; the customer applies another one,
// which is disabled before confirming, so checkout is rejected with a choice box; the customer goes back, applies the
// new voucher, sees the discount and new total, pays via the simulator; the order page shows the discount, and admin
// finds the order in the voucher detail and when filtering by voucher.
// Pre-order: the customer applies a voucher; deposit and remainder use goods after discount, and the gateway asks for
// exactly that deposit.
//
// This spec places 3 orders (2 checkouts, 1 pre-order); with the other two specs that is 5, exactly the per-IP hourly
// limit. So "Đặt không dùng mã" is not run here (one more order); only the choice box is checked. That branch has API
// tests.
import { expect, test } from '@playwright/test'
import type { AdminProductList, PreorderCampaignPage, PublicProduct, VoucherOrderPage } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { AdminApi, BASE_URL, OWNER, PRICE, PRODUCT_PATH, PROVINCE_CODE, SHIPPING_FEE } from '../support/stack.ts'

const runId = Date.now().toString().slice(-8)
/** A usable voucher (created via the admin form) and one disabled midway (created via the API). */
const CODE = `E2E${runId}`
const DISABLED_CODE = `TAT${runId}`
/** 10%, max 500,000. */
const DISCOUNT = Math.min(500_000, Math.floor((PRICE * 0.1) / 1000) * 1000)

/** The seed product's out-of-stock variant, used for pre-orders like preorder.spec. */
const PREORDER_SKU = 'AM90-TRANG-41'
const DEPOSIT_PERCENT = 30

const DAY = 24 * 60 * 60_000
/** A time for `<input type="datetime-local">` in Vietnam time (the E2E browser's time zone). */
const vnLocal = (offsetMs: number) => new Date(Date.now() + offsetMs + 7 * 3_600_000).toISOString().slice(0, 16)

async function fillContact(page: import('@playwright/test').Page, n: number) {
  await page.getByLabel('Họ tên người nhận').fill('Lê Văn Mã Giảm')
  await page.getByLabel('Số điện thoại').fill(`07${runId.slice(0, 7)}${n}`)
  await page.getByLabel('Email').fill(`ma-giam-${runId}-${n}@example.com`)
  // The "Tỉnh/thành" label also matches the ward field, so select by name.
  await page.locator('select[name=province]').selectOption(PROVINCE_CODE)
  const ward = page.locator('select[name=ward]')
  await expect(ward).toBeEnabled()
  await ward.selectOption({ index: 1 })
  await page.getByLabel('Số nhà, tên đường').fill('56 Pasteur')
}

async function applyCode(page: import('@playwright/test').Page, code: string) {
  await page.getByLabel('Mã giảm giá').fill(code)
  await page.getByRole('button', { name: 'Áp dụng' }).click()
}

test('chủ cửa hàng tạo mã; khách áp mã, mã bị tắt lúc xác nhận, áp mã khác, trả tiền sau giảm', async ({
  page,
  browser,
}) => {
  const api = await AdminApi.owner()
  const voucherBody = (code: string) => ({
    code,
    kind: 'percent',
    percent: 10,
    maxDiscount: 500_000,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
    saleTypes: ['standard', 'preorder'],
  })
  const disabled = await api.send<{ id: string }>('POST', '/api/admin/vouchers', voucherBody(DISABLED_CODE))

  // 1. The owner creates a voucher in admin.
  const ownerContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  await adminLogin(owner, OWNER)
  await owner.goto('/admin/vouchers/new')
  await owner.getByLabel('Mã *', { exact: true }).fill(CODE.toLowerCase())
  await owner.getByLabel('Tỷ lệ giảm (%) *').fill('10')
  await owner.getByLabel('Giảm tối đa (₫) *').fill('500000')
  await owner.getByLabel('Bắt đầu *').fill(vnLocal(-60 * 60_000))
  await owner.getByLabel('Kết thúc *').fill(vnLocal(30 * DAY))
  await owner.getByRole('button', { name: 'Tạo mã' }).click()
  await owner.waitForURL(/\/admin\/vouchers\/[0-9a-f-]{36}$/)
  const voucherId = owner.url().split('/').pop()!
  await expect(owner.getByRole('heading', { level: 1 })).toContainText(CODE)

  // 2. The customer orders 1 pair and applies the voucher about to be disabled: sees the discount and new total.
  await page.goto(PRODUCT_PATH)
  await page.getByRole('button', { name: 'Thêm vào giỏ' }).click()
  await page.getByRole('link', { name: 'Giỏ hàng, 1 món', exact: true }).click()
  await page.getByRole('link', { name: 'Đặt mua' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt mua' })).toBeVisible()
  await fillContact(page, 1)
  await applyCode(page, DISABLED_CODE)
  await expect(page.getByTestId('discount')).toContainText(vnd(DISCOUNT))
  await expect(page.getByTestId('total')).toHaveText(vnd(PRICE - DISCOUNT + SHIPPING_FEE))

  // 3. The voucher is disabled before confirming: checkout is rejected; the customer sees the reason and the total
  // without it.
  await api.send('POST', `/api/admin/vouchers/${disabled.id}/disable`)
  await page.getByRole('checkbox', { name: /chính sách bảo mật/ }).check()
  await page.getByRole('button', { name: 'Đặt mua và thanh toán' }).click()
  const conflict = page.getByTestId('voucher-conflict')
  await expect(conflict).toContainText('Mã giảm giá đã hết hạn')
  await expect(conflict).toContainText(vnd(PRICE + SHIPPING_FEE))
  await expect(conflict.getByRole('button', { name: 'Đặt không dùng mã' })).toBeVisible()
  await conflict.getByRole('button', { name: 'Quay lại' }).click()
  await expect(conflict).toBeHidden()

  // 4. Apply a still-valid voucher and order: the simulator asks for exactly the discounted total.
  await applyCode(page, CODE)
  await expect(page.getByText(`Mã ${CODE} đã áp dụng`)).toBeVisible()
  await expect(page.getByTestId('total')).toHaveText(vnd(PRICE - DISCOUNT + SHIPPING_FEE))
  await page.getByRole('button', { name: 'Đặt mua và thanh toán' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Cổng thanh toán giả lập' })).toBeVisible()
  const code = new URL(page.url()).searchParams.get('orderCode')!
  await expect(page.getByTestId('simulator-amount')).toHaveText(vnd(PRICE - DISCOUNT + SHIPPING_FEE))

  // 5. Simulate payment: the order page shows the discount.
  await page.getByRole('button', { name: 'Giả lập đã thanh toán' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Đơn hàng #${code}` })).toBeVisible()
  await expect(page.getByTestId('order-discount')).toContainText(CODE)
  await expect(page.getByTestId('order-discount')).toContainText(vnd(DISCOUNT))
  await expect(page.getByTestId('order-total')).toHaveText(vnd(PRICE - DISCOUNT + SHIPPING_FEE))
  const order = await api.order(code)
  expect(order).toMatchObject({ paymentStatus: 'paid', voucherCode: CODE, discount: DISCOUNT })
  expect(order.voucher).toMatchObject({ id: voucherId, kind: 'percent', percent: 10 })

  // 6. Admin: the voucher detail lists the order, and the order list filtered by voucher finds exactly it.
  const used = await api.get<VoucherOrderPage>(`/api/admin/vouchers/${voucherId}/orders`)
  expect(used.items.map((o) => o.code)).toEqual([Number(code)])
  await owner.goto(`/admin/vouchers/${voucherId}`)
  await expect(owner.getByTestId('voucher-order')).toContainText(`#${code}`)
  await owner.getByRole('link', { name: 'Lọc ở danh sách đơn' }).click()
  await expect(owner.getByLabel('Mã giảm giá')).toHaveValue(CODE)
  await expect(owner.locator('main')).toContainText(code)
  await owner.goto(`/admin/orders/${code}`)
  await expect(owner.getByTestId('admin-order-discount')).toContainText(CODE)
  await ownerContext.close()
})

test('khách đặt trước kèm mã: tiền cọc và phần còn lại tính trên tiền hàng sau giảm', async ({ page }) => {
  const api = await AdminApi.owner()
  const stock = await api.stockOf(PREORDER_SKU)
  // As in preorder.spec: the variant has no regular stock and no old open campaign, then open a new one.
  if (stock.onHand !== stock.reserved) {
    await api.send('POST', '/api/admin/stock/adjustments', {
      variantId: stock.variantId,
      reason: 'stocktake',
      countedQuantity: stock.reserved,
      expectedOnHand: stock.onHand,
      note: 'E2E: đưa biến thể đặt trước về hết hàng',
    })
  }
  const closeOpen = async () => {
    const open = await api.get<PreorderCampaignPage>('/api/admin/preorder-campaigns?state=open')
    for (const campaign of open.items.filter((c) => c.product.slug === 'air-max-90')) {
      await api.send('POST', `/api/admin/preorder-campaigns/${campaign.id}/close`)
    }
  }
  await closeOpen()
  const product = (await (await fetch(`${BASE_URL}/api/products/air-max-90`)).json()) as PublicProduct
  const productId = (await api.get<AdminProductList>('/api/admin/products')).items.find(
    (p) => p.slug === 'air-max-90',
  )!.id
  await api.send('POST', '/api/admin/preorder-campaigns', {
    productId,
    depositPercent: DEPOSIT_PERCENT,
    deliveryFrom: '2026-12-10',
    deliveryTo: '2026-12-20',
    closesAt: new Date(Date.now() + 14 * DAY).toISOString(),
    variants: [{ variantId: stock.variantId, allocation: 5 }],
  })
  const price = product.variants.find((v) => v.sku === PREORDER_SKU)!.price
  const discount = Math.min(500_000, Math.floor((price * 0.1) / 1000) * 1000)
  // Deposit is 30% of goods after discount, rounded up to 1,000; the remainder includes shipping.
  const deposit = Math.ceil(((price - discount) * DEPOSIT_PERCENT) / 100 / 1000) * 1000
  const remaining = price - discount + SHIPPING_FEE - deposit

  await page.goto(`/dat-truoc/${stock.variantId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt trước' })).toBeVisible()
  await fillContact(page, 2)
  await applyCode(page, CODE)
  await expect(page.getByTestId('discount')).toContainText(vnd(discount))
  await expect(page.getByTestId('deposit')).toHaveText(vnd(deposit))
  await expect(page.getByTestId('remaining')).toHaveText(vnd(remaining))
  await page.getByRole('checkbox', { name: /chính sách đặt trước/ }).check()
  await page.getByRole('checkbox', { name: /chính sách bảo mật/ }).check()
  await page.getByRole('button', { name: 'Đặt trước và trả cọc' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Cổng thanh toán giả lập' })).toBeVisible()
  const code = new URL(page.url()).searchParams.get('orderCode')!
  await expect(page.getByTestId('simulator-amount')).toHaveText(vnd(deposit))
  const order = await api.order(code)
  expect(order).toMatchObject({ kind: 'preorder', voucherCode: CODE, discount })
  expect(order.preorder).toMatchObject({ depositAmount: deposit, remainingAmount: remaining })

  // Do not pay the deposit: a deposited order cannot be cancelled (M6) and would block preorder.spec reruns on the same
  // stack. A pending deposit expires on its own; close the campaign to reset the variant.
  await closeOpen()
})

/** Money formatted like the web's `formatVnd`: `3.530.000 ₫`. */
function vnd(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`
}
