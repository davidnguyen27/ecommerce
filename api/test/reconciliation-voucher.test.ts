import { describe, expect, it } from 'vitest'
import type { PaymentInfo } from '../src/payments/gateway.ts'
import { preorderShop } from './support/preorder.ts'
import { ADDRESS } from './support/shop.ts'
import { bearer } from './support/staff.ts'

const DAY = 24 * 60 * 60_000
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString()

const paidInfo = (amount: number, reference: string): PaymentInfo => ({
  status: 'paid',
  transactions: [{ reference, amount, paidAt: new Date() }],
})

const customer = (n: number) => ({ ...ADDRESS, email: `khach${n}@example.com`, phone: `091000000${n}` })

/**
 * A shop (AM-40 in stock at 2,000,000, AM-41 pre-order at 2,100,000 with 30% deposit) with voucher `TET2027` at 10%
 * and `totalLimit` uses. `cancelledThenPaid` builds an order with the voucher that the customer cancels before the
 * exact discounted amount arrives: reconciliation needed.
 */
async function voucherReconciliation(totalLimit: number) {
  const app = await preorderShop()
  const { request, token } = app
  const campaignId = await app.open([{ variantId: app.v41.id, allocation: 5 }])
  const created = await request
    .post('/api/admin/vouchers')
    .set(bearer(token))
    .send({
      code: 'TET2027',
      kind: 'percent',
      percent: 10,
      maxDiscount: 500_000,
      startsAt: at(-1),
      endsAt: at(30),
      saleTypes: ['standard', 'preorder'],
      totalLimit,
      perCustomerLimit: 5,
    })
  expect(created.status).toBe(201)

  /** Customer `n` orders 1 pair of AM-40 with the voucher: 200,000 off, total 1,830,000. */
  const standard = async (n: number) => {
    const res = await app.checkout({ address: customer(n), voucherCode: 'TET2027', discount: 200_000 })
    expect(res.status).toBe(201)
    return { ...(res.body as { code: number; token: string }), kind: 'full', amount: 1_830_000 }
  }
  /** Customer `n` pre-orders 1 pair of AM-41 with the voucher: 210,000 off, deposit 567,000. */
  const preorder = async (n: number) => {
    const res = await app.preorder(campaignId, { address: customer(n), voucherCode: 'TET2027', discount: 210_000 })
    expect(res.status).toBe(201)
    return { ...(res.body as { code: number; token: string }), kind: 'deposit', amount: 567_000 }
  }
  const view = (placed: { code: number; token: string }) =>
    request.get(`/api/orders/${placed.code}`).query({ token: placed.token })
  const cancelledThenPaid = async (placed: { code: number; token: string; kind: string; amount: number }) => {
    expect((await request.post(`/api/orders/${placed.code}/cancel`).query({ token: placed.token })).status).toBe(200)
    // Gateway reference: an in-stock order uses its code, a deposit link `<code>-deposit-1` (in-memory fake gateway).
    const reference = placed.kind === 'full' ? String(placed.code) : `${placed.code}-deposit-1`
    app.payments.payments.set(reference, paidInfo(placed.amount, `FT-${placed.code}`))
    await view({ ...placed }).query({ refresh: '1' })
  }
  const detail = async (code: number) => {
    const res = await request.get(`/api/admin/orders/${code}`).set(bearer(token))
    expect(res.status).toBe(200)
    return res.body as {
      payments: { reconciliation: { id: string } | null }[]
      history: { action: string; data: Record<string, unknown> }[]
    }
  }
  const restore = async (code: number) => {
    const item = (await detail(code)).payments.find((p) => p.reconciliation)!.reconciliation!
    return request.post(`/api/admin/reconciliation/${item.id}/restore`).set(bearer(token))
  }
  const restoreAudit = async () => {
    const res = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    return (res.body.items as { action: string; after: Record<string, unknown> }[]).find(
      (a) => a.action === 'reconciliation.restore',
    )!
  }
  return { ...app, standard, preorder, view, cancelledThenPaid, detail, restore, restoreAudit }
}

describe('khôi phục đơn có mã giảm giá', () => {
  it('mã đã hết lượt vẫn khôi phục được, giữ nguyên phần giảm, và ghi voucherOverLimit vào sự kiện và audit', async () => {
    const app = await voucherReconciliation(1)
    const first = await app.standard(1)
    await app.cancelledThenPaid(first)
    // The use freed up when the order was cancelled, and another customer took it.
    await app.standard(2)

    const res = await app.restore(first.code)

    expect(res.status).toBe(200)
    expect((await app.view(first)).body).toMatchObject({
      status: 'processing',
      paymentStatus: 'paid',
      voucherCode: 'TET2027',
      discount: 200_000,
      total: 1_830_000,
    })
    const overLimit = { code: 'TET2027', used: 2, totalLimit: 1 }
    const restored = (await app.detail(first.code)).history.find((h) => h.action === 'restored')!
    expect(restored.data).toMatchObject({ voucherOverLimit: overLimit })
    expect((await app.restoreAudit()).after).toMatchObject({ voucherOverLimit: overLimit })
  })

  it('mã còn lượt thì không ghi voucherOverLimit', async () => {
    const app = await voucherReconciliation(5)
    const first = await app.standard(1)
    await app.cancelledThenPaid(first)

    expect((await app.restore(first.code)).status).toBe(200)

    const restored = (await app.detail(first.code)).history.find((h) => h.action === 'restored')!
    expect(restored.data).not.toHaveProperty('voucherOverLimit')
    expect((await app.restoreAudit()).after).not.toHaveProperty('voucherOverLimit')
  })

  it('đơn đặt trước có mã: tiền cọc sau giảm về sau khi hủy thì khôi phục thành đã cọc', async () => {
    const app = await voucherReconciliation(1)
    const first = await app.preorder(1)
    await app.cancelledThenPaid(first)
    await app.preorder(2)

    expect((await app.restore(first.code)).status).toBe(200)

    expect((await app.view(first)).body).toMatchObject({
      status: 'processing',
      paymentStatus: 'deposit_paid',
      discount: 210_000,
      preorder: { depositAmount: 567_000 },
    })
    const restored = (await app.detail(first.code)).history.find((h) => h.action === 'restored')!
    expect(restored.data).toMatchObject({ voucherOverLimit: { code: 'TET2027', used: 2, totalLimit: 1 } })
  })
})
