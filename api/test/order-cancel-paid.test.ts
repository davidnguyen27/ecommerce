import { describe, expect, it, vi } from 'vitest'
import { shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const TOTAL = 2_030_000
const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN123456' }
const DAY = 24 * 60 * 60_000

/**
 * A shop with the simulator, a sales clerk, a warehouse clerk and an accountant. `paidOrder` orders one pair of AM-40
 * (2,000,000 + 30,000 shipping) and pays in full.
 */
async function cancelPaid() {
  const app = await shop({ simulator: true })
  const { request, token, checkout, v40 } = app
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
  const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')

  const post = (code: number, path: string, body?: Record<string, unknown>, as = token) =>
    request.post(`/api/admin/orders/${code}/${path}`).set(bearer(as)).send(body)
  const pay = async (code: number, amount: number) => {
    const res = await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount })
    expect(res.status).toBe(204)
  }
  const paidOrder = async (body: Record<string, unknown> = {}, amount = TOTAL) => {
    const placed = await checkout({ lines: [{ variantId: v40.id, quantity: 1, price: 2_000_000 }], ...body })
    expect(placed.status).toBe(201)
    const { code, token: lookup } = placed.body as { code: number; token: string }
    await pay(code, amount)
    return { code, lookup }
  }
  const cancel = (code: number, body: Record<string, unknown>, as = sales.accessToken) =>
    post(code, 'cancel-paid', body, as)
  const reserved = async () => {
    const stock = await request.get('/api/admin/stock').query({ q: 'AM-40' }).set(bearer(token))
    return (stock.body.items as { reserved: number }[])[0]!.reserved
  }
  const audits = async () => {
    const res = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    return res.body.items as { action: string; actor: { id: string }; before: unknown; after: unknown }[]
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
  return { ...app, sales, warehouse, accountant, post, pay, paidOrder, cancel, reserved, audits, mails }
}

describe('hủy đơn hàng sẵn đã trả', () => {
  it('nhả hàng, hủy đơn với lý do, tạo khoản hoàn đủ, gửi email, ghi sự kiện và audit', async () => {
    const { paidOrder, cancel, reserved, audits, mails, sales } = await cancelPaid()
    const { code } = await paidOrder()
    expect(await reserved()).toBe(1)

    const res = await cancel(code, { cause: 'changed_mind', refundAmount: TOTAL })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      code,
      status: 'cancelled',
      paymentStatus: 'paid', // payment status unchanged (ADR 0014)
      cancelReason: 'staff',
      cancelCause: 'changed_mind',
      cancelNote: null,
      received: TOTAL,
      refunding: TOTAL,
      refundable: 0,
    })
    expect(res.body.refunds).toEqual([
      expect.objectContaining({
        amount: TOTAL,
        origin: 'cancellation',
        status: 'pending',
        createdBy: expect.objectContaining({ id: sales.id }),
      }),
    ])
    expect(await reserved()).toBe(0)
    const actions = (res.body.history as { action: string }[]).map((h) => h.action)
    expect(actions).toEqual(expect.arrayContaining(['cancelled', 'refund_created']))
    expect(await audits()).toContainEqual(
      expect.objectContaining({
        action: 'order.cancel_paid',
        actor: expect.objectContaining({ id: sales.id }),
        before: { status: 'processing', paymentStatus: 'paid', fulfillmentStatus: 'not_prepared' },
        after: expect.objectContaining({ status: 'cancelled', cancelCause: 'changed_mind', refundAmount: TOTAL }),
      }),
    )
    const [mail] = await mails(`Đơn hàng #${code} đã bị hủy`)
    expect(mail!.text).toContain('theo yêu cầu của bạn')
    expect(mail!.text).toContain('2.030.000')
    expect(mail!.text).toContain('/don-hang/')
  })

  it('hủy được khi đang chuẩn bị; đã bàn giao, đã giao, giao thất bại thì 409', async () => {
    const { paidOrder, cancel, post } = await cancelPaid()
    const preparing = await paidOrder()
    expect((await post(preparing.code, 'prepare')).status).toBe(200)
    expect((await cancel(preparing.code, { cause: 'other', refundAmount: TOTAL })).status).toBe(200)

    const handedOver = await paidOrder()
    expect((await post(handedOver.code, 'prepare')).status).toBe(200)
    expect((await post(handedOver.code, 'hand-over', SHIPMENT)).status).toBe(200)
    expect((await cancel(handedOver.code, { cause: 'other', refundAmount: TOTAL })).status).toBe(409)

    expect((await post(handedOver.code, 'delivery-failed')).status).toBe(200)
    // A failed delivery must be returned to stock first (ticket 05).
    expect((await cancel(handedOver.code, { cause: 'delivery_failed', refundAmount: TOTAL })).status).toBe(409)

    const delivered = await paidOrder()
    expect((await post(delivered.code, 'prepare')).status).toBe(200)
    expect((await post(delivered.code, 'hand-over', SHIPMENT)).status).toBe(200)
    expect((await post(delivered.code, 'deliver')).status).toBe(200)
    expect((await cancel(delivered.code, { cause: 'other', refundAmount: TOTAL })).status).toBe(409)
  })

  it('đơn chưa trả hay đã hủy thì 409; đơn chưa trả vẫn hủy bằng nút thường', async () => {
    const { checkout, cancel, post } = await cancelPaid()
    const placed = await checkout()
    const code = placed.body.code as number

    expect((await cancel(code, { cause: 'other', refundAmount: 0 })).status).toBe(409)
    expect((await post(code, 'cancel')).status).toBe(200)
    expect((await cancel(code, { cause: 'other', refundAmount: 0 })).status).toBe(409)
  })

  it('kiểm số hoàn: vượt thì 400; thấp hơn mà thiếu ghi chú thì 400; không nhập được hàng phải hoàn đủ', async () => {
    const { paidOrder, cancel } = await cancelPaid()
    const { code } = await paidOrder()

    const over = await cancel(code, { cause: 'changed_mind', refundAmount: TOTAL + 1 })
    expect(over.status).toBe(400)
    expect(over.body.error.fields).toEqual([expect.objectContaining({ path: 'refundAmount' })])
    const noNote = await cancel(code, { cause: 'changed_mind', refundAmount: TOTAL - 30_000 })
    expect(noNote.status).toBe(400)
    expect(noNote.body.error.fields).toEqual([expect.objectContaining({ path: 'note' })])
    expect((await cancel(code, { cause: 'supply_failed', refundAmount: 0, note: 'x' })).status).toBe(400)
    // Regular orders have no remaining balance (demo walkthrough 2026-11-23: the customer read "vì đã quá hạn trả phần
    // còn lại").
    const overdue = await cancel(code, { cause: 'remainder_overdue', refundAmount: TOTAL })
    expect(overdue.status).toBe(400)
    expect(overdue.body.error.fields).toEqual([expect.objectContaining({ path: 'cause' })])
    expect((await cancel(code, { cause: 'changed_mind', refundAmount: -1 })).status).toBe(400)
    expect((await cancel(code, { cause: 'khong-co', refundAmount: TOTAL })).status).toBe(400)

    const res = await cancel(code, { cause: 'changed_mind', refundAmount: TOTAL - 30_000, note: 'Khách chịu phí giao' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ cancelNote: 'Khách chịu phí giao', refunding: TOTAL - 30_000 })
    expect(res.body.refunds[0]).toMatchObject({ amount: TOTAL - 30_000, note: 'Khách chịu phí giao' })
  })

  it('số hoàn 0 thì không có khoản hoàn và email báo không hoàn', async () => {
    const { paidOrder, cancel, mails } = await cancelPaid()
    const { code } = await paidOrder()

    const res = await cancel(code, { cause: 'other', refundAmount: 0, note: 'Khách đồng ý không hoàn' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'cancelled', refunds: [], refunding: 0, refundable: TOTAL })
    const [mail] = await mails(`Đơn hàng #${code} đã bị hủy`)
    expect(mail!.text).toContain('không được hoàn tiền')
  })

  it('chỉ owner và bán hàng hủy được; kho và kế toán bị 403', async () => {
    const { paidOrder, cancel, warehouse, accountant, token } = await cancelPaid()
    const { code } = await paidOrder()
    const body = { cause: 'changed_mind', refundAmount: TOTAL }

    expect((await cancel(code, body, warehouse.accessToken)).status).toBe(403)
    expect((await cancel(code, body, accountant.accessToken)).status).toBe(403)
    expect((await cancel(code, body, token)).status).toBe(200)
  })

  it('hai yêu cầu hủy cùng lúc: đúng một thành công, một khoản hoàn', async () => {
    const { paidOrder, cancel, request, token } = await cancelPaid()
    const { code } = await paidOrder()
    const body = { cause: 'changed_mind', refundAmount: TOTAL }

    const results = await Promise.all([cancel(code, body), cancel(code, body)])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const detail = await request.get(`/api/admin/orders/${code}`).set(bearer(token))
    expect(detail.body.refunds).toHaveLength(1)
  })

  it('lượt mã giảm giá trống lại sau khi hủy', async () => {
    const { request, token, paidOrder, cancel, checkout } = await cancelPaid()
    const voucher = await request
      .post('/api/admin/vouchers')
      .set(bearer(token))
      .send({
        code: 'TET2027',
        kind: 'percent',
        percent: 10,
        maxDiscount: 500_000,
        startsAt: new Date(Date.now() - DAY).toISOString(),
        endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
        saleTypes: ['standard'],
        totalLimit: 1,
      })
    expect(voucher.status).toBe(201)
    const withVoucher = { voucherCode: 'tet2027', discount: 200_000 }
    const { code } = await paidOrder(withVoucher, TOTAL - 200_000)
    expect((await checkout(withVoucher)).status).toBe(409) // used up

    expect((await cancel(code, { cause: 'changed_mind', refundAmount: TOTAL - 200_000 })).status).toBe(200)

    expect((await checkout(withVoucher)).status).toBe(201)
  })
})

describe('đối soát sau khi hủy đơn đã nhận tiền', () => {
  it('tiền về sau khi nhân viên hủy đơn đã trả thì không khôi phục đơn được, chỉ hoàn hoặc xử lý ngoài', async () => {
    const { paidOrder, cancel, pay, request, accountant, token } = await cancelPaid()
    const { code } = await paidOrder()
    expect((await cancel(code, { cause: 'other', refundAmount: 0, note: 'Khách đồng ý không hoàn' })).status).toBe(200)
    await pay(code, TOTAL)
    const detail = await request.get(`/api/admin/orders/${code}`).set(bearer(token))
    const item = (detail.body.payments as { reconciliation: { id: string } | null }[]).find((p) => p.reconciliation)!

    const restore = await request
      .post(`/api/admin/reconciliation/${item.reconciliation!.id}/restore`)
      .set(bearer(accountant.accessToken))

    expect(restore.status).toBe(409)
    expect(restore.body.error.message).toContain('đã nhận tiền')
    const refund = await request
      .post(`/api/admin/reconciliation/${item.reconciliation!.id}/refund`)
      .set(bearer(accountant.accessToken))
    expect(refund.status).toBe(200)
  })
})

describe('khách xem đơn đã hủy', () => {
  it('thấy lý do hủy, đã nhận và các khoản hoàn; không thấy ghi chú nội bộ hay mã ngân hàng', async () => {
    const { paidOrder, cancel, request, accountant } = await cancelPaid()
    const { code, lookup } = await paidOrder()
    const cancelled = await cancel(code, {
      cause: 'changed_mind',
      refundAmount: TOTAL - 30_000,
      note: 'Ghi chú nội bộ',
    })
    const refundId = cancelled.body.refunds[0].id as string
    const view = () => request.get(`/api/orders/${code}`).query({ token: lookup })

    const pending = await view()
    expect(pending.status).toBe(200)
    expect(pending.body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'staff',
      cancelCause: 'changed_mind',
      received: TOTAL,
      refunds: [{ amount: TOTAL - 30_000, status: 'refunding', completedAt: null }],
    })

    await request
      .post(`/api/admin/refunds/${refundId}/manual`)
      .set(bearer(accountant.accessToken))
      .send({ bankReference: 'FT-NOI-BO', transferredOn: '2026-11-17' })
    const done = await view()
    expect(done.body.refunds).toEqual([
      expect.objectContaining({ status: 'refunded', completedAt: expect.any(String) }),
    ])
    const text = JSON.stringify(done.body)
    expect(text).not.toContain('Ghi chú nội bộ')
    expect(text).not.toContain('FT-NOI-BO')
    expect(done.body).not.toHaveProperty('cancelNote')
  })
})
