import { PREORDER_POLICY_SLUG } from '@ecommerce/shared'
import { expect } from 'vitest'
import type { PaymentInfo } from '../../src/payments/gateway.ts'
import { register } from './customer.ts'
import { ADDRESS, shop } from './shop.ts'
import { bearer } from './staff.ts'

const DAY = 24 * 60 * 60_000
export const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()

/**
 * Cửa hàng của `shop()` (Air Max đã xuất bản: AM-40 còn 3 đôi giá 2.000.000, AM-41 hết hàng giá 2.100.000), có thêm
 * chính sách đặt trước đã xuất bản. `open` mở đợt cọc 30%, giao 10–20/12/2026, mặc định AM-40 10 suất và AM-41 5 suất;
 * `preorder` đặt trước như khách vãng lai, mặc định 1 đôi AM-41 theo đợt `campaignId`.
 */
export async function preorderShop(options?: { publishPolicy?: boolean } & Parameters<typeof shop>[0]) {
  const app = await shop(options)
  const { request, token, product, v40, v41 } = app

  if (options?.publishPolicy !== false) {
    const page = await request
      .post('/api/admin/pages')
      .set(bearer(token))
      .send({ slug: PREORDER_POLICY_SLUG, kind: 'policy', title: 'Chính sách đặt trước', body: 'Cọc không hoàn.' })
    expect(page.status).toBe(201)
    expect((await request.post(`/api/admin/pages/${page.body.id}/publish`).set(bearer(token))).status).toBe(200)
  }

  const open = async (
    variants = [
      { variantId: v40.id, allocation: 10 },
      { variantId: v41.id, allocation: 5 },
    ],
    overrides: Record<string, unknown> = {},
  ) => {
    const res = await request
      .post('/api/admin/preorder-campaigns')
      .set(bearer(token))
      .send({
        productId: product.id,
        depositPercent: 30,
        deliveryFrom: '2026-12-10',
        deliveryTo: '2026-12-20',
        closesAt: inDays(14),
        variants,
        ...overrides,
      })
    expect(res.status).toBe(201)
    return res.body.id as string
  }

  const quote = (body: Record<string, unknown> = {}) =>
    request.post('/api/preorders/quote').send({ variantId: v41.id, quantity: 1, ...body })

  const preorder = (campaignId: string, body: Record<string, unknown> = {}) =>
    request.post('/api/preorders').send({
      variantId: v41.id,
      quantity: 1,
      campaignId,
      price: 2_100_000,
      depositPercent: 30,
      address: ADDRESS,
      acceptPrivacyPolicy: true,
      acceptPreorderPolicy: true,
      ...body,
    })

  /** Đặt trước thành công, trả mã đơn và token tra cứu. */
  const placed = async (campaignId: string, body: Record<string, unknown> = {}) => {
    const res = await preorder(campaignId, body)
    expect(res.status).toBe(201)
    return res.body as { code: number; token: string; checkoutUrl: string; reservedUntil: string }
  }

  return { ...app, open, quote, preorder, placed }
}

/** 1 đôi AM-41: tiền hàng 2.100.000 + phí giao 30.000, cọc 30% = 630.000, còn lại 1.500.000. */
export const DEPOSIT = 630_000
export const REMAINING = 1_500_000

export const paid = (...payments: [amount: number, reference: string][]): PaymentInfo => ({
  status: 'paid',
  transactions: payments.map(([amount, reference]) => ({ reference, amount, paidAt: new Date() })),
})

/**
 * Một đơn đặt trước 1 đôi AM-41 đã cọc. `arrive()` ghi phiếu nhập 1 đôi để đơn về đủ hàng. `payRemainder()` gọi API trả
 * phần còn lại bằng token tra cứu; `settle(...)` cho cổng báo các khoản đã về qua link phần còn lại đầu tiên rồi hỏi cổng.
 */
export async function depositedPreorder({ signedIn = false } = {}) {
  const app = await preorderShop()
  const { request, token: adminToken, v41 } = app
  const campaignId = await app.open([{ variantId: v41.id, allocation: 5 }])
  // Khách đăng nhập thì đơn gắn với tài khoản và không cần tick chính sách bảo mật.
  const customerToken = signedIn ? ((await register(request)).body.accessToken as string) : null
  const res = customerToken
    ? await app.preorder(campaignId, { acceptPrivacyPolicy: undefined }).set(bearer(customerToken))
    : await app.preorder(campaignId)
  expect(res.status).toBe(201)
  const { code, token: orderToken } = res.body as { code: number; token: string }
  const order = (query: Record<string, string> = {}) =>
    request.get(`/api/orders/${code}`).query({ token: orderToken, ...query })
  app.payments.payments.set(`${code}-deposit-1`, paid([DEPOSIT, `FT-DEP-${code}`]))
  expect((await order({ refresh: '1' })).body.paymentStatus).toBe('deposit_paid')

  const arrive = async () => {
    const receipt = await request
      .post('/api/admin/stock/receipts')
      .set(bearer(adminToken))
      .send({ supplierName: 'Nike VN', receivedOn: '2026-12-01', note: '', lines: [{ sku: 'AM-41', quantity: 1 }] })
    expect(receipt.status).toBe(201)
  }
  const payRemainder = () => request.post(`/api/orders/${code}/pay-remainder`).query({ token: orderToken })
  const settle = async (...payments: [amount: number, reference: string][]) => {
    app.payments.payments.set(`${code}-remainder-1`, paid(...payments))
    return order({ refresh: '1' })
  }
  const flags = async () => {
    const detail = await request.get(`/api/admin/orders/${code}`).set(bearer(adminToken))
    return (detail.body.payments as { purpose: string; reconciliation: { reason: string } | null }[]).map((p) => [
      p.purpose,
      p.reconciliation?.reason ?? null,
    ])
  }
  return { ...app, code, orderToken, customerToken, order, arrive, payRemainder, settle, flags }
}
