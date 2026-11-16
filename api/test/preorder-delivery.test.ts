import { describe, expect, it, vi } from 'vitest'
import { DEPOSIT, paid, preorderShop } from './support/preorder.ts'
import { ADDRESS } from './support/shop.ts'
import { bearer } from './support/staff.ts'

const SUBJECT = 'Thời gian giao dự kiến của đơn đặt trước'

/**
 * Một đợt AM-41 (giao 10–20/12/2026) có đủ loại đơn: A đã về hàng, D1 và D2 đã cọc đang chờ hàng, P chờ cọc, C đã hủy.
 */
async function campaignWithOrders() {
  const app = await preorderShop()
  const { request, token } = app
  const campaignId = await app.open([{ variantId: app.v41.id, allocation: 20 }])
  let customer = 0
  const place = async () => {
    customer += 1
    const phone = `09200000${String(customer).padStart(2, '0')}`
    const placed = await app.placed(campaignId, {
      address: { ...ADDRESS, email: `khach${customer}@example.com`, phone },
    })
    const view = () => request.get(`/api/orders/${placed.code}`).query({ token: placed.token })
    return { ...placed, view }
  }
  const deposited = async () => {
    const order = await place()
    app.payments.payments.set(`${order.code}-deposit-1`, paid([DEPOSIT, `FT-${order.code}`]))
    expect(
      (await request.get(`/api/orders/${order.code}`).query({ token: order.token, refresh: '1' })).body.paymentStatus,
    ).toBe('deposit_paid')
    return order
  }

  const arrived = await deposited()
  const receipt = await request
    .post('/api/admin/stock/receipts')
    .set(bearer(token))
    .send({ supplierName: 'Nike VN', receivedOn: '2026-12-01', note: '', lines: [{ sku: 'AM-41', quantity: 1 }] })
  expect(receipt.status).toBe(201)
  const waiting1 = await deposited()
  const waiting2 = await deposited()
  const pending = await place()
  const cancelled = await place()
  expect((await request.post(`/api/orders/${cancelled.code}/cancel`).query({ token: cancelled.token })).status).toBe(
    200,
  )

  const update = (body: Record<string, unknown>) =>
    request.patch(`/api/admin/preorder-campaigns/${campaignId}`).set(bearer(token)).send(body)
  /** Mã đơn của các thư báo đổi thời gian giao đã xếp; đợi hàng đợi thư chạy hết. */
  const notifiedCodes = async (expected: number) => {
    const codes = () =>
      app.mailer.sent
        .filter((m) => m.subject.startsWith(SUBJECT))
        .map((m) => Number(/#(\d+)/.exec(m.subject)![1]))
        .sort()
    // Chờ hàng đợi thư gửi đủ `expected` thư, rồi chờ thêm một lúc để thư thừa (nếu có) cũng kịp tới.
    await vi.waitFor(() => expect(codes().length).toBeGreaterThanOrEqual(expected), { timeout: 10_000, interval: 100 })
    await new Promise((resolve) => setTimeout(resolve, 500))
    return codes()
  }
  return { ...app, campaignId, arrived, waiting1, waiting2, pending, cancelled, update, notifiedCodes }
}

describe('đổi thời gian giao dự kiến của đợt', () => {
  it('báo đúng một email cho mỗi đơn đã cọc mà hàng chưa về; đơn đã về, chờ cọc, đã hủy không nhận', async () => {
    const app = await campaignWithOrders()

    const res = await app.update({ deliveryTo: '2026-12-31' })

    expect(res.status).toBe(200)
    expect(await app.notifiedCodes(2)).toEqual([app.waiting1.code, app.waiting2.code].sort())
    const mail = app.mailer.sent.find((m) => m.subject === `${SUBJECT} #${app.waiting1.code} đã thay đổi`)!
    expect(mail.text).toContain('Trước đây: 10/12/2026 – 20/12/2026')
    expect(mail.text).toContain('Hiện tại: 10/12/2026 – 31/12/2026')
    const history = await app.request.get(`/api/admin/orders/${app.waiting1.code}`).set(bearer(app.token))
    expect(history.body.history).toContainEqual(
      expect.objectContaining({
        action: 'delivery_changed',
        data: { before: { from: '2026-12-10', to: '2026-12-20' }, after: { from: '2026-12-10', to: '2026-12-31' } },
      }),
    )
  })

  it('trang đơn hiện thời gian giao hiện tại của đợt, cạnh lời hẹn lúc đặt', async () => {
    const app = await campaignWithOrders()
    await app.update({ deliveryFrom: '2026-12-15', deliveryTo: '2026-12-31' })

    expect((await app.waiting1.view()).body.preorder).toMatchObject({
      deliveryFrom: '2026-12-10',
      deliveryTo: '2026-12-20',
      currentDeliveryFrom: '2026-12-15',
      currentDeliveryTo: '2026-12-31',
    })
  })

  it('sửa trường khác hay lưu lại đúng thời gian cũ thì không gửi thư', async () => {
    const app = await campaignWithOrders()

    expect((await app.update({ supplyStatus: 'in_transit', supplyNote: 'Đã lên tàu' })).status).toBe(200)
    expect((await app.update({ deliveryFrom: '2026-12-10', deliveryTo: '2026-12-20' })).status).toBe(200)

    expect(await app.notifiedCodes(0)).toEqual([])
  })
})
