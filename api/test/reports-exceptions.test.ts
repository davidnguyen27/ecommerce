import { describe, expect, it } from 'vitest'
import { processRemainderDeadlines } from '../src/preorders/deadlines.ts'
import { REMAINING, depositedPreorder, inDays } from './support/preorder.ts'
import { shop } from './support/shop.ts'
import { bearer, createStaff, type Request } from './support/staff.ts'
import { adjust } from './support/stock.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }
const DAY = 24 * 60 * 60_000
/** Vietnam-time calendar day, `days` days from today, as 00:00 UTC like a `DATE` column. */
const vnDay = (days: number) =>
  new Date(`${new Date(Date.now() + 7 * 60 * 60_000 + days * DAY).toISOString().slice(0, 10)}T00:00:00Z`)

const exceptions = async (request: Request, token: string) => {
  const res = await request.get('/api/admin/reports/exceptions').set(bearer(token))
  expect(res.status).toBe(200)
  return res.body
}

describe('bảng ngoại lệ', () => {
  it('chỉ owner và kế toán xem được; có ngưỡng đang dùng', async () => {
    const { request, token } = await shop()
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')

    expect((await exceptions(request, accountant.accessToken)).thresholds).toEqual({ staleRefundDays: 3, lowStock: 2 })
    expect((await request.get('/api/admin/reports/exceptions').set(bearer(sales.accessToken))).status).toBe(403)
  })

  it('sắp hết hàng: biến thể đang bán của sản phẩm đã xuất bản còn bán được ≤ 2, kể cả hết hàng', async () => {
    const { request, token, v40, v41, product, editVariant } = await shop()
    const lowStock = async () => (await exceptions(request, token)).lowStock

    // AM-40 has 3 pairs: not low yet; AM-41 is out of stock.
    expect(await lowStock()).toEqual({
      count: 1,
      items: [{ variantId: v41.id, sku: 'AM-41', productName: 'Air Max', available: 0 }],
    })

    await adjust(request, token, { variantId: v40.id, reason: 'damaged', quantity: 1, expectedOnHand: 3 })
    expect((await lowStock()).items.map((i: { sku: string }) => [i.sku])).toEqual([['AM-41'], ['AM-40']])

    expect((await editVariant(v41, 'AM-41', '41', { status: 'discontinued' })).status).toBe(200)
    expect(await lowStock()).toEqual({
      count: 1,
      items: [{ variantId: v40.id, sku: 'AM-40', productName: 'Air Max', available: 2 }],
    })

    const archived = await request
      .put(`/api/admin/products/${product.id}/status`)
      .set(bearer(token))
      .send({ status: 'archived' })
    expect(archived.status).toBe(200)
    expect(await lowStock()).toEqual({ count: 0, items: [] })
  })

  it('cần đối soát, hoàn tiền treo quá 3 ngày, yêu cầu hỗ trợ chưa ai nhận', async () => {
    const app = await shop({ simulator: true })
    const { request, token } = app
    const report = () => exceptions(request, token)

    // The customer cancels an unpaid order, then money arrives: reconciliation needed.
    const late = (await app.checkout()).body as { code: number; token: string }
    expect((await request.post(`/api/orders/${late.code}/cancel`).query({ token: late.token })).status).toBe(200)
    await request.post('/api/payments/simulator/paid').send({ orderCode: late.code, amount: 2_030_000 })

    // A paid order is cancelled, its refund pending.
    const paid = (await app.checkout()).body as { code: number; token: string }
    await request.post('/api/payments/simulator/paid').send({ orderCode: paid.code, amount: 2_030_000 })
    const cancelled = await request
      .post(`/api/admin/orders/${paid.code}/cancel-paid`)
      .set(bearer(token))
      .send({ cause: 'changed_mind', refundAmount: 2_030_000, note: 'Khách đổi ý' })
    expect(cancelled.status).toBe(200)
    const refundId = (cancelled.body.refunds as { id: string }[])[0]!.id

    const asked = await request
      .post(`/api/orders/${paid.code}/support-requests`)
      .query({ token: paid.token })
      .send({ kind: 'other', subject: 'Hỏi hóa đơn', message: 'Shop xuất hóa đơn giúp mình' })
    expect(asked.status).toBe(201)
    const supportCode = asked.body.code as number

    const first = await report()
    expect(first.reconciliation).toEqual({
      count: 1,
      items: [
        {
          id: expect.any(String),
          orderCode: late.code,
          reason: 'paid_after_cancel',
          amount: 2_030_000,
          receivedAt: expect.any(String),
        },
      ],
    })
    expect(first.staleRefunds).toEqual({ count: 0, items: [] })
    expect(first.unassignedSupport).toEqual({
      count: 1,
      items: [{ code: supportCode, kind: 'other', subject: 'Hỏi hóa đơn', createdAt: expect.any(String) }],
    })

    await app.prisma.refund.update({ where: { id: refundId }, data: { createdAt: new Date(Date.now() - 2 * DAY) } })
    expect((await report()).staleRefunds.count).toBe(0)
    await app.prisma.refund.update({ where: { id: refundId }, data: { createdAt: new Date(Date.now() - 4 * DAY) } })
    expect((await report()).staleRefunds).toEqual({
      count: 1,
      items: [
        { id: refundId, orderCode: paid.code, amount: 2_030_000, status: 'pending', createdAt: expect.any(String) },
      ],
    })

    expect((await request.post(`/api/admin/support-requests/${supportCode}/claim`).set(bearer(token))).status).toBe(200)
    expect((await report()).unassignedSupport).toEqual({ count: 0, items: [] })
  })

  it('đặt trước: trễ hẹn khi đã quá ngày giao dự kiến cuối; quá hạn phần còn lại; đã giao thì không còn', async () => {
    const app = await depositedPreorder()
    const { request, token, code } = app
    const report = () => exceptions(request, token)

    await app.prisma.order.update({ where: { code }, data: { deliveryFrom: vnDay(-10), deliveryTo: vnDay(0) } })
    expect(await report()).toMatchObject({ latePreorders: { count: 0 }, overdueRemainders: { count: 0 } })

    await app.prisma.order.update({ where: { code }, data: { deliveryFrom: vnDay(-10), deliveryTo: vnDay(-1) } })
    expect((await report()).latePreorders).toEqual({
      count: 1,
      items: [{ orderCode: code, productName: 'Air Max', deliveryTo: vnDay(-1).toISOString().slice(0, 10) }],
    })

    await app.arrive()
    await processRemainderDeadlines(app.expireDeps, new Date(inDays(8)))
    expect((await report()).overdueRemainders).toEqual({
      count: 1,
      items: [{ orderCode: code, remainingAmount: REMAINING, remainderDueAt: expect.any(String) }],
    })

    expect((await app.payRemainder()).status).toBe(200)
    expect((await app.settle([REMAINING, 'FT-REM'])).body.paymentStatus).toBe('paid')
    for (const [path, body] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      expect((await request.post(`/api/admin/orders/${code}/${path}`).set(bearer(token)).send(body)).status).toBe(200)
    }
    expect(await report()).toMatchObject({ latePreorders: { count: 0 }, overdueRemainders: { count: 0 } })
  })
})
