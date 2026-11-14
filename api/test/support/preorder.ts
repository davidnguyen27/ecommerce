import { PREORDER_POLICY_SLUG } from '@ecommerce/shared'
import { expect } from 'vitest'
import { ADDRESS, shop } from './shop.ts'
import { bearer } from './staff.ts'

const DAY = 24 * 60 * 60_000
export const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()

/**
 * Cửa hàng của `shop()` (Air Max đã xuất bản: AM-40 còn 3 đôi giá 2.000.000, AM-41 hết hàng giá 2.100.000), có thêm
 * chính sách đặt trước đã xuất bản. `open` mở đợt cọc 30%, giao 10–20/12/2026, mặc định AM-40 10 suất và AM-41 5 suất;
 * `preorder` đặt trước như khách vãng lai, mặc định 1 đôi AM-41 theo đợt `campaignId`.
 */
export async function preorderShop(options?: { publishPolicy?: boolean }) {
  const app = await shop()
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
