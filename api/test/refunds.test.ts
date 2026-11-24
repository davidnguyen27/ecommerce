import { describe, expect, it, vi } from 'vitest'
import { shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const TOTAL = 2_030_000

type Refund = {
  id: string
  amount: number
  origin: string
  status: string
  method: string | null
  reconciliationItemId: string | null
  retryOfId: string | null
  retriedById: string | null
  bankReference: string | null
  transferredOn: string | null
  note: string | null
  executedBy: { id: string } | null
  settledBy: { id: string } | null
}

/**
 * A shop with the simulator, an accountant, a sales clerk and a warehouse clerk. Refunds in this ticket only come from
 * reconciliation: `cancelledThenPaid` builds an order cancelled before money arrived (one `paid_after_cancel` per
 * payment).
 */
async function refunds() {
  const app = await shop({ simulator: true })
  const { request, token, checkout } = app
  const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')

  const cancelledThenPaid = async (...amounts: number[]) => {
    const res = await checkout({ lines: [{ variantId: app.v40.id, quantity: 1, price: 2_000_000 }] })
    expect(res.status).toBe(201)
    const placed = res.body as { code: number; token: string }
    expect((await request.post(`/api/orders/${placed.code}/cancel`).query({ token: placed.token })).status).toBe(200)
    for (const amount of amounts.length ? amounts : [TOTAL]) {
      const paid = await request.post('/api/payments/simulator/paid').send({ orderCode: placed.code, amount })
      expect(paid.status).toBe(204)
    }
    return placed.code
  }
  const detail = async (code: number) => {
    const res = await request.get(`/api/admin/orders/${code}`).set(bearer(token))
    expect(res.status).toBe(200)
    return res.body as {
      received: number
      refunded: number
      refunding: number
      refundable: number
      refunds: Refund[]
      payments: { reconciliation: { id: string; status: string; resolution: string | null } | null }[]
      history: { action: string; data: Record<string, unknown> }[]
    }
  }
  const orderIdOf = async (code: number) => (await app.prisma.order.findUniqueOrThrow({ where: { code } })).id
  const itemIds = async (code: number) =>
    (await detail(code)).payments.flatMap((p) => (p.reconciliation ? [p.reconciliation.id] : []))
  const refundItem = (id: string, as = accountant.accessToken) =>
    request.post(`/api/admin/reconciliation/${id}/refund`).set(bearer(as))
  /** A cancelled order with one `pending` refund for all the money received. */
  const pendingRefund = async () => {
    const code = await cancelledThenPaid()
    const [item] = await itemIds(code)
    expect((await refundItem(item!)).status).toBe(200)
    const { refunds: list } = await detail(code)
    const orderId = await orderIdOf(code)
    return { code, orderId, refundId: list[0]!.id }
  }
  const manual = (id: string, body: Record<string, unknown>, as = accountant.accessToken) =>
    request.post(`/api/admin/refunds/${id}/manual`).set(bearer(as)).send(body)
  const settle = (id: string, body: Record<string, unknown>, as = accountant.accessToken) =>
    request.post(`/api/admin/refunds/${id}/settle`).set(bearer(as)).send(body)
  const retry = (id: string, body: Record<string, unknown>, as = accountant.accessToken) =>
    request.post(`/api/admin/refunds/${id}/retry`).set(bearer(as)).send(body)
  /**
   * Moves a `pending` refund to `processing` as if the gateway just took the command (ticket 06 calls the real
   * gateway).
   */
  const markProcessing = async (orderId: string, refundId: string) => {
    const transaction = await app.prisma.paymentTransaction.findFirstOrThrow({ where: { orderId } })
    await app.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'processing',
        method: 'vnpay',
        paymentTransactionId: transaction.id,
        executedById: accountant.id,
        executedAt: new Date(),
      },
    })
  }
  const audits = async () => {
    const res = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    return res.body.items as { action: string; actor: { id: string }; before: unknown; after: unknown }[]
  }
  const refundMails = (code: number) =>
    vi.waitFor(
      () => {
        const sent = app.mailer.sent.filter((m) => m.subject === `Đã hoàn tiền đơn hàng #${code}`)
        if (sent.length === 0) throw new Error('Chưa có thư')
        return sent
      },
      { timeout: 10_000, interval: 100 },
    )
  return {
    ...app,
    accountant,
    sales,
    warehouse,
    cancelledThenPaid,
    detail,
    orderIdOf,
    itemIds,
    refundItem,
    pendingRefund,
    manual,
    settle,
    retry,
    markProcessing,
    audits,
    refundMails,
  }
}

describe('giải quyết đối soát bằng hoàn tiền', () => {
  it('tạo khoản hoàn chờ thực hiện bằng số tiền của mục, đóng mục, ghi sự kiện và audit', async () => {
    const { cancelledThenPaid, itemIds, refundItem, detail, audits, accountant } = await refunds()
    const code = await cancelledThenPaid()
    const [item] = await itemIds(code)

    const res = await refundItem(item!)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      code,
      status: 'cancelled',
      received: TOTAL,
      refunded: 0,
      refunding: TOTAL,
      refundable: 0,
    })
    expect(res.body.refunds).toEqual([
      expect.objectContaining({
        amount: TOTAL,
        origin: 'reconciliation',
        status: 'pending',
        method: null,
        reconciliationItemId: item,
        createdBy: expect.objectContaining({ id: accountant.id }),
      }),
    ])
    expect(res.body.payments[0].reconciliation).toMatchObject({
      status: 'resolved',
      resolution: 'refunded',
      resolvedBy: { id: accountant.id },
    })
    const { history } = await detail(code)
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(['refund_created', 'reconciliation_resolved']))
    expect(await audits()).toContainEqual(
      expect.objectContaining({
        action: 'reconciliation.refund',
        actor: expect.objectContaining({ id: accountant.id }),
        after: expect.objectContaining({ resolution: 'refunded', refundId: res.body.refunds[0].id }),
      }),
    )
  })

  it('mục đã đóng thì 409; thiếu payment.reconcile thì 403', async () => {
    const { cancelledThenPaid, itemIds, refundItem, sales, warehouse } = await refunds()
    const code = await cancelledThenPaid()
    const [item] = await itemIds(code)

    expect((await refundItem(item!, sales.accessToken)).status).toBe(403)
    expect((await refundItem(item!, warehouse.accessToken)).status).toBe(403)
    expect((await refundItem(item!)).status).toBe(200)
    expect((await refundItem(item!)).status).toBe(409)
  })

  it('không vượt số còn hoàn được, kể cả khi hai mục được hoàn cùng lúc', async () => {
    const { cancelledThenPaid, itemIds, refundItem, detail, orderIdOf, prisma, accountant } = await refunds()
    const code = await cancelledThenPaid(TOTAL, TOTAL)
    const orderId = await orderIdOf(code)
    // Another refund already takes half the received amount: only one item can still be refunded.
    await prisma.refund.create({
      data: { orderId, amount: BigInt(TOTAL), origin: 'cancellation', createdById: accountant.id },
    })
    const [first, second] = await itemIds(code)

    const results = await Promise.all([refundItem(first!), refundItem(second!)])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const conflict = results.find((r) => r.status === 409)!
    expect(conflict.body.error.details).toEqual({ refundable: 0 })
    const after = await detail(code)
    expect(after).toMatchObject({ received: 2 * TOTAL, refunding: 2 * TOTAL, refundable: 0 })
  })

  it('đơn có khoản hoàn thì không khôi phục được', async () => {
    const { cancelledThenPaid, itemIds, refundItem, request, accountant } = await refunds()
    // The two payments add up to the order total: without refunds it can be restored.
    const code = await cancelledThenPaid(1_000_000, TOTAL - 1_000_000)
    const [first, second] = await itemIds(code)
    expect((await refundItem(first!)).status).toBe(200)

    const res = await request.post(`/api/admin/reconciliation/${second}/restore`).set(bearer(accountant.accessToken))

    expect(res.status).toBe(409)
    expect(res.body.error.message).toContain('hoàn tiền')
  })
})

describe('hoàn tiền thủ công', () => {
  it('chờ hoàn thành đã hoàn với mã ngân hàng và ngày chuyển, gửi email cho khách, ghi audit', async () => {
    const { pendingRefund, manual, detail, audits, refundMails, accountant } = await refunds()
    const { code, refundId } = await pendingRefund()

    const res = await manual(refundId, { bankReference: 'FT26321', transferredOn: '2026-11-18', note: 'VCB' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ refunded: TOTAL, refunding: 0, refundable: 0 })
    expect(res.body.refunds[0]).toMatchObject({
      status: 'succeeded',
      method: 'manual',
      bankReference: 'FT26321',
      transferredOn: '2026-11-18',
      note: 'VCB',
      executedBy: expect.objectContaining({ id: accountant.id }),
    })
    expect((await detail(code)).history.map((h) => h.action)).toContain('refund_succeeded')
    expect(await audits()).toContainEqual(
      expect.objectContaining({
        action: 'refund.execute_manual',
        before: expect.objectContaining({ refundId, status: 'pending' }),
        after: expect.objectContaining({ status: 'succeeded', method: 'manual', bankReference: 'FT26321' }),
      }),
    )
    const mails = await refundMails(code)
    expect(mails).toHaveLength(1)
    expect(mails[0]!.text).toContain('2.030.000')
    expect(mails[0]!.text).toContain('18/11/2026')
    expect(mails[0]!.text).toContain('/don-hang/')
    // The email leaks no internal details.
    expect(mails[0]!.text).not.toContain('FT26321')
  })

  it('thiếu mã ngân hàng hay ngày chuyển thì 400; đã thực hiện thì 409; sales và kho bị 403', async () => {
    const { pendingRefund, manual, sales, warehouse } = await refunds()
    const { refundId } = await pendingRefund()
    const body = { bankReference: 'FT1', transferredOn: '2026-11-18' }

    expect((await manual(refundId, { transferredOn: '2026-11-18' })).status).toBe(400)
    expect((await manual(refundId, { bankReference: 'FT1', transferredOn: '18/11/2026' })).status).toBe(400)
    expect((await manual(refundId, body, sales.accessToken)).status).toBe(403)
    expect((await manual(refundId, body, warehouse.accessToken)).status).toBe(403)
    expect((await manual(refundId, body)).status).toBe(200)
    expect((await manual(refundId, body)).status).toBe(409)
    expect((await manual('00000000-0000-0000-0000-000000000000', body)).status).toBe(404)
    expect((await manual('khong-phai-id', body)).status).toBe(404)
  })
})

describe('chốt khoản cổng đang xử lý và tạo lại', () => {
  it('chốt đã hoàn: gửi email, ghi người chốt', async () => {
    const { pendingRefund, markProcessing, settle, refundMails, accountant } = await refunds()
    const { code, orderId, refundId } = await pendingRefund()
    await markProcessing(orderId, refundId)

    const res = await settle(refundId, { outcome: 'succeeded', note: 'Đã thấy trên cổng merchant' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ refunded: TOTAL, refunding: 0 })
    expect(res.body.refunds[0]).toMatchObject({
      status: 'succeeded',
      settledBy: expect.objectContaining({ id: accountant.id }),
    })
    expect(await refundMails(code)).toHaveLength(1)
  })

  it('chốt thất bại trả lại số còn hoàn được; tạo lại một lần, không vượt khoản thất bại', async () => {
    const { pendingRefund, markProcessing, settle, retry, detail, audits, mailer } = await refunds()
    const { code, orderId, refundId } = await pendingRefund()

    expect((await settle(refundId, { outcome: 'failed', note: 'x' })).status).toBe(409) // pending, not via gateway
    await markProcessing(orderId, refundId)
    expect((await settle(refundId, { outcome: 'failed', note: '' })).status).toBe(400)

    const failed = await settle(refundId, { outcome: 'failed', note: 'Cổng từ chối' })
    expect(failed.status).toBe(200)
    expect(failed.body).toMatchObject({ refunded: 0, refunding: 0, refundable: TOTAL })
    expect(failed.body.refunds[0]).toMatchObject({ status: 'failed', retriedById: null })
    expect((await settle(refundId, { outcome: 'succeeded', note: 'x' })).status).toBe(409)

    expect((await retry(refundId, { amount: TOTAL + 1 })).status).toBe(409)
    expect((await retry(refundId, { amount: 0 })).status).toBe(400)
    const retried = await retry(refundId, { amount: TOTAL, note: 'Khách gửi lại số tài khoản' })
    expect(retried.status).toBe(200)
    expect(retried.body).toMatchObject({ refunding: TOTAL, refundable: 0 })
    const fresh = retried.body.refunds[1] as Refund
    expect(fresh).toMatchObject({ origin: 'retry', status: 'pending', retryOfId: refundId, amount: TOTAL })
    expect(retried.body.refunds[0].retriedById).toBe(fresh.id)
    expect((await retry(refundId, { amount: TOTAL })).status).toBe(409)
    expect((await retry(fresh.id, { amount: TOTAL })).status).toBe(409) // not failed

    expect((await audits()).map((a) => a.action)).toEqual(expect.arrayContaining(['refund.settle', 'refund.retry']))
    expect((await detail(code)).history.map((h) => h.action)).toContain('refund_failed')
    expect(mailer.sent.filter((m) => m.subject === `Đã hoàn tiền đơn hàng #${code}`)).toHaveLength(0)
  })
})

describe('danh sách đơn', () => {
  it('lọc "hoàn tiền chưa xong": có đơn chờ hoàn, hết khi đã hoàn', async () => {
    const { pendingRefund, cancelledThenPaid, manual, request, token } = await refunds()
    const { code, refundId } = await pendingRefund()
    await cancelledThenPaid() // needs reconciliation but has no refund yet
    const list = async () => {
      const res = await request
        .get('/api/admin/orders')
        .query({ status: 'all', paymentStatus: 'all', fulfillmentStatus: 'all', refund: 'open' })
        .set(bearer(token))
      expect(res.status).toBe(200)
      return (res.body.items as { code: number }[]).map((o) => o.code)
    }

    expect(await list()).toEqual([code])
    await manual(refundId, { bankReference: 'FT1', transferredOn: '2026-11-18' })
    expect(await list()).toEqual([])
  })
})
