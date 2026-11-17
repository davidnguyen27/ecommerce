// Mã giảm giá qua giao diện thật (M5). Hàng sẵn: chủ cửa hàng tạo mã ở trang quản trị; khách áp một mã khác, mã đó bị
// tắt trước khi khách xác nhận nên đặt mua bị từ chối kèm hộp chọn; khách quay lại, áp mã mới, thấy tiền giảm và tổng mới,
// trả qua cổng giả lập; trang đơn hiện tiền giảm, trang quản trị thấy đơn ở chi tiết mã và khi lọc theo mã.
// Đặt trước: khách áp mã, tiền cọc và phần còn lại tính trên tiền hàng sau giảm, cổng đòi đúng tiền cọc đó.
//
// Spec này đặt 3 lần (2 đặt mua, 1 đặt trước); cùng hai spec kia là 5 lần, đúng giới hạn đặt mỗi IP mỗi giờ. Vì vậy
// "Đặt không dùng mã" không chạy ở đây (thêm một lần đặt nữa), chỉ kiểm hộp chọn hiện ra; nhánh đó có test API.
import { expect, test } from '@playwright/test'
import type { AdminProductList, PreorderCampaignPage, PublicProduct, VoucherOrderPage } from '@ecommerce/shared'
import { adminLogin } from '../support/admin-login.ts'
import { AdminApi, BASE_URL, OWNER, PRICE, PRODUCT_PATH, PROVINCE_CODE, SHIPPING_FEE } from '../support/stack.ts'

const runId = Date.now().toString().slice(-8)
/** Mã khách dùng được (tạo qua form quản trị) và mã sẽ bị tắt giữa chừng (tạo qua API). */
const CODE = `E2E${runId}`
const DISABLED_CODE = `TAT${runId}`
/** 10%, tối đa 500.000. */
const DISCOUNT = Math.min(500_000, Math.floor((PRICE * 0.1) / 1000) * 1000)

/** Biến thể hết hàng của sản phẩm seed, dùng cho đặt trước như preorder.spec. */
const PREORDER_SKU = 'AM90-TRANG-41'
const DEPOSIT_PERCENT = 30

const DAY = 24 * 60 * 60_000
/** Thời điểm cho `<input type="datetime-local">` theo giờ Việt Nam (múi giờ của trình duyệt E2E). */
const vnLocal = (offsetMs: number) => new Date(Date.now() + offsetMs + 7 * 3_600_000).toISOString().slice(0, 16)

async function fillContact(page: import('@playwright/test').Page, n: number) {
  await page.getByLabel('Họ tên người nhận').fill('Lê Văn Mã Giảm')
  await page.getByLabel('Số điện thoại').fill(`07${runId.slice(0, 7)}${n}`)
  await page.getByLabel('Email').fill(`ma-giam-${runId}-${n}@example.com`)
  // Nhãn "Tỉnh/thành" cũng khớp ô phường/xã, nên chọn theo name.
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

  // 1. Chủ cửa hàng tạo mã ở trang quản trị.
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

  // 2. Khách đặt 1 đôi, áp mã sẽ bị tắt: thấy tiền giảm và tổng mới.
  await page.goto(PRODUCT_PATH)
  await page.getByRole('button', { name: 'Thêm vào giỏ' }).click()
  await page.getByRole('link', { name: 'Giỏ hàng, 1 món', exact: true }).click()
  await page.getByRole('link', { name: 'Đặt mua' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt mua' })).toBeVisible()
  await fillContact(page, 1)
  await applyCode(page, DISABLED_CODE)
  await expect(page.getByTestId('discount')).toContainText(vnd(DISCOUNT))
  await expect(page.getByTestId('total')).toHaveText(vnd(PRICE - DISCOUNT + SHIPPING_FEE))

  // 3. Mã bị tắt trước khi khách xác nhận: đặt mua bị từ chối, khách thấy lý do và tổng khi không dùng mã.
  await api.send('POST', `/api/admin/vouchers/${disabled.id}/disable`)
  await page.getByRole('checkbox', { name: /chính sách bảo mật/ }).check()
  await page.getByRole('button', { name: 'Đặt mua và thanh toán' }).click()
  const conflict = page.getByTestId('voucher-conflict')
  await expect(conflict).toContainText('Mã giảm giá đã hết hạn')
  await expect(conflict).toContainText(vnd(PRICE + SHIPPING_FEE))
  await expect(conflict.getByRole('button', { name: 'Đặt không dùng mã' })).toBeVisible()
  await conflict.getByRole('button', { name: 'Quay lại' }).click()
  await expect(conflict).toBeHidden()

  // 4. Áp mã còn dùng được rồi đặt: cổng giả lập đòi đúng tổng sau giảm.
  await applyCode(page, CODE)
  await expect(page.getByText(`Mã ${CODE} đã áp dụng`)).toBeVisible()
  await expect(page.getByTestId('total')).toHaveText(vnd(PRICE - DISCOUNT + SHIPPING_FEE))
  await page.getByRole('button', { name: 'Đặt mua và thanh toán' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Cổng thanh toán giả lập' })).toBeVisible()
  const code = new URL(page.url()).searchParams.get('orderCode')!
  await expect(page.getByTestId('simulator-amount')).toHaveText(vnd(PRICE - DISCOUNT + SHIPPING_FEE))

  // 5. Giả lập đã thanh toán: trang đơn hiện tiền giảm.
  await page.getByRole('button', { name: 'Giả lập đã thanh toán' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Đơn hàng #${code}` })).toBeVisible()
  await expect(page.getByTestId('order-discount')).toContainText(CODE)
  await expect(page.getByTestId('order-discount')).toContainText(vnd(DISCOUNT))
  await expect(page.getByTestId('order-total')).toHaveText(vnd(PRICE - DISCOUNT + SHIPPING_FEE))
  const order = await api.order(code)
  expect(order).toMatchObject({ paymentStatus: 'paid', voucherCode: CODE, discount: DISCOUNT })
  expect(order.voucher).toMatchObject({ id: voucherId, kind: 'percent', percent: 10 })

  // 6. Trang quản trị: chi tiết mã liệt kê đơn, danh sách đơn lọc theo mã ra đúng đơn này.
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
  // Như preorder.spec: biến thể hết hàng sẵn, không còn đợt cũ đang mở, rồi mở một đợt mới.
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
  // Cọc 30% tiền hàng sau giảm, làm tròn lên 1.000; phần còn lại gồm phí giao.
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

  // Không trả cọc: đơn đã cọc không hủy được (M6) và sẽ chặn preorder.spec chạy lại trên cùng stack. Đơn chờ cọc tự hết
  // hạn; đóng đợt để biến thể về như trước.
  await closeOpen()
})

/** Định dạng tiền như `formatVnd` của web: `3.530.000 ₫`. */
function vnd(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`
}
