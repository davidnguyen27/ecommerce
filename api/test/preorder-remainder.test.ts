import { describe, expect, it, vi } from 'vitest'
import type { InMemoryMailer } from '../src/adapters/mailer.ts'
import { expireOverdueOrders } from '../src/orders/cancel-order.ts'
import type { PaymentInfo } from '../src/payments/gateway.ts'
import { register } from './support/customer.ts'
import { preorderShop } from './support/preorder.ts'
import { bearer } from './support/staff.ts'
import { movementsOf } from './support/stock.ts'

/** 1 đôi AM-41: tiền hàng 2.100.000 + phí giao 30.000, cọc 30% = 630.000, còn lại 1.500.000. */
const DEPOSIT = 630_000
const REMAINING = 1_500_000

const paid = (...payments: [amount: number, reference: string][]): PaymentInfo => ({
  status: 'paid',
  transactions: payments.map(([amount, reference]) => ({ reference, amount, paidAt: new Date() })),
})

async function mailsAbout(mailer: InMemoryMailer, subject: string, count = 1) {
  return vi.waitFor(
    () => {
      const mails = mailer.sent.filter((m) => m.subject.includes(subject))
      if (mails.length < count) throw new Error('Chưa có thư')
      return mails
    },
    { timeout: 10_000, interval: 100 },
  )
}

/**
 * Một đơn đặt trước 1 đôi AM-41 đã cọc. `arrive()` ghi phiếu nhập 1 đôi để đơn về đủ hàng. `payRemainder()` gọi API trả
 * phần còn lại bằng token tra cứu; `settle(...)` cho cổng báo các khoản đã về qua link phần còn lại đầu tiên rồi hỏi cổng.
 */
async function depositedPreorder({ signedIn = false } = {}) {
  const app = await preorderShop()
  const { request, token: adminToken, v41 } = app
  const campaignId = await app.open([{ variantId: v41.id, allocation: 5 }])
  // Khách đăng nhập thì đơn gắn với tài khoản và không cần tick chính sách bảo mật.
  const customerToken = signedIn ? ((await register(request)).body.accessToken as string) : null
  const res = customerToken
    ? await app.preorder(campaignId, { acceptPrivacyPolicy: undefined }).set(bearer(customerToken))
    : await app.preorder(campaignId)
  expect(res.status).toBe(201)
  const { code, token: orderToken } = res.body as { code: number; token: string }
  const order = (query: Record<string, string> = {}) =>
    request.get(`/api/orders/${code}`).query({ token: orderToken, ...query })
  app.payments.payments.set(`${code}-deposit-1`, paid([DEPOSIT, `FT-DEP-${code}`]))
  expect((await order({ refresh: '1' })).body.paymentStatus).toBe('deposit_paid')

  const arrive = async () => {
    const receipt = await request
      .post('/api/admin/stock/receipts')
      .set(bearer(adminToken))
      .send({ supplierName: 'Nike VN', receivedOn: '2026-12-01', note: '', lines: [{ sku: 'AM-41', quantity: 1 }] })
    expect(receipt.status).toBe(201)
  }
  const payRemainder = () => request.post(`/api/orders/${code}/pay-remainder`).query({ token: orderToken })
  const settle = async (...payments: [amount: number, reference: string][]) => {
    app.payments.payments.set(`${code}-remainder-1`, paid(...payments))
    return order({ refresh: '1' })
  }
  const flags = async () => {
    const detail = await request.get(`/api/admin/orders/${code}`).set(bearer(adminToken))
    return (detail.body.payments as { purpose: string; reconciliation: { reason: string } | null }[]).map((p) => [
      p.purpose,
      p.reconciliation?.reason ?? null,
    ])
  }
  return { ...app, code, orderToken, customerToken, order, arrive, payRemainder, settle, flags }
}

describe('trả phần còn lại', () => {
  it('chưa về hàng thì 409, không tạo link', async () => {
    const app = await depositedPreorder()

    const res = await app.payRemainder()

    expect(res.status).toBe(409)
    expect(app.payments.created.filter((r) => r.purpose === 'remainder')).toEqual([])
  })

  it('đã về hàng: mỗi lần gọi một link mới, số tiền bằng phần còn lại, hạn 15 phút', async () => {
    const app = await depositedPreorder()
    await app.arrive()

    const first = await app.payRemainder()
    const second = await app.payRemainder()

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      checkoutUrl: `https://pay.test/${app.code}-remainder-1`,
      expiresAt: expect.any(String),
      token: null,
    })
    expect(Date.parse(first.body.expiresAt) - Date.now()).toBeGreaterThan(14 * 60_000)
    expect(second.body.checkoutUrl).toBe(`https://pay.test/${app.code}-remainder-2`)
    expect(app.payments.created.filter((r) => r.purpose === 'remainder')).toEqual([
      expect.objectContaining({ orderCode: app.code, amount: REMAINING }),
      expect.objectContaining({ orderCode: app.code, amount: REMAINING }),
    ])
  })

  it('trả đủ thì đơn đã trả đủ, khách nhận email đã nhận thanh toán, và kho soạn, bàn giao như đơn hàng sẵn', async () => {
    const app = await depositedPreorder()
    await app.arrive()
    await app.payRemainder()

    const res = await app.settle([REMAINING, `FT-REM-${app.code}`])

    expect(res.body).toMatchObject({ status: 'processing', paymentStatus: 'paid', fulfillmentStatus: 'not_prepared' })
    await mailsAbout(app.mailer, `Đã nhận thanh toán đơn hàng #${app.code}`)
    expect(await app.flags()).toEqual([
      ['deposit', null],
      ['remainder', null],
    ])

    const admin = (path: string, body?: object) =>
      app.request.post(`/api/admin/orders/${app.code}/${path}`).set(bearer(app.token)).send(body)
    expect((await admin('prepare')).status).toBe(200)
    expect((await admin('hand-over', { carrier: 'GHN', trackingNumber: 'GHN123' })).status).toBe(200)
    // Hàng rời kho: tồn và số đang giữ cùng giảm, sổ có một dòng xuất bán tham chiếu đơn.
    const stock = await app.request.get('/api/admin/stock').query({ q: 'AM-41' }).set(bearer(app.token))
    expect(stock.body.items.find((i: { sku: string }) => i.sku === 'AM-41')).toMatchObject({ onHand: 0, reserved: 0 })
    const sales = await movementsOf(app.request, app.token, { variantId: app.v41.id, kind: 'sale' })
    expect(sales.body.items).toEqual([expect.objectContaining({ quantity: -1, onHandAfter: 0 })])
  })

  it('trả lệch tiền thì cần đối soát, đơn vẫn đã cọc và vẫn trả lại được', async () => {
    const app = await depositedPreorder()
    await app.arrive()
    await app.payRemainder()

    const res = await app.settle([1_000_000, `FT-REM-${app.code}`])

    expect(res.body).toMatchObject({ paymentStatus: 'deposit_paid' })
    expect(await app.flags()).toEqual([
      ['deposit', null],
      ['remainder', 'amount_mismatch'],
    ])
    expect((await app.payRemainder()).status).toBe(200)
  })

  it('trả phần còn lại hai lần thì lần sau là tiền thừa cần đối soát', async () => {
    const app = await depositedPreorder()
    await app.arrive()
    await app.payRemainder()

    await app.settle([REMAINING, `FT-REM-1`], [REMAINING, `FT-REM-2`])

    expect((await app.order()).body).toMatchObject({ paymentStatus: 'paid' })
    expect(await app.flags()).toEqual([
      ['deposit', null],
      ['remainder', null],
      ['remainder', 'extra_payment'],
    ])
    expect((await app.payRemainder()).status).toBe(409)
  })

  it('link hết hạn mà chưa trả thì đơn không đổi', async () => {
    const app = await depositedPreorder()
    await app.arrive()
    await app.payRemainder()

    // Job hết hạn không có endpoint: test gọi thẳng hàm job chạy với `now` ở tương lai, rồi kiểm qua HTTP.
    expect(await expireOverdueOrders(app.expireDeps, new Date(Date.now() + 60 * 60_000))).toBe(0)

    expect((await app.order({ refresh: '1' })).body).toMatchObject({
      status: 'processing',
      paymentStatus: 'deposit_paid',
    })
  })

  it('token sai thì 404', async () => {
    const app = await depositedPreorder()
    await app.arrive()

    const res = await app.request.post(`/api/orders/${app.code}/pay-remainder`).query({ token: 'sai' })

    expect(res.status).toBe(404)
  })
})

describe('trả phần còn lại trong tài khoản', () => {
  it('khách đăng nhập trả được đơn của mình, nhận kèm token tra cứu mở được đơn; người khác thì 404', async () => {
    const app = await depositedPreorder({ signedIn: true })
    await app.arrive()
    const pay = (accessToken: string) =>
      app.request.post(`/api/account/orders/${app.code}/pay-remainder`).set(bearer(accessToken))

    const res = await pay(app.customerToken!)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      checkoutUrl: `https://pay.test/${app.code}-remainder-1`,
      token: expect.any(String),
    })
    expect((await app.request.get(`/api/orders/${app.code}`).query({ token: res.body.token })).status).toBe(200)
    const other = await register(app.request, { email: 'khac@example.com', password: 'mat-khau-khac-123' })
    expect((await pay(other.body.accessToken)).status).toBe(404)
  })
})
