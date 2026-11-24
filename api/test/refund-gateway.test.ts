import { describe, expect, it, vi } from 'vitest'
import { DEPOSIT, REMAINING, depositedPreorder, paid } from './support/preorder.ts'
import { shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const TOTAL = 2_030_000

type Refund = { id: string; amount: number; status: string; method: string | null; note: string | null }

/**
 * A shop with the in-memory gateway (simulator off; `payments.refundResults` queues refund results).
 * `cancelled(refundAmount)` builds a paid in-stock order that was cancelled, with one pending refund.
 */
async function gatewayRefunds() {
  const app = await shop()
  const { request, token, checkout } = app
  const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const cancelled = async (refundAmount = TOTAL) => {
    const placed = await checkout()
    expect(placed.status).toBe(201)
    const { code, token: lookup } = placed.body as { code: number; token: string }
    // The in-memory gateway reports payment via query, as a real gateway transaction would arrive.
    app.payments.payments.set(String(code), paid([TOTAL, `FT-${code}`]))
    const view = await request.get(`/api/orders/${code}`).query({ token: lookup, refresh: '1' })
    expect(view.body.paymentStatus).toBe('paid')
    const res = await request
      .post(`/api/admin/orders/${code}/cancel-paid`)
      .set(bearer(token))
      .send({ cause: 'changed_mind', refundAmount, ...(refundAmount < TOTAL && { note: 'Khấu trừ' }) })
    expect(res.status).toBe(200)
    return { code, refundId: (res.body.refunds as Refund[])[0]!.id }
  }
  const viaGateway = (refundId: string, as = accountant.accessToken) =>
    request.post(`/api/admin/refunds/${refundId}/vnpay`).set(bearer(as))
  const mails = (code: number) => app.mailer.sent.filter((m) => m.subject === `Đã hoàn tiền đơn hàng #${code}`)
  return { ...app, accountant, sales, cancelled, viaGateway, mails }
}

describe('hoàn qua cổng', () => {
  it('cổng báo đã hoàn: khoản thành đã hoàn qua cổng, gắn giao dịch gốc, gửi email, ghi audit', async () => {
    const { cancelled, viaGateway, payments, mails, request, token } = await gatewayRefunds()
    const { code, refundId } = await cancelled()

    const res = await viaGateway(refundId)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ refunded: TOTAL, refunding: 0, gatewayRefundable: 0 })
    expect(res.body.refunds[0]).toMatchObject({ status: 'succeeded', method: 'vnpay', amount: TOTAL })
    expect(res.body.refunds[0].paymentTransactionId).toBe(res.body.payments[0].id)
    expect(payments.refunds).toEqual([
      expect.objectContaining({ refundId, orderCode: code, amount: TOTAL, full: true }),
    ])
    await vi.waitFor(() => expect(mails(code)).toHaveLength(1), { timeout: 10_000, interval: 100 })
    const audits = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    const actions = (audits.body.items as { action: string }[]).map((a) => a.action)
    expect(actions).toEqual(expect.arrayContaining(['refund.execute_vnpay', 'refund.gateway_result']))
  })

  it('hoàn một phần giao dịch thì báo cổng là một phần', async () => {
    const { cancelled, viaGateway, payments } = await gatewayRefunds()
    const { refundId } = await cancelled(TOTAL - 30_000)

    expect((await viaGateway(refundId)).status).toBe(200)

    expect(payments.refunds[0]).toMatchObject({ amount: TOTAL - 30_000, full: false })
  })

  it('cổng đang xử lý: khoản ở đang xử lý, kế toán chốt sau', async () => {
    const { cancelled, viaGateway, payments, request, accountant, mails } = await gatewayRefunds()
    const { code, refundId } = await cancelled()
    payments.refundResults.push('processing')

    const res = await viaGateway(refundId)

    expect(res.body.refunds[0]).toMatchObject({ status: 'processing', method: 'vnpay' })
    expect(res.body).toMatchObject({ refunding: TOTAL, gatewayRefundable: 0 })
    expect(mails(code)).toHaveLength(0)
    const settled = await request
      .post(`/api/admin/refunds/${refundId}/settle`)
      .set(bearer(accountant.accessToken))
      .send({ outcome: 'succeeded', note: 'Đã thấy trên cổng merchant' })
    expect(settled.body.refunds[0].status).toBe('succeeded')
  })

  it('cổng từ chối: khoản thất bại kèm lý do, trả lại số hoàn được; tạo lại rồi hoàn lại qua cổng', async () => {
    const { cancelled, viaGateway, payments, request, accountant } = await gatewayRefunds()
    const { refundId } = await cancelled()
    payments.refundResults.push('rejected')

    const res = await viaGateway(refundId)

    expect(res.body.refunds[0]).toMatchObject({ status: 'failed', note: expect.stringContaining('rejected') })
    expect(res.body).toMatchObject({ refundable: TOTAL, gatewayRefundable: TOTAL })
    const retried = await request
      .post(`/api/admin/refunds/${refundId}/retry`)
      .set(bearer(accountant.accessToken))
      .send({ amount: TOTAL })
    const fresh = (retried.body.refunds as Refund[])[1]!
    const again = await viaGateway(fresh.id)
    expect(again.body.refunds[1]).toMatchObject({ status: 'succeeded' })
  })

  it('cổng không trả lời: khoản ở đang xử lý kèm lý do để kế toán kiểm, không gửi lại', async () => {
    const { cancelled, viaGateway, payments } = await gatewayRefunds()
    const { refundId } = await cancelled()
    payments.refundResults.push('error')

    const res = await viaGateway(refundId)

    expect(res.status).toBe(200)
    expect(res.body.refunds[0]).toMatchObject({ status: 'processing', note: expect.stringContaining('không trả lời') })
    expect((await viaGateway(refundId)).status).toBe(409)
    expect(payments.refunds).toHaveLength(1)
  })

  it('không có giao dịch hoàn qua cổng được thì 409, khoản vẫn chờ hoàn thủ công', async () => {
    const { cancelled, viaGateway, payments, request, token } = await gatewayRefunds()
    const { code, refundId } = await cancelled()
    payments.allowRefund = false

    const res = await viaGateway(refundId)

    expect(res.status).toBe(409)
    expect(res.body.error.message).toContain('chuyển khoản')
    const detail = await request.get(`/api/admin/orders/${code}`).set(bearer(token))
    expect(detail.body).toMatchObject({ gatewayRefundable: 0 })
    expect(detail.body.refunds[0]).toMatchObject({ status: 'pending', method: null })
    expect(payments.refunds).toHaveLength(0)
  })

  it('đã thực hiện thì 409; thiếu payment.refund thì 403; id lạ thì 404', async () => {
    const { cancelled, viaGateway, sales } = await gatewayRefunds()
    const { refundId } = await cancelled()

    expect((await viaGateway(refundId, sales.accessToken)).status).toBe(403)
    expect((await viaGateway('00000000-0000-0000-0000-000000000000')).status).toBe(404)
    expect((await viaGateway(refundId)).status).toBe(200)
    expect((await viaGateway(refundId)).status).toBe(409)
  })
})

describe('đơn đặt trước có hai giao dịch', () => {
  it('chia theo giao dịch, mới nhất trước: phần còn lại rồi tới tiền cọc, mỗi phần một khoản', async () => {
    const app = await depositedPreorder()
    const { request, token, code, arrive, payRemainder, settle, payments } = app
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    await arrive()
    expect((await payRemainder()).status).toBe(200)
    expect((await settle([REMAINING, `FT-REM-${code}`])).body.paymentStatus).toBe('paid')
    const cancelled = await request
      .post(`/api/admin/orders/${code}/cancel-paid`)
      .set(bearer(token))
      .send({ cause: 'other', refundAmount: DEPOSIT + REMAINING })
    const refundId = (cancelled.body.refunds as Refund[])[0]!.id

    const res = await request.post(`/api/admin/refunds/${refundId}/vnpay`).set(bearer(accountant.accessToken))

    expect(res.status).toBe(200)
    expect(payments.refunds.map((r) => [r.amount, r.full, r.transaction.reference])).toEqual([
      [REMAINING, true, `FT-REM-${code}`],
      [DEPOSIT, true, `FT-DEP-${code}`],
    ])
    expect((res.body.refunds as Refund[]).map((r) => [r.amount, r.status, r.method])).toEqual([
      [REMAINING, 'succeeded', 'vnpay'],
      [DEPOSIT, 'succeeded', 'vnpay'],
    ])
    expect(res.body).toMatchObject({ refunded: DEPOSIT + REMAINING, refundable: 0, gatewayRefundable: 0 })
  })
})

describe('cổng giả lập (local, bản demo)', () => {
  it('hoàn được giao dịch giả lập; chữ số cuối 1 là đang xử lý, 2 là bị từ chối, còn lại là đã hoàn', async () => {
    const { request, token, checkout } = await shop({ simulator: true })
    const statusFor = async (refundAmount: number) => {
      const code = (await checkout()).body.code as number
      await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: TOTAL })
      const cancelled = await request
        .post(`/api/admin/orders/${code}/cancel-paid`)
        .set(bearer(token))
        .send({ cause: 'changed_mind', refundAmount, note: 'Thử cổng giả lập' })
      expect(cancelled.body.gatewayRefundable).toBe(TOTAL)
      const refundId = (cancelled.body.refunds as Refund[])[0]!.id
      const res = await request.post(`/api/admin/refunds/${refundId}/vnpay`).set(bearer(token))
      return (res.body.refunds as Refund[])[0]!.status
    }

    expect(await statusFor(TOTAL)).toBe('succeeded')
    expect(await statusFor(1_000_001)).toBe('processing')
    expect(await statusFor(1_000_002)).toBe('failed')
  })
})

describe('kết quả cổng đến muộn', () => {
  it('khoản đã được chốt tay trong lúc chờ cổng thì kết quả cổng không ghi đè, tổng hoàn không vượt đã nhận', async () => {
    const { cancelled, viaGateway, payments, request, accountant, token } = await gatewayRefunds()
    const { code, refundId } = await cancelled()
    const asAccountant = (path: string, body: Record<string, unknown>) =>
      request.post(`/api/admin/refunds/${refundId}/${path}`).set(bearer(accountant.accessToken)).send(body)
    // While the gateway has not answered: accounting settles it as failed, then recreates a new refund.
    payments.beforeRefundResult = async () => {
      expect((await asAccountant('settle', { outcome: 'failed', note: 'Cổng báo lỗi trên merchant' })).status).toBe(200)
      expect((await asAccountant('retry', { amount: TOTAL })).status).toBe(200)
    }

    const res = await viaGateway(refundId)

    expect(res.status).toBe(200)
    expect((res.body.refunds as Refund[]).map((r) => r.status)).toEqual(['failed', 'pending'])
    expect(res.body).toMatchObject({ refunded: 0, refunding: TOTAL, refundable: 0 })
    const audits = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    const result = (audits.body.items as { action: string; after: { results: { ignored?: string }[] } }[]).find(
      (a) => a.action === 'refund.gateway_result',
    )!
    expect(result.after.results[0]!.ignored).toBeDefined()
    expect(code).toBeGreaterThan(0)
  })
})
