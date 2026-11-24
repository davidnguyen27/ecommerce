import { describe, expect, it } from 'vitest'
import { expireOverdueOrders } from '../src/orders/cancel-order.ts'
import { HA_NOI, ADDRESS } from './support/shop.ts'
import { preorderShop } from './support/preorder.ts'
import { bearer } from './support/staff.ts'
import { adjust } from './support/stock.ts'

const MINUTE = 60_000
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * MINUTE)

/** Cửa hàng có đợt đang mở: AM-40 10 suất, AM-41 5 suất, cọc 30%. */
async function withCampaign(options?: Parameters<typeof preorderShop>[0]) {
  const app = await preorderShop(options)
  const campaignId = await app.open()
  /** Số đã dùng của AM-41 trong đợt, đọc ở trang quản trị. */
  const usedV41 = async () => {
    const res = await app.request.get(`/api/admin/preorder-campaigns/${campaignId}`).set(bearer(app.token))
    expect(res.status).toBe(200)
    return (res.body.variants as { sku: string; used: number }[]).find((v) => v.sku === 'AM-41')!.used
  }
  /** Số đang giữ của AM-41 ở trang Tồn kho. */
  const reservedV41 = async () => {
    const res = await app.request.get('/api/admin/stock').query({ q: 'AM-41' }).set(bearer(app.token))
    return (res.body.items as { sku: string; reserved: number }[]).find((i) => i.sku === 'AM-41')!.reserved
  }
  const orderCount = async () =>
    (
      await app.request
        .get('/api/admin/orders')
        .query({ status: 'all', paymentStatus: 'all', fulfillmentStatus: 'all' })
        .set(bearer(app.token))
    ).body.total as number
  return { ...app, campaignId, usedV41, reservedV41, orderCount }
}

describe('báo giá đặt trước', () => {
  it('trả giá, đợt, tiền cọc, phí giao, tổng và phần còn lại; không ghi gì', async () => {
    const app = await withCampaign()

    const res = await app.quote({ quantity: 2, provinceCode: HA_NOI })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      quantity: 2,
      product: { slug: 'air-max', name: 'Air Max' },
      sku: 'AM-41',
      price: 2_100_000,
      offer: {
        campaignId: app.campaignId,
        depositPercent: 30,
        deliveryFrom: '2026-12-10',
        deliveryTo: '2026-12-20',
        remainderDays: 7,
      },
      problem: null,
      subtotal: 4_200_000,
      depositAmount: 1_260_000,
      shippingFee: 30_000,
      total: 4_230_000,
      remainingAmount: 2_970_000,
      preorderPolicy: { slug: 'chinh-sach-dat-truoc', title: 'Chính sách đặt trước' },
      policies: [{ slug: 'doi-tra', title: 'Đổi trả' }],
    })
    expect(await app.usedV41()).toBe(0)
  })

  it('chưa chọn tỉnh/thành thì chưa có phí giao và tổng; biến thể còn hàng sẵn hay hết suất thì báo lý do', async () => {
    const app = await withCampaign()

    expect((await app.quote()).body).toMatchObject({ shippingFee: null, total: null, depositAmount: 630_000 })
    expect((await app.quote({ variantId: app.v40.id })).body).toMatchObject({ problem: { kind: 'in_stock' } })
    expect((await app.quote({ quantity: 5 })).body).toMatchObject({ problem: null })
    await app.placed(app.campaignId, { quantity: 5 })
    expect((await app.quote()).body).toMatchObject({ problem: { kind: 'sold_out' } })
  })
})

describe('đặt trước', () => {
  it('tạo đơn đặt trước chờ cọc và link cọc làm tròn lên 1.000; không giữ hàng, chỉ chiếm suất', async () => {
    const app = await withCampaign()
    // Giá lẻ để tiền cọc phải làm tròn: 30% của 2.100.500 là 630.150, làm tròn lên 631.000.
    expect((await app.editVariant(app.v41, 'AM-41', '41', { price: 2_100_500 })).status).toBe(200)

    const res = await app.preorder(app.campaignId, { price: 2_100_500 })

    expect(res.status).toBe(201)
    const { code, token, checkoutUrl } = res.body as { code: number; token: string; checkoutUrl: string }
    expect(checkoutUrl).toBe(`https://pay.test/${code}-deposit-1`)
    expect(app.payments.created).toEqual([
      expect.objectContaining({ orderCode: code, purpose: 'deposit', amount: 631_000 }),
    ])
    const order = await app.request.get(`/api/orders/${code}`).query({ token })
    expect(order.body).toMatchObject({
      kind: 'preorder',
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      subtotal: 2_100_500,
      shippingFee: 30_000,
      total: 2_130_500,
      preorder: {
        depositPercent: 30,
        depositAmount: 631_000,
        remainingAmount: 1_499_500,
        deliveryFrom: '2026-12-10',
        deliveryTo: '2026-12-20',
        remainderDays: 7,
      },
      lines: [expect.objectContaining({ sku: 'AM-41', quantity: 1, price: 2_100_500 })],
    })
    // Đơn lưu phiên bản chính sách đặt trước cùng chính sách đổi trả của sản phẩm.
    expect(order.body.policies.map((p: { slug: string }) => p.slug)).toEqual(['chinh-sach-dat-truoc', 'doi-tra'])
    expect(await app.usedV41()).toBe(1)
    expect(await app.reservedV41()).toBe(0)
  })

  it('đơn hàng sẵn vẫn là đơn hàng sẵn', async () => {
    const app = await withCampaign()
    const res = await app.checkout()
    expect(res.status).toBe(201)

    const order = await app.request.get(`/api/orders/${res.body.code}`).query({ token: res.body.token })
    expect(order.body).toMatchObject({ kind: 'standard', preorder: null })
  })

  it('thứ khách đã thấy đổi thì 409 kèm lý do và không ghi gì', async () => {
    const app = await withCampaign()
    const rejected = async (body: Record<string, unknown>, campaignId = app.campaignId) => {
      const res = await app.preorder(campaignId, body)
      expect(res.status).toBe(409)
      return res.body.error.details as { change: { kind: string } }
    }

    expect(await rejected({ price: 2_000_000 })).toEqual({ change: { kind: 'price', from: 2_000_000, to: 2_100_000 } })
    expect(await rejected({ depositPercent: 40 })).toEqual({ change: { kind: 'deposit', from: 40, to: 30 } })
    expect(await rejected({}, '00000000-0000-4000-8000-000000000000')).toEqual({ change: { kind: 'campaign' } })
    expect(await rejected({ quantity: 5, variantId: app.v40.id, price: 2_000_000 })).toEqual({
      change: { kind: 'in_stock' },
    })
    expect(app.payments.created).toEqual([])
    expect(await app.orderCount()).toBe(0)
    expect(await app.usedV41()).toBe(0)
  })

  it('hết suất, đợt đã đóng, có hàng sẵn trở lại hay ngừng bán thì 409', async () => {
    const app = await withCampaign()
    const kind = async () => (await app.preorder(app.campaignId)).body.error?.details?.change?.kind as string

    await app.placed(app.campaignId, { quantity: 5 })
    expect(await kind()).toBe('sold_out')

    const fresh = await withCampaign()
    const restock = await adjust(fresh.request, fresh.token, {
      variantId: fresh.v41.id,
      reason: 'stocktake',
      countedQuantity: 1,
      expectedOnHand: 0,
    })
    expect(restock.status).toBe(201)
    expect((await fresh.preorder(fresh.campaignId)).body.error.details).toEqual({ change: { kind: 'in_stock' } })

    const closing = await withCampaign()
    expect(
      (
        await closing.request
          .post(`/api/admin/preorder-campaigns/${closing.campaignId}/close`)
          .set(bearer(closing.token))
      ).status,
    ).toBe(200)
    expect((await closing.preorder(closing.campaignId)).body.error.details).toEqual({ change: { kind: 'campaign' } })

    const stopping = await withCampaign()
    expect((await stopping.editVariant(stopping.v41, 'AM-41', '41', { status: 'discontinued' })).status).toBe(200)
    expect((await stopping.preorder(stopping.campaignId)).body.error.details).toEqual({
      change: { kind: 'discontinued' },
    })
  })

  it('nhiều khách tranh suất cuối cùng lúc: đúng một đơn được tạo', async () => {
    const app = await preorderShop()
    const campaignId = await app.open([{ variantId: app.v41.id, allocation: 1 }])
    const contact = (i: number) => ({ address: { ...ADDRESS, email: `khach${i}@example.com`, phone: `090000000${i}` } })

    const results = await Promise.all([1, 2, 3].map((i) => app.preorder(campaignId, contact(i))))

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
    expect(results.filter((r) => r.status === 409).map((r) => r.body.error.details.change.kind)).toEqual([
      'sold_out',
      'sold_out',
    ])
  })

  it('thiếu đồng ý chính sách đặt trước, hay khách vãng lai thiếu đồng ý chính sách bảo mật, thì 400', async () => {
    const app = await withCampaign()

    const preorderPolicy = await app.preorder(app.campaignId, { acceptPreorderPolicy: false })
    const privacy = await app.preorder(app.campaignId, { acceptPrivacyPolicy: undefined })

    expect(preorderPolicy.status).toBe(400)
    expect(preorderPolicy.body.error.fields).toEqual([expect.objectContaining({ path: 'acceptPreorderPolicy' })])
    expect(privacy.status).toBe(400)
    expect(privacy.body.error.fields).toEqual([expect.objectContaining({ path: 'acceptPrivacyPolicy' })])
    expect(await app.orderCount()).toBe(0)
  })

  it('chính sách đặt trước chưa xuất bản thì báo giá vẫn trả nhưng không có chính sách, còn đặt trước thì 503', async () => {
    const app = await withCampaign({ publishPolicy: false })

    expect((await app.quote()).body).toMatchObject({ preorderPolicy: null })
    expect((await app.preorder(app.campaignId)).status).toBe(503)
    expect(await app.orderCount()).toBe(0)
  })

  it('cổng lỗi khi tạo link cọc thì không có đơn và không chiếm suất', async () => {
    const app = await withCampaign()
    app.payments.failCreate = true

    expect((await app.preorder(app.campaignId)).status).toBe(502)
    expect(await app.orderCount()).toBe(0)
    expect(await app.usedV41()).toBe(0)
  })

  it('email đã có 3 đơn chờ thanh toán thì đặt trước thứ tư 429 kèm Retry-After, như đặt mua', async () => {
    const app = await withCampaign()
    // Mỗi lần một IP khác, để chỉ giới hạn theo email có tác dụng.
    const place = (i: number) =>
      app
        .preorder(app.campaignId, { address: { ...ADDRESS, phone: `091000000${i}` } })
        .set('X-Forwarded-For', `198.51.100.${i + 1}`)
    for (let i = 0; i < 3; i++) expect((await place(i)).status).toBe(201)

    const fourth = await place(3)

    expect(fourth.status).toBe(429)
    expect(fourth.body.error.message).toMatch(/3 đơn đang chờ thanh toán/)
    expect(fourth.body.error.fields).toEqual([{ path: 'address.email', message: expect.any(String) }])
    expect(Number(fourth.headers['retry-after'])).toBeGreaterThan(0)
    expect(await app.orderCount()).toBe(3)
  })
})

describe('hết hạn và hủy đơn chờ cọc', () => {
  it('quá hạn trả cọc thì đơn tự hủy, suất trống ra, link cọc bị hủy, số đang giữ không đổi', async () => {
    const app = await withCampaign()
    const { code, token } = await app.placed(app.campaignId, { quantity: 2 })
    expect(await app.usedV41()).toBe(2)

    // Job hết hạn không có endpoint: test gọi thẳng hàm job chạy với `now` ở tương lai, rồi kiểm qua HTTP.
    expect(await expireOverdueOrders(app.expireDeps, inMinutes(16))).toBe(1)

    expect((await app.request.get(`/api/orders/${code}`).query({ token })).body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'expired',
    })
    expect(await app.usedV41()).toBe(0)
    expect(await app.reservedV41()).toBe(0)
    expect(app.payments.cancelled).toEqual([`${code}-deposit-1`])
  })

  it('khách tự hủy đơn chờ cọc bằng link tra cứu: suất trống ra, số đang giữ không đổi', async () => {
    const app = await withCampaign()
    const { code, token } = await app.placed(app.campaignId)

    const res = await app.request.post(`/api/orders/${code}/cancel`).query({ token })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'cancelled', cancelReason: 'customer' })
    expect(await app.usedV41()).toBe(0)
    expect(await app.reservedV41()).toBe(0)
  })
})
