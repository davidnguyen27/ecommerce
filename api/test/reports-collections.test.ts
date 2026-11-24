import { describe, expect, it } from 'vitest'
import { backdate } from './support/backdate.ts'
import { DEPOSIT, REMAINING, depositedPreorder, paid } from './support/preorder.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff, type Request } from './support/staff.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }
const DAY = 24 * 60 * 60_000
/** Vietnam-time calendar day, `days` days from today. */
const vnDate = (days = 0) => new Date(Date.now() + 7 * 60 * 60_000 + days * DAY).toISOString().slice(0, 10)

type Figures = {
  receivedFull: number
  receivedDeposit: number
  receivedRemainder: number
  received: number
  refundedCancellation: number
  refundedReconciliation: number
  refundedReturn: number
  refunded: number
  net: number
}
type Counted = { count: number; amount: number }
type Report = {
  rows: (Figures & { period: string })[]
  total: Figures
  snapshot: { depositsHeld: Counted; outstanding: Counted; refunding: Counted; reconciliation: Counted }
}

const ZERO: Figures = {
  receivedFull: 0,
  receivedDeposit: 0,
  receivedRemainder: 0,
  received: 0,
  refundedCancellation: 0,
  refundedReconciliation: 0,
  refundedReturn: 0,
  refunded: 0,
  net: 0,
}
const NONE = { count: 0, amount: 0 }

const collections = async (request: Request, token: string, query = { from: vnDate(), to: vnDate() }) => {
  const res = await request.get('/api/admin/reports/collections').query(query).set(bearer(token))
  expect(res.status).toBe(200)
  return res.body as Report
}

/**
 * A pre-order of 1 pair of AM-41 with a 630,000 deposit (`depositedPreorder`), in-memory gateway. `standardPaid` orders
 * 1 pair of AM-40 and the gateway reports 2,030,000 in full. `cancelPaid` cancels a paid order with the proposed
 * refund; `executeManual` records a transfer.
 */
async function collectionsShop() {
  const app = await depositedPreorder()
  const { request, token } = app
  let n = 0
  const refresh = (code: number, orderToken: string) =>
    request.get(`/api/orders/${code}`).query({ token: orderToken, refresh: '1' })
  const standardPaid = async () => {
    n += 1
    const res = await app.checkout({
      address: { ...ADDRESS, email: `le${n}@example.com`, phone: `09110000${String(n).padStart(2, '0')}` },
    })
    expect(res.status).toBe(201)
    const placed = res.body as { code: number; token: string }
    app.payments.payments.set(String(placed.code), paid([2_030_000, `FT-FULL-${placed.code}`]))
    expect((await refresh(placed.code, placed.token)).body.paymentStatus).toBe('paid')
    return placed
  }
  const cancelPaid = async (code: number, refundAmount: number) => {
    const res = await request
      .post(`/api/admin/orders/${code}/cancel-paid`)
      .set(bearer(token))
      .send({ cause: 'changed_mind', refundAmount, note: 'Khách đổi ý' })
    expect(res.status).toBe(200)
    const refunds = res.body.refunds as { id: string; status: string }[]
    return refunds.find((r) => r.status === 'pending')?.id
  }
  const executeManual = async (refundId: string) => {
    const res = await request
      .post(`/api/admin/refunds/${refundId}/manual`)
      .set(bearer(token))
      .send({ bankReference: `FT-HOAN-${refundId.slice(0, 6)}`, transferredOn: vnDate(), note: 'VCB' })
    expect(res.status).toBe(200)
  }
  const report = (query?: { from: string; to: string }) => collections(request, token, query)
  return { ...app, refresh, standardPaid, cancelPaid, executeManual, report }
}

describe('báo cáo tiền thu', () => {
  it('chỉ owner và kế toán xem được', async () => {
    const { request, token } = await shop()
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')

    expect((await collections(request, accountant.accessToken)).total).toEqual(ZERO)
    const res = await request
      .get('/api/admin/reports/collections')
      .query({ from: vnDate(), to: vnDate() })
      .set(bearer(sales.accessToken))
    expect(res.status).toBe(403)
  })

  it('tiền vào chia theo trả đủ, cọc, phần còn lại; khoản hoàn chỉ trừ khi đã xong, theo nguồn', async () => {
    const app = await collectionsShop()
    await app.arrive()
    expect((await app.payRemainder()).status).toBe(200)
    expect((await app.settle([REMAINING, 'FT-REM'])).body.paymentStatus).toBe('paid')
    const standard = await app.standardPaid()

    const received = { receivedFull: 2_030_000, receivedDeposit: DEPOSIT, receivedRemainder: REMAINING }
    const before = await app.report()
    expect(before.total).toEqual({ ...ZERO, ...received, received: 4_160_000, net: 4_160_000 })

    const refundId = await app.cancelPaid(standard.code, 2_030_000)
    const pending = await app.report()
    expect(pending.total).toEqual(before.total)
    expect(pending.snapshot.refunding).toEqual({ count: 1, amount: 2_030_000 })

    await app.executeManual(refundId!)
    const done = await app.report()
    expect(done.total).toEqual({
      ...ZERO,
      ...received,
      received: 4_160_000,
      refundedCancellation: 2_030_000,
      refunded: 2_030_000,
      net: 2_130_000,
    })
    expect(done.snapshot.refunding).toEqual(NONE)
  })

  it('tiền vào theo ngày nhận, giờ Việt Nam: khoản về hôm qua nằm ở dòng hôm qua', async () => {
    const app = await collectionsShop()
    await backdate(app.prisma, 'payment_transaction', app.code, new Date(Date.now() - DAY))

    const report = await app.report({ from: vnDate(-1), to: vnDate() })

    expect(report.rows.map((r) => [r.period, r.receivedDeposit])).toEqual([
      [vnDate(-1), DEPOSIT],
      [vnDate(), 0],
    ])
  })

  it('khoản hoàn tạo lại sau thất bại tính theo nguồn của khoản gốc; khoản thất bại không trừ', async () => {
    const app = await collectionsShop()
    const standard = await app.standardPaid()
    const refundId = (await app.cancelPaid(standard.code, 2_030_000))!
    // Set up the state: the gateway reports a failed refund.
    const transaction = await app.prisma.paymentTransaction.findFirstOrThrow({
      where: { order: { code: standard.code } },
    })
    const owner = await app.prisma.staff.findFirstOrThrow()
    await app.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'failed',
        method: 'vnpay',
        paymentTransactionId: transaction.id,
        executedById: owner.id,
        executedAt: new Date(),
        completedAt: new Date(),
      },
    })
    expect((await app.report()).total.refunded).toBe(0)

    const retried = await app.request
      .post(`/api/admin/refunds/${refundId}/retry`)
      .set(bearer(app.token))
      .send({ amount: 2_030_000 })
    expect(retried.status).toBe(200)
    const retryId = (retried.body.refunds as { id: string; status: string }[]).find((r) => r.status === 'pending')!.id
    await app.executeManual(retryId)

    expect((await app.report()).total).toMatchObject({ refundedCancellation: 2_030_000, refunded: 2_030_000 })
  })

  it('cọc đang giữ và còn phải thu theo vòng đời đơn đặt trước: đã cọc, đã hủy, đã về hàng, đã trả đủ, đã giao', async () => {
    const app = await collectionsShop()
    const { request, token, code } = app
    const { preorderCampaignId } = await app.prisma.order.findUniqueOrThrow({ where: { code } })
    const other = await app.placed(preorderCampaignId!, {
      address: { ...ADDRESS, email: 'khach2@example.com', phone: '0920000002' },
    })
    app.payments.payments.set(`${other.code}-deposit-1`, paid([DEPOSIT, 'FT-DEP-2']))
    expect((await app.refresh(other.code, other.token)).body.paymentStatus).toBe('deposit_paid')
    const snapshot = async () => (await app.report()).snapshot

    expect(await snapshot()).toMatchObject({
      depositsHeld: { count: 2, amount: 2 * DEPOSIT },
      outstanding: { count: 2, amount: 2 * REMAINING },
    })

    // Cancel the second order with a full deposit refund not yet transferred: it no longer counts, the refund shows as
    // refunding.
    await app.cancelPaid(other.code, DEPOSIT)
    expect(await snapshot()).toEqual({
      depositsHeld: { count: 1, amount: DEPOSIT },
      outstanding: { count: 1, amount: REMAINING },
      refunding: { count: 1, amount: DEPOSIT },
      reconciliation: NONE,
    })

    await app.arrive()
    expect(await snapshot()).toMatchObject({
      depositsHeld: { count: 1, amount: DEPOSIT },
      outstanding: { count: 1, amount: REMAINING },
    })

    expect((await app.payRemainder()).status).toBe(200)
    expect((await app.settle([REMAINING, 'FT-REM'])).body.paymentStatus).toBe('paid')
    expect(await snapshot()).toMatchObject({
      depositsHeld: { count: 1, amount: DEPOSIT + REMAINING },
      outstanding: NONE,
    })

    for (const [path, body] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      expect((await request.post(`/api/admin/orders/${code}/${path}`).set(bearer(token)).send(body)).status).toBe(200)
    }
    expect(await snapshot()).toMatchObject({ depositsHeld: NONE, outstanding: NONE })
  })

  it('tiền về sau khi đơn hủy vẫn là tiền vào và hiện ở "cần đối soát"', async () => {
    const app = await shop({ simulator: true })
    const placed = await app.checkout()
    expect(placed.status).toBe(201)
    const { code, token: orderToken } = placed.body as { code: number; token: string }
    expect((await app.request.post(`/api/orders/${code}/cancel`).query({ token: orderToken })).status).toBe(200)
    const pay = await app.request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: 2_030_000 })
    expect(pay.status).toBe(204)

    const report = await collections(app.request, app.token)

    expect(report.total).toMatchObject({ receivedFull: 2_030_000, received: 2_030_000, net: 2_030_000 })
    expect(report.snapshot.reconciliation).toEqual({ count: 1, amount: 2_030_000 })
  })
})
