import { expect, type Page } from '@playwright/test'
import { AdminApi, PRODUCT_PATH, PROVINCE_CODE, SKU } from './stack.ts'

/** A unique number per run, so customer phone and email never collide with a previous run's pending orders. */
const runId = Date.now().toString().slice(-7)

/**
 * A guest buys one unit of the seed variant via cart and checkout, then presses "Giả lập đã thanh toán". `tag` and
 * `suffix` (one digit) tell customers apart across specs. Returns the order code and order page link.
 */
export async function buyAndPay(page: Page, tag: string, suffix: string) {
  await page.goto(PRODUCT_PATH)
  await page.getByRole('button', { name: 'Thêm vào giỏ' }).click()
  await page.getByRole('link', { name: 'Giỏ hàng, 1 món', exact: true }).click()
  await page.getByRole('link', { name: 'Đặt mua' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt mua' })).toBeVisible()
  await page.getByLabel('Họ tên người nhận').fill('Khách E2E')
  await page.getByLabel('Số điện thoại').fill(`08${runId}${suffix}`)
  await page.getByLabel('Email').fill(`${tag}-${runId}-${suffix}@example.com`)
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
  return { code, url: page.url() }
}

/** Ensures the seed variant has at least `count` sellable units; earlier specs may have sold some. */
export async function ensureSellable(count: number, note: string) {
  const api = await AdminApi.owner()
  const stock = await api.stockOf(SKU)
  if (stock.onHand - stock.reserved < count) {
    await api.send('POST', '/api/admin/stock/adjustments', {
      variantId: stock.variantId,
      reason: 'stocktake',
      countedQuantity: stock.reserved + count + 1,
      expectedOnHand: stock.onHand,
      note,
    })
  }
}
