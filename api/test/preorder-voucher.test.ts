import { describe, expect, it, vi } from 'vitest'
import { ADDRESS, HA_NOI } from './support/shop.ts'
import { paid, preorderShop } from './support/preorder.ts'
import { bearer } from './support/staff.ts'

const DAY = 24 * 60 * 60_000
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString()

// 1 pair of AM-41 at 2,100,000, 30% deposit, 30,000 shipping. Voucher TET2027 at 10% (max 500,000) = 210,000:
// goods after discount 1,890,000, 30% deposit = 567,000, total 1,920,000, remainder 1,353,000.
const DISCOUNT = 210_000
const DEPOSIT = 567_000
const TOTAL = 1_920_000
const REMAINING = 1_353_000

/** A pre-order shop with an open AM-41 campaign and a helper to create vouchers via the admin API. */
async function voucherPreorderShop() {
  const app = await preorderShop()
  const campaignId = await app.open([{ variantId: app.v41.id, allocation: 5 }])
  const voucher = async (overrides: Record<string, unknown> = {}) => {
    const res = await app.request
      .post('/api/admin/vouchers')
      .set(bearer(app.token))
      .send({
        code: 'TET2027',
        kind: 'percent',
        percent: 10,
        maxDiscount: 500_000,
        startsAt: at(-1),
        endsAt: at(30),
        saleTypes: ['standard', 'preorder'],
        ...overrides,
      })
    expect(res.status).toBe(201)
    return res.body as { id: string }
  }
  const withVoucher = (body: Record<string, unknown> = {}) =>
    app.preorder(campaignId, { voucherCode: 'tet2027', discount: DISCOUNT, ...body })
  return { ...app, campaignId, voucher, withVoucher }
}

describe('báo giá đặt trước kèm mã', () => {
  it('tiền cọc và phần còn lại tính trên tiền hàng sau giảm; kèm các khoản khi không dùng mã', async () => {
    const app = await voucherPreorderShop()
    await app.voucher()

    const res = await app.quote({ provinceCode: HA_NOI, voucherCode: 'tet2027' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      subtotal: 2_100_000,
      voucher: { applied: true, code: 'TET2027', discount: DISCOUNT },
      discount: DISCOUNT,
      depositAmount: DEPOSIT,
      shippingFee: 30_000,
      total: TOTAL,
      remainingAmount: REMAINING,
      depositAmountWithoutVoucher: 630_000,
      totalWithoutVoucher: 2_130_000,
    })
  })

  it('mã chỉ cho hàng sẵn thì sale_type ở đặt trước; mã chỉ cho đặt trước thì sale_type ở đặt mua', async () => {
    const app = await voucherPreorderShop()
    await app.voucher({ code: 'HANGSAN', saleTypes: ['standard'] })
    await app.voucher({ code: 'DATTRUOC', saleTypes: ['preorder'] })

    expect((await app.quote({ voucherCode: 'HANGSAN' })).body).toMatchObject({
      voucher: { applied: false, reason: 'sale_type' },
      discount: 0,
      depositAmount: 630_000,
    })
    expect((await app.quote({ voucherCode: 'DATTRUOC' })).body.voucher).toMatchObject({ applied: true })
    const checkout = await app.request
      .post('/api/checkout/quote')
      .send({ lines: [{ variantId: app.v40.id, quantity: 1 }], voucherCode: 'DATTRUOC' })
    expect(checkout.body.voucher).toMatchObject({ applied: false, reason: 'sale_type' })
  })
})

describe('đặt trước kèm mã', () => {
  it('chụp phần giảm vào đơn; link cọc bằng tiền cọc sau giảm', async () => {
    const app = await voucherPreorderShop()
    await app.voucher()

    const res = await app.withVoucher()

    expect(res.status).toBe(201)
    expect(app.payments.created.at(-1)).toMatchObject({ orderCode: res.body.code, amount: DEPOSIT })
    const view = await app.request.get(`/api/orders/${res.body.code}`).query({ token: res.body.token })
    expect(view.body).toMatchObject({
      kind: 'preorder',
      voucherCode: 'TET2027',
      discount: DISCOUNT,
      total: TOTAL,
      preorder: { depositAmount: DEPOSIT, remainingAmount: REMAINING },
    })
  })

  it('tiền giảm khác số khách thấy, mã hết lượt hay khách đã dùng thì 409 kèm details.voucher và không ghi gì', async () => {
    const app = await voucherPreorderShop()
    await app.voucher({ perCustomerLimit: 1 })
    await app.voucher({ code: 'MOTLUOT', totalLimit: 1, perCustomerLimit: 5 })
    expect((await app.withVoucher()).status).toBe(201)
    expect(
      (
        await app.withVoucher({
          voucherCode: 'MOTLUOT',
          address: { ...ADDRESS, email: 'khach1@example.com', phone: '0910000001' },
        })
      ).status,
    ).toBe(201)
    const orderCount = async () =>
      (
        await app.request
          .get('/api/admin/orders')
          .query({ status: 'all', paymentStatus: 'all', fulfillmentStatus: 'all' })
          .set(bearer(app.token))
      ).body.total as number
    const before = await orderCount()

    const changed = await app.withVoucher({
      discount: 100_000,
      address: { ...ADDRESS, email: 'khach2@example.com', phone: '0910000002' },
    })
    expect(changed.status).toBe(409)
    expect(changed.body.error.details).toEqual({
      voucher: {
        code: 'TET2027',
        reason: 'changed',
        discount: DISCOUNT,
        totalWithoutVoucher: 2_130_000,
        depositAmountWithoutVoucher: 630_000,
      },
    })
    expect((await app.withVoucher()).body.error.details.voucher.reason).toBe('customer_limit')
    expect(
      (
        await app.withVoucher({
          voucherCode: 'MOTLUOT',
          address: { ...ADDRESS, email: 'khach3@example.com', phone: '0910000003' },
        })
      ).body.error.details.voucher.reason,
    ).toBe('exhausted')
    expect(await orderCount()).toBe(before)
  })

  it('đổi giá thì 409 theo thay đổi của biến thể, chưa xét tới mã', async () => {
    const app = await voucherPreorderShop()
    await app.voucher()
    await app.editVariant(app.v41, 'AM-41', '41', { price: 2_200_000 })
    const res = await app.withVoucher()
    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual({ change: { kind: 'price', from: 2_100_000, to: 2_200_000 } })
  })

  it('cọc đúng số sau giảm; mã hết hạn và bị tắt trước khi trả phần còn lại vẫn giữ phần giảm', async () => {
    const app = await voucherPreorderShop()
    const { id } = await app.voucher()
    const res = await app.withVoucher()
    const { code, token } = res.body as { code: number; token: string }
    const order = (query: Record<string, string> = {}) =>
      app.request.get(`/api/orders/${code}`).query({ token, ...query })

    app.payments.payments.set(`${code}-deposit-1`, paid([DEPOSIT, `FT-DEP-${code}`]))
    expect((await order({ refresh: '1' })).body.paymentStatus).toBe('deposit_paid')
    const depositMail = await vi.waitFor(
      () => {
        const mail = app.mailer.sent.find((m) => m.subject.includes(`cọc đơn đặt trước #${code}`))
        if (!mail) throw new Error('Chưa có thư')
        return mail
      },
      { timeout: 10_000, interval: 100 },
    )
    expect(depositMail.text).toContain('Mã giảm giá TET2027: -210.000 ₫')
    expect(depositMail.text).toContain('Phần còn lại (gồm phí giao): 1.353.000 ₫')

    await app.request
      .patch(`/api/admin/vouchers/${id}`)
      .set(bearer(app.token))
      .send({ endsAt: at(-0.5) })
    await app.request.post(`/api/admin/vouchers/${id}/disable`).set(bearer(app.token))
    const receipt = await app.request
      .post('/api/admin/stock/receipts')
      .set(bearer(app.token))
      .send({ supplierName: 'Nike VN', receivedOn: '2026-12-01', note: '', lines: [{ sku: 'AM-41', quantity: 1 }] })
    expect(receipt.status).toBe(201)

    const link = await app.request.post(`/api/orders/${code}/pay-remainder`).query({ token })
    expect(link.status).toBe(200)
    expect(app.payments.created.at(-1)).toMatchObject({ orderCode: code, amount: REMAINING })
    app.payments.payments.set(`${code}-remainder-1`, paid([REMAINING, `FT-REM-${code}`]))
    expect((await order({ refresh: '1' })).body).toMatchObject({
      paymentStatus: 'paid',
      discount: DISCOUNT,
      total: TOTAL,
    })
  })
})
