import { describe, expect, it, vi } from 'vitest'
import type { InMemoryMailer } from '../src/adapters/mailer.ts'
import { expireOverdueOrders } from '../src/orders/cancel-order.ts'
import type { PaymentInfo } from '../src/payments/gateway.ts'
import { preorderShop } from './support/preorder.ts'
import { ADDRESS } from './support/shop.ts'
import { bearer } from './support/staff.ts'
import { ipnParams, signedIpn, txnRefOf } from './support/vnpay.ts'

const MINUTE = 60_000
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * MINUTE)
/** 30% của 2.100.000 (1 đôi AM-41). */
const DEPOSIT = 630_000

const paidInfo = (amount: number, reference: string): PaymentInfo => ({
  status: 'paid',
  transactions: [{ reference, amount, paidAt: new Date('2026-11-16T03:20:00Z') }],
})

/** Chờ thư có tiêu đề chứa `subject` qua hàng đợi job. */
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

/** Cửa hàng có đợt đang mở (AM-41 `allocation` suất) và một đơn đặt trước 1 đôi AM-41 đang chờ cọc. */
async function pendingPreorder(allocation = 5) {
  const app = await preorderShop()
  const campaignId = await app.open([{ variantId: app.v41.id, allocation }])
  const { code, token: orderToken } = await app.placed(campaignId)
  const order = () => app.request.get(`/api/orders/${code}`).query({ token: orderToken })
  /** Cổng báo khoản cọc đã về qua link cọc của đơn; trang kết quả hỏi cổng (`refresh=1`). */
  const payDeposit = async (amount = DEPOSIT, reference = `FT-${code}`, orderCode = code) => {
    app.payments.payments.set(`${orderCode}-deposit-1`, paidInfo(amount, reference))
    const res = await app.request.get(`/api/orders/${orderCode}`).query({ token: orderToken, refresh: '1' })
    return res
  }
  const detail = async (orderCode = code) => {
    const res = await app.request.get(`/api/admin/orders/${orderCode}`).set(bearer(app.token))
    expect(res.status).toBe(200)
    return res.body as {
      status: string
      paymentStatus: string
      payments: { purpose: string; reconciliation: { id: string; reason: string; status: string } | null }[]
      history: { action: string }[]
    }
  }
  const usedV41 = async () => {
    const res = await app.request.get(`/api/admin/preorder-campaigns/${campaignId}`).set(bearer(app.token))
    return (res.body.variants as { sku: string; used: number }[]).find((v) => v.sku === 'AM-41')!.used
  }
  return { ...app, campaignId, code, orderToken, order, payDeposit, detail, usedV41 }
}

describe('ghi nhận cọc', () => {
  it('cọc về đủ: đơn đã cọc và đang xử lý, hết hạn giữ suất, có lúc cọc; khách nhận email đã nhận cọc một lần', async () => {
    const app = await pendingPreorder()

    const res = await app.payDeposit()

    expect(res.body).toMatchObject({
      status: 'processing',
      paymentStatus: 'deposit_paid',
      reservedUntil: null,
      preorder: { depositAmount: DEPOSIT, remainingAmount: 1_500_000, depositPaidAt: expect.any(String) },
    })
    const [mail] = await mailsAbout(app.mailer, `Đã nhận tiền cọc đơn đặt trước #${app.code}`)
    expect(mail!.to).toBe('an@example.com')
    expect(mail!.text).toContain('630.000')
    expect(mail!.text).toContain('1.500.000')
    expect(mail!.text).toContain('10/12/2026 – 20/12/2026')
    expect(mail!.text).toContain('trong 7 ngày')
    // Hỏi cổng lần nữa: khoản đã ghi thì bỏ qua, không gửi thư thứ hai.
    await app.request.get(`/api/orders/${app.code}`).query({ token: app.orderToken, refresh: '1' })
    expect((await app.detail()).payments).toEqual([
      expect.objectContaining({ purpose: 'deposit', reconciliation: null }),
    ])
    expect((await app.detail()).history.filter((h) => h.action === 'deposit_paid')).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(app.mailer.sent.filter((m) => m.subject.includes('tiền cọc'))).toHaveLength(1)
  })

  it('IPN của VNPAY cho link cọc: trả 00, đơn đã cọc; IPN lặp trả 02 và chỉ ghi một giao dịch', async () => {
    const app = await pendingPreorder()
    // Dựng link cọc mang mã dạng VNPAY như cổng thật trả, để IPN tự ký trỏ đúng link.
    await app.prisma.paymentLink.updateMany({
      where: { gatewayReference: `${app.code}-deposit-1` },
      data: { gatewayReference: txnRefOf(app.code) },
    })
    const signed = signedIpn(ipnParams(app.code, DEPOSIT))

    const first = await app.request.get('/api/payments/vnpay/ipn').query(signed)
    const second = await app.request.get('/api/payments/vnpay/ipn').query(signed)

    expect(first.body.RspCode).toBe('00')
    expect(second.body.RspCode).toBe('02')
    expect((await app.order()).body).toMatchObject({ status: 'processing', paymentStatus: 'deposit_paid' })
    expect((await app.detail()).payments).toEqual([expect.objectContaining({ purpose: 'deposit' })])
  })

  it('cọc lệch tiền thì cần đối soát, đơn vẫn chờ cọc', async () => {
    const app = await pendingPreorder()

    await app.payDeposit(600_000)

    expect((await app.order()).body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
    expect((await app.detail()).payments).toEqual([
      expect.objectContaining({ reconciliation: expect.objectContaining({ reason: 'amount_mismatch' }) }),
    ])
  })

  it('khoản về thêm cho đơn đã cọc thì cần đối soát (tiền thừa), đơn vẫn đã cọc', async () => {
    const app = await pendingPreorder()
    await app.payDeposit()

    app.payments.payments.set(`${app.code}-deposit-1`, {
      status: 'paid',
      transactions: [
        { reference: `FT-${app.code}`, amount: DEPOSIT, paidAt: new Date('2026-11-16T03:20:00Z') },
        { reference: `FT-${app.code}-2`, amount: DEPOSIT, paidAt: new Date('2026-11-16T03:25:00Z') },
      ],
    })
    await app.request.get(`/api/orders/${app.code}`).query({ token: app.orderToken, refresh: '1' })

    expect((await app.order()).body).toMatchObject({ paymentStatus: 'deposit_paid' })
    expect((await app.detail()).payments.map((p) => p.reconciliation?.reason ?? null)).toEqual([null, 'extra_payment'])
  })

  it('job hết hạn không hủy đơn đã cọc', async () => {
    const app = await pendingPreorder()
    await app.payDeposit()

    expect(await expireOverdueOrders(app.expireDeps, inMinutes(16))).toBe(0)

    expect((await app.order()).body).toMatchObject({ status: 'processing', paymentStatus: 'deposit_paid' })
  })

  it('cổng báo đã cọc đúng lúc đơn sắp hết hạn: đơn thành đã cọc, không bị hủy', async () => {
    const app = await pendingPreorder()
    app.payments.payments.set(`${app.code}-deposit-1`, paidInfo(DEPOSIT, `FT-${app.code}`))

    expect(await expireOverdueOrders(app.expireDeps, inMinutes(16))).toBe(0)

    expect((await app.order()).body).toMatchObject({ status: 'processing', paymentStatus: 'deposit_paid' })
  })
})

describe('đơn đã cọc', () => {
  it('không hủy được: khách qua link tra cứu và nhân viên đều nhận 409', async () => {
    const app = await pendingPreorder()
    await app.payDeposit()

    const byCustomer = await app.request.post(`/api/orders/${app.code}/cancel`).query({ token: app.orderToken })
    const byStaff = await app.request.post(`/api/admin/orders/${app.code}/cancel`).set(bearer(app.token))

    expect(byCustomer.status).toBe(409)
    expect(byStaff.status).toBe(409)
    expect((await app.order()).body).toMatchObject({ status: 'processing', paymentStatus: 'deposit_paid' })
  })

  it('chưa soạn hàng được: giao hàng chỉ bắt đầu khi đã trả đủ', async () => {
    const app = await pendingPreorder()
    await app.payDeposit()

    const res = await app.request.post(`/api/admin/orders/${app.code}/prepare`).set(bearer(app.token))

    expect(res.status).toBe(409)
    expect((await app.order()).body).toMatchObject({ fulfillmentStatus: 'not_prepared' })
  })
})

describe('cọc về sau khi đơn đã hủy', () => {
  it('cần đối soát; kế toán khôi phục được khi đợt còn suất: đơn thành đã cọc, lấy lại suất, khách nhận email', async () => {
    const app = await pendingPreorder()
    expect((await app.request.post(`/api/orders/${app.code}/cancel`).query({ token: app.orderToken })).status).toBe(200)
    expect(await app.usedV41()).toBe(0)

    await app.payDeposit()
    const flagged = (await app.detail()).payments[0]!.reconciliation!
    expect(flagged).toMatchObject({ reason: 'paid_after_cancel', status: 'open' })
    expect((await app.order()).body).toMatchObject({ status: 'cancelled' })

    const restored = await app.request.post(`/api/admin/reconciliation/${flagged.id}/restore`).set(bearer(app.token))

    expect(restored.status).toBe(200)
    expect((await app.order()).body).toMatchObject({
      status: 'processing',
      paymentStatus: 'deposit_paid',
      cancelReason: null,
      preorder: { depositPaidAt: expect.any(String) },
    })
    expect(await app.usedV41()).toBe(1)
    await mailsAbout(app.mailer, `Đã nhận tiền cọc đơn đặt trước #${app.code}`)
  })

  it('đợt đã hết suất thì không khôi phục được (409), đơn vẫn hủy', async () => {
    const app = await pendingPreorder(1)
    expect((await app.request.post(`/api/orders/${app.code}/cancel`).query({ token: app.orderToken })).status).toBe(200)
    // Khách khác lấy suất cuối trong lúc đơn đã hủy.
    await app.placed(app.campaignId, { address: { ...ADDRESS, email: 'b@example.com' } })
    await app.payDeposit()
    const flagged = (await app.detail()).payments[0]!.reconciliation!

    const restored = await app.request.post(`/api/admin/reconciliation/${flagged.id}/restore`).set(bearer(app.token))

    expect(restored.status).toBe(409)
    expect((await app.order()).body).toMatchObject({ status: 'cancelled' })
  })
})
