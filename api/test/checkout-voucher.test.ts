import { describe, expect, it, vi } from 'vitest'
import { ADDRESS, HA_NOI, shop } from './support/shop.ts'
import { bearer } from './support/staff.ts'
import { ipnParams, signedIpn } from './support/vnpay.ts'

const DAY = 24 * 60 * 60_000
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString()

/**
 * Cửa hàng của `shop()` (AM-40 giá 2.000.000 còn 3 đôi, phí giao 30.000) và mã `TET2027` giảm 10% tối đa 500.000 cho
 * mọi hình thức bán, 1 lượt mỗi khách; `voucher` tạo thêm mã khác qua API quản trị.
 */
async function voucherShop() {
  const app = await shop()
  const { request, token, v40 } = app
  const voucher = async (overrides: Record<string, unknown> = {}) => {
    const res = await request
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
        ...overrides,
      })
    expect(res.status).toBe(201)
    return res.body as { id: string; code: string }
  }
  const quote = (body: Record<string, unknown> = {}) =>
    request.post('/api/checkout/quote').send({
      lines: [{ variantId: v40.id, quantity: 1 }],
      provinceCode: HA_NOI,
      voucherCode: 'tet2027',
      ...body,
    })
  /** Khách đặt 1 đôi AM-40 kèm mã, mặc định với tiền giảm 200.000 như báo giá. */
  const order = (body: Record<string, unknown> = {}) =>
    app.checkout({ voucherCode: 'tet2027', discount: 200_000, ...body })
  const view = (res: { body: { code: number; token: string } }) =>
    request.get(`/api/orders/${res.body.code}`).query({ token: res.body.token })
  const orderCount = async () => (await app.prisma.order.count()) as number
  return { ...app, voucher, quote, order, view, orderCount }
}

/** Khách khác: email và số điện thoại khác `ADDRESS`. */
const otherCustomer = (n: number) => ({
  address: { ...ADDRESS, email: `khach${n}@example.com`, phone: `091000000${n}` },
})

describe('báo giá kèm mã giảm giá', () => {
  it('áp mã: trả tiền giảm từng dòng, phí giao và tổng sau giảm, cùng tổng khi không có mã; không ghi gì', async () => {
    const app = await voucherShop()
    await app.voucher()

    const res = await app.quote()

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      subtotal: 2_000_000,
      voucher: {
        applied: true,
        code: 'TET2027',
        discount: 200_000,
        lines: [{ variantId: app.v40.id, discount: 200_000 }],
      },
      discount: 200_000,
      shippingFee: 30_000,
      total: 1_830_000,
      shippingFeeWithoutVoucher: 30_000,
      totalWithoutVoucher: 2_030_000,
    })
    expect(await app.orderCount()).toBe(0)
  })

  it('không gửi mã thì không có kết quả mã và tiền giảm bằng 0', async () => {
    const app = await voucherShop()
    const res = await app.quote({ voucherCode: undefined })
    expect(res.body).toMatchObject({ voucher: null, discount: 0, total: 2_030_000, totalWithoutVoucher: 2_030_000 })
  })

  it('ngưỡng miễn phí giao so với tiền hàng sau giảm', async () => {
    const app = await voucherShop()
    await app.voucher()
    const fees = await app.request
      .put('/api/admin/shipping-fees')
      .set(bearer(app.token))
      .send({ defaultFee: 30_000, freeShippingThreshold: 2_000_000, provinceFees: [] })
    expect(fees.status).toBe(200)

    const res = await app.quote()

    expect(res.body).toMatchObject({
      discount: 200_000,
      shippingFee: 30_000,
      total: 1_830_000,
      shippingFeeWithoutVoucher: 0,
      totalWithoutVoucher: 2_000_000,
    })
  })

  it('báo đúng lý do khi mã không dùng được', async () => {
    const app = await voucherShop()
    const adidas = await app.request
      .post('/api/admin/brands')
      .set(bearer(app.token))
      .send({ name: 'Adidas', slug: 'adidas' })
    const disabled = await app.voucher({ code: 'TAT2026' })
    await app.request.post(`/api/admin/vouchers/${disabled.id}/disable`).set(bearer(app.token))
    await app.voucher({ code: 'SAP2027', startsAt: at(5), endsAt: at(10) })
    await app.voucher({ code: 'CU2026', startsAt: at(-10), endsAt: at(-5) })
    await app.voucher({ code: 'DATTRUOC', saleTypes: ['preorder'] })
    await app.voucher({ code: 'TOITHIEU', minSubtotal: 2_500_000 })
    await app.voucher({ code: 'ADIDAS', brandIds: [adidas.body.id] })

    const reasonOf = async (voucherCode: string) => (await app.quote({ voucherCode })).body.voucher
    expect(await reasonOf('khongco')).toEqual({ applied: false, code: 'KHONGCO', reason: 'not_found' })
    expect(await reasonOf('TAT2026')).toMatchObject({ applied: false, reason: 'disabled' })
    expect(await reasonOf('SAP2027')).toMatchObject({ applied: false, reason: 'not_started' })
    expect(await reasonOf('CU2026')).toMatchObject({ applied: false, reason: 'expired' })
    expect(await reasonOf('DATTRUOC')).toMatchObject({ applied: false, reason: 'sale_type' })
    expect(await reasonOf('TOITHIEU')).toEqual({
      applied: false,
      code: 'TOITHIEU',
      reason: 'below_minimum',
      shortfall: 500_000,
    })
    expect(await reasonOf('ADIDAS')).toMatchObject({ applied: false, reason: 'not_applicable' })
    // Mã không áp được thì báo giá như không có mã.
    expect((await app.quote({ voucherCode: 'CU2026' })).body).toMatchObject({ discount: 0, total: 2_030_000 })
  })

  it('hết tổng lượt thì exhausted; lượt mỗi khách chỉ kiểm khi có email hoặc số điện thoại', async () => {
    const app = await voucherShop()
    await app.voucher({ code: 'MOTLUOT', totalLimit: 1, perCustomerLimit: 1 })
    await app.voucher()
    expect((await app.order({ voucherCode: 'MOTLUOT' })).status).toBe(201)
    expect((await app.order()).status).toBe(201)

    expect((await app.quote({ voucherCode: 'MOTLUOT' })).body.voucher).toMatchObject({ reason: 'exhausted' })
    expect((await app.quote()).body.voucher).toMatchObject({ applied: true })
    expect((await app.quote({ email: 'AN@example.com' })).body.voucher).toMatchObject({ reason: 'customer_limit' })
    expect((await app.quote({ phone: '0912 345 678' })).body.voucher).toMatchObject({ reason: 'customer_limit' })
    expect((await app.quote({ email: 'khac@example.com', phone: '0900000000' })).body.voucher).toMatchObject({
      applied: true,
    })
    // Email, số điện thoại chưa nhập xong không làm báo giá lỗi.
    expect((await app.quote({ email: 'an@', phone: '09' })).status).toBe(200)
  })

  it('báo giá kèm mã quá 10 lần mỗi phút từ một IP thì 429; báo giá không mã thì không bị tính', async () => {
    const app = await voucherShop()
    await app.voucher()
    for (let i = 0; i < 10; i++) expect((await app.quote()).status).toBe(200)
    expect((await app.quote()).status).toBe(429)
    expect((await app.quote({ voucherCode: undefined })).status).toBe(200)
  })
})

describe('đặt mua kèm mã giảm giá', () => {
  it('chụp mã và tiền giảm vào đơn; link thanh toán và tổng tính sau giảm', async () => {
    const app = await voucherShop()
    const { id } = await app.voucher()

    const res = await app.order()

    expect(res.status).toBe(201)
    expect(app.payments.created).toEqual([expect.objectContaining({ orderCode: res.body.code, amount: 1_830_000 })])
    const view = await app.view(res)
    expect(view.body).toMatchObject({
      subtotal: 2_000_000,
      voucherCode: 'TET2027',
      discount: 200_000,
      shippingFee: 30_000,
      total: 1_830_000,
    })
    const stored = await app.prisma.order.findUniqueOrThrow({
      where: { code: res.body.code },
      include: { lines: true },
    })
    expect(stored).toMatchObject({
      voucherId: id,
      voucherKind: 'percent',
      voucherPercent: 10,
      voucherMaxDiscount: 500_000n,
      voucherAmount: null,
    })
    expect(stored.lines.map((l) => l.discount)).toEqual([200_000n])
    expect((await app.request.get(`/api/admin/vouchers/${id}`).set(bearer(app.token))).body.used).toBe(1)
  })

  it('sửa hay tắt mã sau khi đặt không đổi đơn', async () => {
    const app = await voucherShop()
    const { id } = await app.voucher()
    const res = await app.order()
    await app.request
      .patch(`/api/admin/vouchers/${id}`)
      .set(bearer(app.token))
      .send({ endsAt: at(1) })
    await app.request.post(`/api/admin/vouchers/${id}/disable`).set(bearer(app.token))
    expect((await app.view(res)).body).toMatchObject({ voucherCode: 'TET2027', discount: 200_000, total: 1_830_000 })
  })

  it('mã hết hạn, hết lượt, hay tiền giảm khác số khách thấy thì 409 và không ghi gì', async () => {
    const app = await voucherShop()
    await app.voucher()
    await app.voucher({ code: 'CU2026', startsAt: at(-10), endsAt: at(-5) })
    await app.voucher({ code: 'MOTLUOT', totalLimit: 1, perCustomerLimit: 5 })
    expect((await app.order({ voucherCode: 'MOTLUOT', ...otherCustomer(1) })).status).toBe(201)
    expect((await app.order(otherCustomer(2))).status).toBe(201)
    const before = await app.orderCount()

    const changed = await app.order({ discount: 150_000 })
    expect(changed.status).toBe(409)
    expect(changed.body.error.details).toEqual({
      lines: [],
      voucher: { code: 'TET2027', reason: 'changed', discount: 200_000, totalWithoutVoucher: 2_030_000 },
    })
    expect((await app.order({ voucherCode: 'CU2026' })).body.error.details.voucher).toMatchObject({
      reason: 'expired',
      discount: null,
    })
    expect((await app.order({ voucherCode: 'MOTLUOT' })).body.error.details.voucher.reason).toBe('exhausted')
    expect(await app.orderCount()).toBe(before)
    // Đặt mua giới hạn 5 lần mỗi giờ theo IP (M3); các trường hợp còn lại ở test sau.
  })

  it('cùng số điện thoại là cùng một khách; mã tắt sau khi khách áp thì 409', async () => {
    const app = await voucherShop()
    const tet = await app.voucher()
    expect((await app.order(otherCustomer(2))).status).toBe(201)

    const same = await app.order({ address: { ...ADDRESS, email: 'moi@example.com', phone: '0910000002' } })
    expect(same.body.error.details.voucher.reason).toBe('customer_limit')
    await app.request.post(`/api/admin/vouchers/${tet.id}/disable`).set(bearer(app.token))
    expect((await app.order()).body.error.details.voucher.reason).toBe('disabled')
    expect(await app.orderCount()).toBe(1)
  })

  it('giá đổi thì 409 theo dòng, chưa xét tới mã', async () => {
    const app = await voucherShop()
    await app.voucher()
    await app.editVariant(app.v40, 'AM-40', '40', { price: 2_200_000 })
    const res = await app.order()
    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual({
      lines: [{ variantId: app.v40.id, change: { kind: 'price', from: 2_000_000, to: 2_200_000 } }],
    })
  })

  it('hai khách tranh lượt cuối cùng lúc thì đúng một đơn có mã', async () => {
    const app = await voucherShop()
    await app.voucher({ totalLimit: 1 })

    const results = await Promise.all([app.order(otherCustomer(1)), app.order(otherCustomer(2))])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await app.prisma.order.count({ where: { voucherCode: 'TET2027' } })).toBe(1)
  })

  it('hủy đơn chưa thanh toán thì trả lại lượt', async () => {
    const app = await voucherShop()
    await app.voucher()
    const first = await app.order()
    expect((await app.order()).body.error.details.voucher.reason).toBe('customer_limit')

    const cancel = await app.request.post(`/api/orders/${first.body.code}/cancel`).query({ token: first.body.token })
    expect(cancel.status).toBe(200)

    expect((await app.order()).status).toBe(201)
  })

  it('IPN đúng số tiền sau giảm thì đã trả đủ; IPN lặp không đổi tiền giảm; email có dòng mã giảm giá', async () => {
    const app = await voucherShop()
    await app.voucher()
    const res = await app.order()
    const ipn = () => app.request.get('/api/payments/vnpay/ipn').query(signedIpn(ipnParams(res.body.code, 1_830_000)))

    expect((await ipn()).body.RspCode).toBe('00')
    expect((await ipn()).status).toBe(200)

    expect((await app.view(res)).body).toMatchObject({ paymentStatus: 'paid', discount: 200_000, total: 1_830_000 })
    const mail = await vi.waitFor(
      () => {
        const found = app.mailer.sent.find((m) => m.subject.includes(`#${res.body.code}`))
        if (!found) throw new Error('Chưa có thư')
        return found
      },
      { timeout: 10_000, interval: 100 },
    )
    expect(mail.text).toContain('Mã giảm giá TET2027: -200.000 ₫')
    expect(mail.text).toContain('Tổng cộng: 1.830.000 ₫')
  })
})
