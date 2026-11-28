import { describe, expect, it } from 'vitest'
import { expireOverdueOrders } from '../src/modules/order/index.ts'
import { DEPOSIT, depositedPreorder, paid } from './support/preorder.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff, type Request } from './support/staff.ts'

const DAY = 24 * 60 * 60_000
/** Vietnam-time calendar day, `days` days from today. */
const vnDate = (days = 0) => new Date(Date.now() + 7 * 60 * 60_000 + days * DAY).toISOString().slice(0, 10)

const cancellations = async (request: Request, token: string) => {
  const res = await request
    .get('/api/admin/reports/cancellations')
    .query({ from: vnDate(), to: vnDate() })
    .set(bearer(token))
  expect(res.status).toBe(200)
  return res.body
}

const NO_CAUSE = { standard: 0, preorder: 0, total: 0 }

describe('báo cáo hủy đơn và hoàn tiền', () => {
  it('chỉ owner và kế toán xem được; không có đơn thì tỷ lệ là null', async () => {
    const { request, token } = await shop()
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')

    expect(await cancellations(request, accountant.accessToken)).toMatchObject({
      confirmed: NO_CAUSE,
      rate: { standard: null, preorder: null, total: null },
      abandonedTotal: 0,
      refunds: [],
    })
    const res = await request
      .get('/api/admin/reports/cancellations')
      .query({ from: vnDate(), to: vnDate() })
      .set(bearer(warehouse.accessToken))
    expect(res.status).toBe(403)
  })

  it('đơn bỏ dở theo lý do: khách tự hủy, nhân viên hủy, hết hạn giữ hàng; không vào tỷ lệ hủy', async () => {
    const app = await shop()
    const { request, token } = app
    let n = 0
    const place = async () => {
      n += 1
      const res = await app.checkout({
        address: { ...ADDRESS, email: `bo${n}@example.com`, phone: `09400000${String(n).padStart(2, '0')}` },
      })
      expect(res.status).toBe(201)
      return res.body as { code: number; token: string }
    }
    const byCustomer = await place()
    expect(
      (await request.post(`/api/orders/${byCustomer.code}/cancel`).query({ token: byCustomer.token })).status,
    ).toBe(200)
    const byStaff = await place()
    expect((await request.post(`/api/admin/orders/${byStaff.code}/cancel`).set(bearer(token))).status).toBe(200)
    await place()
    await expireOverdueOrders(app.expireDeps, new Date(Date.now() + 60 * 60_000))

    expect(await cancellations(request, token)).toMatchObject({
      confirmed: NO_CAUSE,
      cancelled: NO_CAUSE,
      rate: { standard: null, preorder: null, total: null },
      abandoned: [
        { reason: 'expired', count: 1 },
        { reason: 'customer', count: 1 },
        { reason: 'staff', count: 1 },
      ],
      abandonedTotal: 3,
    })
  })

  it('tỷ lệ hủy trên đơn đã xác nhận theo lý do và hình thức bán; hoàn tiền tạo trong kỳ theo nguồn × trạng thái', async () => {
    const app = await depositedPreorder()
    const { request, token } = app
    let n = 0
    const contact = () => {
      n += 1
      return { ...ADDRESS, email: `khach${n}@example.com`, phone: `09300000${String(n).padStart(2, '0')}` }
    }
    const refresh = (placed: { code: number; token: string }) =>
      request.get(`/api/orders/${placed.code}`).query({ token: placed.token, refresh: '1' })
    const standard = async (pay: boolean) => {
      const res = await app.checkout({ address: contact() })
      expect(res.status).toBe(201)
      const placed = res.body as { code: number; token: string }
      if (pay) {
        app.payments.payments.set(String(placed.code), paid([2_030_000, `FT-${placed.code}`]))
        expect((await refresh(placed)).body.paymentStatus).toBe('paid')
      }
      return placed
    }
    const cancelPaid = async (code: number, cause: string, refundAmount: number) => {
      const res = await request
        .post(`/api/admin/orders/${code}/cancel-paid`)
        .set(bearer(token))
        .send({ cause, refundAmount, note: 'Hủy' })
      expect(res.status).toBe(200)
      return (res.body.refunds as { id: string }[])[0]!.id
    }

    // Pre-order: the fixture's order is deposited; a second one is deposited then cancelled for supply failure.
    const { preorderCampaignId } = await app.prisma.order.findUniqueOrThrow({ where: { code: app.code } })
    const second = await app.placed(preorderCampaignId!, { address: contact() })
    app.payments.payments.set(`${second.code}-deposit-1`, paid([DEPOSIT, 'FT-DEP-2']))
    expect((await refresh(second)).body.paymentStatus).toBe('deposit_paid')
    await cancelPaid(second.code, 'supply_failed', DEPOSIT)

    // In stock: one paid order cancelled by a change of mind and fully refunded; one paid order created the day before.
    const changedMind = await standard(true)
    const refundId = await cancelPaid(changedMind.code, 'changed_mind', 2_030_000)
    const manual = await request
      .post(`/api/admin/refunds/${refundId}/manual`)
      .set(bearer(token))
      .send({ bankReference: 'FT-HOAN', transferredOn: vnDate(), note: 'VCB' })
    expect(manual.status).toBe(200)
    const yesterday = await standard(true)
    await app.prisma.order.update({ where: { code: yesterday.code }, data: { createdAt: new Date(Date.now() - DAY) } })

    const report = await cancellations(request, token)

    expect(report).toMatchObject({
      confirmed: { standard: 1, preorder: 2, total: 3 },
      cancelled: { standard: 1, preorder: 1, total: 2 },
      rate: { standard: 1, preorder: 0.5, total: 2 / 3 },
      abandonedTotal: 0,
      refunds: [
        { origin: 'cancellation', status: 'pending', count: 1, amount: DEPOSIT },
        { origin: 'cancellation', status: 'succeeded', count: 1, amount: 2_030_000 },
      ],
    })
    expect(report.byCause).toEqual([
      { cause: 'changed_mind', standard: 1, preorder: 0, total: 1 },
      { cause: 'remainder_overdue', ...NO_CAUSE },
      { cause: 'supply_failed', standard: 0, preorder: 1, total: 1 },
      { cause: 'delivery_failed', ...NO_CAUSE },
      { cause: 'other', ...NO_CAUSE },
    ])
  })

  it('đơn khôi phục từ đối soát là đơn đã xác nhận, không còn là đơn bỏ dở', async () => {
    const app = await shop({ simulator: true })
    const { request, token } = app
    const placed = (await app.checkout()).body as { code: number; token: string }
    expect((await request.post(`/api/orders/${placed.code}/cancel`).query({ token: placed.token })).status).toBe(200)
    const paidLate = await request
      .post('/api/payments/simulator/paid')
      .send({ orderCode: placed.code, amount: 2_030_000 })
    expect(paidLate.status).toBe(204)
    expect(await cancellations(request, token)).toMatchObject({ confirmed: NO_CAUSE, abandonedTotal: 1 })

    const detail = await request.get(`/api/admin/orders/${placed.code}`).set(bearer(token))
    const itemId = (detail.body.payments as { reconciliation: { id: string } | null }[])[0]!.reconciliation!.id
    expect((await request.post(`/api/admin/reconciliation/${itemId}/restore`).set(bearer(token))).status).toBe(200)

    expect(await cancellations(request, token)).toMatchObject({
      confirmed: { standard: 1, preorder: 0, total: 1 },
      cancelled: NO_CAUSE,
      rate: { standard: 0, total: 0 },
      abandonedTotal: 0,
    })
  })
})
