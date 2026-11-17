import { describe, expect, it, vi } from 'vitest'
import { DEPOSIT, REMAINING, depositedPreorder, preorderShop } from './support/preorder.ts'
import { ADDRESS } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

/**
 * Đợt đặt trước AM-41 (giá 2.100.000, cọc 30% = 630.000 một đôi, 20 suất). `deposited(n)` đặt trước `n` đôi rồi trả cọc
 * ngay, nên thứ tự gọi là thứ tự cọc. `receive(n)` ghi phiếu nhập `n` đôi AM-41. `cancel` hủy bằng nhân viên bán hàng.
 */
async function preorderCancel() {
  const app = await preorderShop()
  const { request, token, v41 } = app
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const campaignId = await app.open([{ variantId: v41.id, allocation: 20 }])
  let customer = 0
  const deposited = async (quantity: number) => {
    customer += 1
    const address = {
      ...ADDRESS,
      email: `khach${customer}@example.com`,
      phone: `09100000${String(customer).padStart(2, '0')}`,
    }
    const order = await app.placed(campaignId, { quantity, address })
    app.payments.payments.set(`${order.code}-deposit-1`, {
      status: 'paid',
      transactions: [{ reference: `FT-${order.code}`, amount: DEPOSIT * quantity, paidAt: new Date() }],
    })
    const view = () => request.get(`/api/orders/${order.code}`).query({ token: order.token })
    expect((await view().query({ refresh: '1' })).body.paymentStatus).toBe('deposit_paid')
    return { ...order, view }
  }
  const receive = async (quantity: number) => {
    const res = await request
      .post('/api/admin/stock/receipts')
      .set(bearer(token))
      .send({ supplierName: 'Nike VN', receivedOn: '2026-12-01', note: '', lines: [{ sku: 'AM-41', quantity }] })
    expect(res.status).toBe(201)
  }
  const cancel = (code: number, body: Record<string, unknown>) =>
    request.post(`/api/admin/orders/${code}/cancel-paid`).set(bearer(sales.accessToken)).send(body)
  const stock = async () => {
    const res = await request.get('/api/admin/stock').query({ q: 'AM-41' }).set(bearer(token))
    const item = (res.body.items as { sku: string; onHand: number; reserved: number }[]).find((i) => i.sku === 'AM-41')!
    return { onHand: item.onHand, reserved: item.reserved }
  }
  const used = async () => {
    const res = await request.get(`/api/admin/preorder-campaigns/${campaignId}`).set(bearer(token))
    return (res.body.variants as { used: number }[])[0]!.used
  }
  const mails = (subject: string) =>
    vi.waitFor(
      () => {
        const sent = app.mailer.sent.filter((m) => m.subject === subject)
        if (sent.length === 0) throw new Error('Chưa có thư')
        return sent
      },
      { timeout: 10_000, interval: 100 },
    )
  return { ...app, sales, campaignId, deposited, receive, cancel, stock, used, mails }
}

describe('hủy đơn đặt trước đã cọc, chưa có hàng về', () => {
  it('mất cọc: không hoàn, có ghi chú; tồn không đổi, suất trả lại cho đợt, email nhắc chính sách đặt trước', async () => {
    const { deposited, cancel, stock, used, mails } = await preorderCancel()
    const order = await deposited(1)
    expect(await used()).toBe(1)

    const res = await cancel(order.code, { cause: 'changed_mind', refundAmount: 0, note: 'Khách đổi ý, mất cọc' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      status: 'cancelled',
      paymentStatus: 'deposit_paid',
      cancelCause: 'changed_mind',
      received: DEPOSIT,
      refunds: [],
    })
    expect(await stock()).toEqual({ onHand: 0, reserved: 0 })
    expect(await used()).toBe(0)
    const [mail] = await mails(`Đơn hàng #${order.code} đã bị hủy`)
    expect(mail!.text).toContain('chính sách đặt trước')
  })

  it('mất một phần cọc: email ghi phần không hoàn', async () => {
    const { deposited, cancel, mails } = await preorderCancel()
    const order = await deposited(1)

    const res = await cancel(order.code, { cause: 'remainder_overdue', refundAmount: 300_000, note: 'Giữ 330.000' })

    expect(res.status).toBe(200)
    expect(res.body.refunds).toEqual([expect.objectContaining({ amount: 300_000, status: 'pending' })])
    const [mail] = await mails(`Đơn hàng #${order.code} đã bị hủy`)
    expect(mail!.text).toContain('300.000')
    expect(mail!.text).toContain('Phần không hoàn: 330.000')
  })

  it('không nhập được hàng phải hoàn đủ cọc', async () => {
    const { deposited, cancel } = await preorderCancel()
    const order = await deposited(1)

    expect((await cancel(order.code, { cause: 'supply_failed', refundAmount: 0, note: 'x' })).status).toBe(400)
    const res = await cancel(order.code, { cause: 'supply_failed', refundAmount: DEPOSIT })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ refunding: DEPOSIT, refundable: 0 })
  })
})

describe('hủy đơn đặt trước đang giữ hàng về', () => {
  it('hàng đã về chuyển cho đơn chờ kế tiếp theo thứ tự cọc; đơn đó thành hàng đã về, có hạn trả và email', async () => {
    const { deposited, receive, cancel, stock, mails } = await preorderCancel()
    const a = await deposited(1)
    const b = await deposited(1)
    const c = await deposited(1)
    await receive(1)
    expect((await a.view()).body.preorder.arrivedAt).not.toBeNull()

    const res = await cancel(a.code, { cause: 'changed_mind', refundAmount: DEPOSIT })

    expect(res.status).toBe(200)
    expect(await stock()).toEqual({ onHand: 1, reserved: 1 })
    const next = (await b.view()).body
    expect(next.preorder).toMatchObject({ arrivedQuantity: 1, arrivedAt: expect.any(String) })
    expect(next.preorder.remainderDueAt).not.toBeNull()
    expect((await c.view()).body.preorder.arrivedAt).toBeNull()
    await mails(`Hàng đã về cho đơn đặt trước #${b.code}`)
    expect(res.body.history).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'cancelled' })]))
  })

  it('không còn đơn chờ thì hàng thành hàng sẵn', async () => {
    const { deposited, receive, cancel, stock, request } = await preorderCancel()
    const a = await deposited(1)
    await receive(1)

    expect((await cancel(a.code, { cause: 'changed_mind', refundAmount: DEPOSIT })).status).toBe(200)

    expect(await stock()).toEqual({ onHand: 1, reserved: 0 })
    const product = await request.get('/api/products/air-max')
    const am41 = (product.body.variants as { sku: string; availability: string }[]).find((v) => v.sku === 'AM-41')!
    expect(am41.availability).toBe('in_stock')
  })

  it('đơn mới về một phần: phần đã giữ chia cho đơn kế tiếp', async () => {
    const { deposited, receive, cancel, stock, request, token } = await preorderCancel()
    const a = await deposited(2)
    const b = await deposited(1)
    await receive(1)
    expect((await a.view()).body.preorder).toMatchObject({ arrivedQuantity: 1, arrivedAt: null })

    expect((await cancel(a.code, { cause: 'changed_mind', refundAmount: 2 * DEPOSIT })).status).toBe(200)

    expect(await stock()).toEqual({ onHand: 1, reserved: 1 })
    expect((await b.view()).body.preorder).toMatchObject({ arrivedQuantity: 1, arrivedAt: expect.any(String) })
    const detail = await request.get(`/api/admin/orders/${b.code}`).set(bearer(token))
    expect(detail.body.history).toContainEqual(
      expect.objectContaining({ action: 'stock_allocated', data: expect.objectContaining({ fromOrderCode: a.code }) }),
    )
  })

  it('đơn đã hủy không trả phần còn lại được nữa', async () => {
    const { deposited, receive, cancel, request } = await preorderCancel()
    const a = await deposited(1)
    await receive(1)
    expect((await cancel(a.code, { cause: 'changed_mind', refundAmount: DEPOSIT })).status).toBe(200)

    const pay = await request.post(`/api/orders/${a.code}/pay-remainder`).query({ token: a.token })
    expect(pay.status).toBe(409)
  })
})

describe('hủy đơn đặt trước đã trả đủ, chưa bàn giao', () => {
  it('số còn hoàn được gồm cả cọc và phần còn lại', async () => {
    const app = await depositedPreorder()
    const { request, token, arrive, payRemainder, settle, code } = app
    await arrive()
    expect((await payRemainder()).status).toBe(200)
    expect((await settle([REMAINING, `FT-REM-${code}`])).body.paymentStatus).toBe('paid')
    const cancel = (refundAmount: number) =>
      request.post(`/api/admin/orders/${code}/cancel-paid`).set(bearer(token)).send({ cause: 'other', refundAmount })

    expect((await cancel(DEPOSIT + REMAINING + 1)).status).toBe(400)
    const res = await cancel(DEPOSIT + REMAINING)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ received: DEPOSIT + REMAINING, refunding: DEPOSIT + REMAINING })
  })
})
