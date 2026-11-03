import type { Response } from 'supertest'
import { describe, expect, it } from 'vitest'
import { bearer } from './support/staff.ts'
import { register } from './support/customer.ts'
import { ADDRESS, shop } from './support/shop.ts'

describe('đồng ý chính sách bảo mật khi đặt mua', () => {
  it('khách vãng lai không tick đồng ý thì 400 theo trường, không có đơn', async () => {
    const { checkout, payments } = await shop()

    const missing = await checkout({ acceptPrivacyPolicy: undefined })
    const refused = await checkout({ acceptPrivacyPolicy: false })

    for (const res of [missing, refused]) {
      expect(res.status).toBe(400)
      expect(res.body.error.fields).toEqual([
        { path: 'acceptPrivacyPolicy', message: 'Cần đồng ý với chính sách bảo mật để đặt mua' },
      ])
    }
    expect(payments.created).toEqual([])
  })

  it('khách vãng lai đồng ý thì đơn ghi phiên bản chính sách bảo mật đang hiện hành', async () => {
    const { request, checkout } = await shop()

    const placed = await checkout()

    expect(placed.status).toBe(201)
    const order = await request.get(`/api/orders/${placed.body.code}`).query({ token: placed.body.token })
    expect(order.body.privacyConsent).toEqual({ policyVersion: 1, consentedAt: order.body.createdAt })
  })

  it('khách đã đăng nhập không cần tick lại: đơn gắn với tài khoản, không ghi đồng ý mới trên đơn', async () => {
    const { request, prisma, checkout } = await shop()
    const signedUp = await register(request)
    expect(signedUp.status).toBe(201)

    const placed = await checkout({ acceptPrivacyPolicy: undefined }).set(bearer(signedUp.body.accessToken))

    expect(placed.status).toBe(201)
    const order = await request.get(`/api/orders/${placed.body.code}`).query({ token: placed.body.token })
    expect(order.body.privacyConsent).toBeNull()
    // Chưa có API đơn trong tài khoản (ticket 11), nên đọc customer_id bằng prisma.
    const stored = await prisma.order.findUniqueOrThrow({ where: { code: placed.body.code } })
    const customer = await prisma.customer.findFirstOrThrow()
    expect(stored.customerId).toBe(customer.id)
  })

  it('token đăng nhập không hợp lệ thì 401, không coi như khách vãng lai', async () => {
    const { checkout } = await shop()

    const res = await checkout().set(bearer('khong-hop-le'))

    expect(res.status).toBe(401)
  })
})

describe('xuất hóa đơn công ty', () => {
  const INVOICE = { companyName: 'Công ty TNHH An Bình', taxCode: '0101234567', address: '1 Tràng Tiền, Hà Nội' }

  it('đơn lưu thông tin hóa đơn như lúc đặt; không nhập thì không có hóa đơn công ty', async () => {
    const { request, checkout } = await shop()

    const withInvoice = await checkout({ invoice: { ...INVOICE, taxCode: '0101234567-001' } })
    const without = await checkout()

    expect(withInvoice.status).toBe(201)
    const order = await request.get(`/api/orders/${withInvoice.body.code}`).query({ token: withInvoice.body.token })
    expect(order.body.invoice).toEqual({ ...INVOICE, taxCode: '0101234567-001' })
    const plain = await request.get(`/api/orders/${without.body.code}`).query({ token: without.body.token })
    expect(plain.body.invoice).toBeNull()
  })

  it('thiếu trường hay mã số thuế sai dạng thì 400 theo từng trường, không có đơn', async () => {
    const { checkout, payments } = await shop()

    const missing = await checkout({ invoice: { companyName: ' ', taxCode: '0101234567', address: '' } })
    const badTaxCodes = await Promise.all(
      ['010123456', '0101234567001', '0101234567-01', 'MST0101234'].map((taxCode) =>
        checkout({ invoice: { ...INVOICE, taxCode } }),
      ),
    )

    expect(missing.status).toBe(400)
    expect(missing.body.error.fields).toEqual([
      { path: 'invoice.companyName', message: 'Cần tên công ty' },
      { path: 'invoice.address', message: 'Cần địa chỉ xuất hóa đơn' },
    ])
    for (const res of badTaxCodes) {
      expect(res.status).toBe(400)
      expect(res.body.error.fields).toEqual([
        { path: 'invoice.taxCode', message: 'Mã số thuế gồm 10 số, hoặc 13 số dạng 0101234567-001' },
      ])
    }
    expect(payments.created).toEqual([])
  })
})

describe('giới hạn tần suất đặt mua', () => {
  function expectRateLimited(res: Response, message: RegExp) {
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
    expect(res.body.error.message).toMatch(message)
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
  }

  it('quá 5 lần đặt mua trong một giờ từ một IP thì 429; IP khác vẫn đặt được', async () => {
    const { checkout, v40 } = await shop()
    // Giá cũ: mỗi lần đều 409 và không giữ hàng, nhưng vẫn tính là một lần đặt mua.
    const stale = { lines: [{ variantId: v40.id, quantity: 1, price: 1_000_000 }] }
    for (let i = 0; i < 5; i++) expect((await checkout(stale).set('X-Forwarded-For', '203.0.113.1')).status).toBe(409)

    const blocked = await checkout().set('X-Forwarded-For', '203.0.113.1')
    const otherIp = await checkout().set('X-Forwarded-For', '203.0.113.2')

    expectRateLimited(blocked, /quá nhiều lần/)
    expect(otherIp.status).toBe(201)
  })

  /** Đặt mua mỗi lần từ một IP khác, để chỉ giới hạn theo email và số điện thoại có tác dụng. */
  async function shopWithStock() {
    const app = await shop()
    const more = await app.request
      .post('/api/admin/stock/adjustments')
      .set(bearer(app.token))
      .send({ variantId: app.v40.id, reason: 'stocktake', countedQuantity: 20, expectedOnHand: 3 })
    expect(more.status).toBe(201)
    let ip = 0
    const place = (address: Record<string, unknown> = {}) =>
      app.checkout({ address: { ...ADDRESS, ...address } }).set('X-Forwarded-For', `198.51.100.${++ip}`)
    return { ...app, place }
  }

  it('email đã có 3 đơn chờ thanh toán thì đơn thứ tư 429, kể cả khác hoa thường; email khác vẫn đặt được', async () => {
    const { place } = await shopWithStock()
    for (let i = 0; i < 3; i++) expect((await place({ phone: `091000000${i}` })).status).toBe(201)

    const fourth = await place({ email: 'AN@example.COM', phone: '0910000009' })
    const otherEmail = await place({ email: 'binh@example.com', phone: '0910000008' })

    expectRateLimited(fourth, /3 đơn đang chờ thanh toán/)
    expect(fourth.body.error.fields).toEqual([{ path: 'address.email', message: expect.any(String) }])
    expect(otherEmail.status).toBe(201)
  })

  it('số điện thoại đã có 3 đơn chờ thanh toán thì đơn thứ tư 429, kể cả viết dạng +84', async () => {
    const { place } = await shopWithStock()
    for (let i = 0; i < 3; i++) expect((await place({ email: `khach${i}@example.com` })).status).toBe(201)

    const fourth = await place({ email: 'khach9@example.com', phone: '+84 912 345 678' })

    expectRateLimited(fourth, /3 đơn đang chờ thanh toán/)
    expect(fourth.body.error.fields).toEqual([{ path: 'address.phone', message: expect.any(String) }])
  })

  it('đơn chờ được thanh toán hoặc hết hạn giữ hàng thì không còn tính, đặt được lại', async () => {
    const { prisma, place } = await shopWithStock()
    const placed = []
    for (let i = 0; i < 3; i++) placed.push(await place())
    expect((await place()).status).toBe(429)

    // Thanh toán (ticket 05) và hết hạn (ticket 06) chưa có đường HTTP trên nhánh này, nên dựng trạng thái bằng prisma.
    await prisma.order.update({
      where: { code: placed[0]!.body.code },
      data: { status: 'processing', paymentStatus: 'paid', reservedUntil: null },
    })
    const afterPaid = await place()
    await prisma.order.update({
      where: { code: placed[1]!.body.code },
      data: { reservedUntil: new Date(Date.now() - 1_000) },
    })
    const afterExpired = await place()

    expect(afterPaid.status).toBe(201)
    expect(afterExpired.status).toBe(201)
    expect((await place()).status).toBe(429)
  })
})

describe('chính sách áp dụng cho các món ở trang đặt mua', () => {
  it('báo giá trả link chính sách đổi trả, bảo hành của các sản phẩm trong giỏ, theo phiên bản đang xuất bản', async () => {
    const { request, token, policy, v40, v41 } = await shop()
    const edit = await request
      .put(`/api/admin/pages/${policy.id}`)
      .set(bearer(token))
      .send({ title: 'Đổi trả trong 7 ngày', body: 'Đổi trong 7 ngày' })
    expect(edit.status).toBe(200)

    const draftEdited = await request.post('/api/checkout/quote').send({
      lines: [
        { variantId: v40.id, quantity: 1 },
        { variantId: v41.id, quantity: 1 },
      ],
    })
    expect((await request.post(`/api/admin/pages/${policy.id}/publish`).set(bearer(token))).status).toBe(200)
    const republished = await request.post('/api/checkout/quote').send({ lines: [{ variantId: v40.id, quantity: 1 }] })

    expect(draftEdited.body.policies).toEqual([{ slug: 'doi-tra', title: 'Đổi trả' }])
    expect(republished.body.policies).toEqual([{ slug: 'doi-tra', title: 'Đổi trả trong 7 ngày' }])
  })
})
