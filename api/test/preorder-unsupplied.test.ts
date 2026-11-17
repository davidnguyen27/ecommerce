import { describe, expect, it, vi } from 'vitest'
import { DEPOSIT, preorderShop } from './support/preorder.ts'
import { ADDRESS } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

/**
 * Đợt AM-41 (cọc 630.000 một đôi, 20 suất). `place(n)` đặt trước `n` đôi bằng một khách mới; `deposited(n)` đặt rồi trả
 * cọc ngay (thứ tự gọi là thứ tự cọc). `receive(n)` ghi phiếu nhập `n` đôi AM-41.
 */
async function unsupplied() {
  const app = await preorderShop()
  const { request, token, v41 } = app
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
  const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
  const campaignId = await app.open([{ variantId: v41.id, allocation: 20 }])
  let customer = 0
  const place = async (quantity: number) => {
    customer += 1
    const address = {
      ...ADDRESS,
      email: `khach${customer}@example.com`,
      phone: `09100000${String(customer).padStart(2, '0')}`,
    }
    const order = await app.placed(campaignId, { quantity, address })
    const view = () => request.get(`/api/orders/${order.code}`).query({ token: order.token })
    return { ...order, email: address.email, view }
  }
  const deposited = async (quantity: number) => {
    const order = await place(quantity)
    app.payments.payments.set(`${order.code}-deposit-1`, {
      status: 'paid',
      transactions: [{ reference: `FT-${order.code}`, amount: DEPOSIT * quantity, paidAt: new Date() }],
    })
    expect((await order.view().query({ refresh: '1' })).body.paymentStatus).toBe('deposit_paid')
    return order
  }
  const receive = async (quantity: number) => {
    const res = await request
      .post('/api/admin/stock/receipts')
      .set(bearer(token))
      .send({ supplierName: 'Nike VN', receivedOn: '2026-12-01', note: '', lines: [{ sku: 'AM-41', quantity }] })
    expect(res.status).toBe(201)
  }
  const preview = () =>
    request.get(`/api/admin/preorder-campaigns/${campaignId}/cancel-unsupplied`).set(bearer(sales.accessToken))
  const run = (body: Record<string, unknown> = { note: 'Nike VN báo hết hàng' }, as = sales.accessToken) =>
    request.post(`/api/admin/preorder-campaigns/${campaignId}/cancel-unsupplied`).set(bearer(as)).send(body)
  const stock = async () => {
    const res = await request.get('/api/admin/stock').query({ q: 'AM-41' }).set(bearer(token))
    const item = (res.body.items as { sku: string; onHand: number; reserved: number }[]).find((i) => i.sku === 'AM-41')!
    return { onHand: item.onHand, reserved: item.reserved }
  }
  const cancelMails = (email: string) =>
    app.mailer.sent.filter((m) => m.to === email && m.subject.endsWith('đã bị hủy'))
  return {
    ...app,
    sales,
    warehouse,
    accountant,
    campaignId,
    place,
    deposited,
    receive,
    preview,
    run,
    stock,
    cancelMails,
  }
}

describe('hủy các đơn chờ hàng khi đợt không nhập được hàng', () => {
  it('chỉ hủy đơn đã cọc chưa về đủ, hoàn đủ từng đơn, đóng đợt; phần đã giữ thành hàng sẵn', async () => {
    const app = await unsupplied()
    const { deposited, place, receive, preview, run, stock, cancelMails, request, token, mailer } = app
    const arrived = await deposited(1)
    const partial = await deposited(2)
    const waiting = await deposited(1)
    const unpaid = await place(1)
    await receive(2) // đơn đầu về đủ, đơn thứ hai về 1/2
    expect(await stock()).toEqual({ onHand: 2, reserved: 2 })

    const previewed = await preview()
    expect(previewed.status).toBe(200)
    expect(previewed.body).toEqual({
      orders: [
        expect.objectContaining({ code: partial.code, refundAmount: 2 * DEPOSIT }),
        expect.objectContaining({ code: waiting.code, refundAmount: DEPOSIT }),
      ],
      refundTotal: 3 * DEPOSIT,
    })

    const res = await run()

    expect(res.status).toBe(200)
    expect(res.body.cancelledOrderCodes).toEqual([partial.code, waiting.code])
    expect(res.body.campaign.closedAt).toEqual(expect.any(String))
    // Phần đã giữ của đơn về một phần thành hàng sẵn, không chuyển cho đơn nào.
    expect(await stock()).toEqual({ onHand: 2, reserved: 1 })

    for (const order of [partial, waiting]) {
      const detail = await request.get(`/api/admin/orders/${order.code}`).set(bearer(token))
      expect(detail.body).toMatchObject({
        status: 'cancelled',
        cancelCause: 'supply_failed',
        cancelNote: 'Nike VN báo hết hàng',
        refundable: 0,
      })
      expect(detail.body.refunds).toEqual([expect.objectContaining({ status: 'pending', origin: 'cancellation' })])
    }
    expect((await arrived.view()).body).toMatchObject({ status: 'processing', paymentStatus: 'deposit_paid' })
    expect((await unpaid.view()).body.status).toBe('pending_payment')

    await vi.waitFor(
      () => {
        if (cancelMails(partial.email).length + cancelMails(waiting.email).length < 2) throw new Error('Chưa có thư')
      },
      { timeout: 10_000, interval: 100 },
    )
    expect(mailer.sent.filter((m) => m.to === arrived.email && m.subject.endsWith('đã bị hủy'))).toHaveLength(0)

    const audits = await request.get('/api/admin/audit').set(bearer(token))
    const actions = (audits.body.items as { action: string }[]).map((a) => a.action)
    expect(actions.filter((a) => a === 'order.cancel_paid')).toHaveLength(2)
    expect(actions).toContain('preorder.campaign.cancel_unsupplied')
  })

  it('gọi lần hai không hủy thêm gì', async () => {
    const { deposited, run, preview } = await unsupplied()
    await deposited(1)
    expect((await run()).body.cancelledOrderCodes).toHaveLength(1)

    const again = await run()

    expect(again.status).toBe(200)
    expect(again.body.cancelledOrderCodes).toEqual([])
    expect((await preview()).body).toEqual({ orders: [], refundTotal: 0 })
  })

  it('cần cả order.cancel_paid và preorder.manage; thiếu ghi chú thì 400; đợt lạ thì 404', async () => {
    const { deposited, run, warehouse, accountant, request, sales } = await unsupplied()
    await deposited(1)

    expect((await run(undefined, warehouse.accessToken)).status).toBe(403)
    expect((await run(undefined, accountant.accessToken)).status).toBe(403)
    expect((await run({ note: ' ' })).status).toBe(400)
    const missing = await request
      .post('/api/admin/preorder-campaigns/00000000-0000-0000-0000-000000000000/cancel-unsupplied')
      .set(bearer(sales.accessToken))
      .send({ note: 'x' })
    expect(missing.status).toBe(404)
  })
})
