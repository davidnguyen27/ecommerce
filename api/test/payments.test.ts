import { describe, expect, it, vi } from 'vitest'
import type { InMemoryMailer } from '../src/adapters/mailer.ts'
import type { PaymentInfo } from '../src/payments/gateway.ts'
import { ipnParams, signedIpn, transactionNoOf } from './support/vnpay.ts'
import { shop } from './support/shop.ts'
import { bearer } from './support/staff.ts'

const TOTAL = 2_030_000

/** Chờ thư "đã nhận thanh toán" của đơn qua hàng đợi job. */
async function paymentMails(mailer: InMemoryMailer, code: number, count = 1) {
  return vi.waitFor(
    () => {
      const mails = mailer.sent.filter((m) => m.subject.includes(`#${code}`))
      if (mails.length < count) throw new Error('Chưa có thư')
      return mails
    },
    { timeout: 10_000, interval: 100 },
  )
}

type App = Awaited<ReturnType<typeof shop>>

/** Giao dịch thanh toán của đơn, đọc ở chi tiết đơn trang quản trị. */
async function transactions({ request, token }: App, code: number) {
  const res = await request.get(`/api/admin/orders/${code}`).set(bearer(token))
  expect(res.status).toBe(200)
  return res.body.payments as { amount: number; reference: string; source: string }[]
}

/** Mọi mục cần đối soát, cũ trước. */
async function reconciliation({ request, token }: App) {
  const res = await request.get('/api/admin/reconciliation').query({ status: 'all' }).set(bearer(token))
  expect(res.status).toBe(200)
  return (res.body.items as { reason: string; amount: number; receivedAt: string; status: string }[]).map(
    ({ reason, amount, receivedAt, status }) => ({ reason, amount, receivedAt, status }),
  )
}

/** Cổng trả lời truy vấn: đơn đã nhận một khoản. */
const paidInfo = (amount: number, reference: string): PaymentInfo => ({
  status: 'paid',
  transactions: [{ reference, amount, paidAt: new Date('2026-11-02T03:20:00Z') }],
})

/** Cửa hàng đã có một đơn AM-40 chờ thanh toán, tổng 2.030.000. */
async function pendingOrder() {
  const app = await shop()
  const res = await app.checkout()
  expect(res.status).toBe(201)
  const { code, token } = res.body as { code: number; token: string }
  const order = () => app.request.get(`/api/orders/${code}`).query({ token })
  const ipn = (query: Record<string, string>) => app.request.get('/api/payments/vnpay/ipn').query(query)
  const transactionCount = async () => (await transactions(app, code)).length
  return {
    ...app,
    adminToken: app.token,
    code,
    token,
    order,
    ipn,
    transactionCount,
    reconciliation: () => reconciliation(app),
  }
}

describe('ghi nhận thanh toán qua IPN', () => {
  it('IPN đúng chữ ký, đúng tiền: trả 00, đơn thành đã trả đủ, hết hạn giữ hàng và khách nhận email một lần', async () => {
    const { code, order, ipn, mailer, request } = await pendingOrder()

    const res = await ipn(signedIpn(ipnParams(code, TOTAL)))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ RspCode: '00', Message: 'Confirm Success' })
    const after = await order()
    expect(after.body).toMatchObject({
      status: 'processing',
      paymentStatus: 'paid',
      fulfillmentStatus: 'not_prepared',
      reservedUntil: null,
    })
    const [mail] = await paymentMails(mailer, code)
    expect(mail).toMatchObject({ to: 'an@example.com', subject: `Đã nhận thanh toán đơn hàng #${code}` })
    expect(mail!.text).toContain('Air Max')
    expect(mail!.text).toContain('2.030.000')
    // Link trong thư mở được đơn bằng token mới cấp cho thư.
    const link = /https:\/\/shop\.test\/don-hang\/(\d+)\?token=([\w-]+)/.exec(mail!.text)
    expect(link?.[1]).toBe(String(code))
    const viaMail = await request.get(`/api/orders/${code}`).query({ token: link![2] })
    expect(viaMail.status).toBe(200)
  })

  it('sai chữ ký thì trả 97 và không ghi gì', async () => {
    const { code, order, ipn, transactionCount } = await pendingOrder()
    const signed = signedIpn(ipnParams(code, TOTAL))

    const tampered = await ipn({ ...signed, vnp_Amount: '100' })
    const otherKey = await ipn(signedIpn(ipnParams(code, TOTAL), 'khoa-khac'))
    const { vnp_SecureHash: _, ...unsigned } = signed
    const unsignedRes = await ipn(unsigned)
    const notHex = await ipn({ ...signed, vnp_SecureHash: 'z'.repeat(128) })

    for (const res of [tampered, otherKey, unsignedRes, notHex]) {
      expect(res.status).toBe(200)
      expect(res.body.RspCode).toBe('97')
    }
    expect((await order()).body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
    expect(await transactionCount()).toBe(0)
  })

  it('cùng một IPN gửi hai lần: lần hai trả 02, chỉ ghi một giao dịch và gửi một email', async () => {
    const { code, order, ipn, transactionCount, mailer } = await pendingOrder()
    const signed = signedIpn(ipnParams(code, TOTAL))

    const first = await ipn(signed)
    const second = await ipn(signed)

    expect(first.body.RspCode).toBe('00')
    expect(second.body).toEqual({ RspCode: '02', Message: 'Order already confirmed' })
    expect((await order()).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    expect(await transactionCount()).toBe(1)
    await paymentMails(mailer, code)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(await paymentMails(mailer, code)).toHaveLength(1)
  })

  it('giao dịch không thành công (khách hủy, thẻ lỗi) thì trả 00 để VNPAY thôi gửi, đơn vẫn chờ thanh toán', async () => {
    const { code, order, ipn, transactionCount } = await pendingOrder()

    const cancelled = await ipn(
      signedIpn(ipnParams(code, TOTAL, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' })),
    )
    // Mẫu PHP của VNPAY chỉ xét một mã; hệ thống đòi cả hai mã là 00.
    const halfOk = await ipn(signedIpn(ipnParams(code, TOTAL, { vnp_TransactionStatus: '01' })))

    for (const res of [cancelled, halfOk]) expect(res.body.RspCode).toBe('00')
    expect((await order()).body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
    expect(await transactionCount()).toBe(0)
  })

  it('IPN cho mã đơn không có hay vnp_TxnRef lạ thì trả 01, không ghi gì', async () => {
    const { ipn, transactionCount } = await pendingOrder()

    const unknown = await ipn(signedIpn(ipnParams(123, 3_000)))
    const foreign = await ipn(signedIpn(ipnParams(123, 3_000, { vnp_TxnRef: 'khac' })))

    for (const res of [unknown, foreign]) expect(res.body).toEqual({ RspCode: '01', Message: 'Order not found' })
    expect(await transactionCount()).toBe(0)
  })

  it('đúng chữ ký mà thiếu trường cần dùng thì trả 01, không ghi gì', async () => {
    const { code, ipn, transactionCount } = await pendingOrder()
    const { vnp_TransactionNo: _, ...params } = ipnParams(code, TOTAL)

    const res = await ipn(signedIpn(params))

    expect(res.body.RspCode).toBe('01')
    expect(await transactionCount()).toBe(0)
  })
})

describe('ghi nhận thanh toán khi khách quay về', () => {
  it('refresh=1 hỏi cổng và ghi nhận được khi chưa có IPN', async () => {
    const { code, order, payments, token, request } = await pendingOrder()
    payments.payments.set(String(code), paidInfo(TOTAL, 'FT-Q1'))

    const plain = await order()
    const refreshed = await request.get(`/api/orders/${code}`).query({ token, refresh: '1' })

    expect(plain.body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
    expect(refreshed.status).toBe(200)
    expect(refreshed.body).toMatchObject({ status: 'processing', paymentStatus: 'paid', reservedUntil: null })
  })

  it('refresh=1 khi cổng lỗi vẫn trả đơn như hiện có', async () => {
    const { code, payments, token, request } = await pendingOrder()
    payments.failGetPayment = true

    const res = await request.get(`/api/orders/${code}`).query({ token, refresh: '1' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
  })

  it('refresh=1 với token sai là 404 và không hỏi cổng', async () => {
    const { code, payments, request, transactionCount } = await pendingOrder()
    payments.payments.set(String(code), paidInfo(TOTAL, 'FT-Q1'))

    const res = await request.get(`/api/orders/${code}`).query({ token: 'sai', refresh: '1' })

    expect(res.status).toBe(404)
    expect(await transactionCount()).toBe(0)
  })

  it('IPN và truy vấn cùng về một khoản: chỉ ghi một lần, email một lần', async () => {
    const { code, order, ipn, payments, token, request, transactionCount, mailer } = await pendingOrder()
    payments.payments.set(String(code), paidInfo(TOTAL, transactionNoOf(code)))

    const [hook, query] = await Promise.all([
      ipn(signedIpn(ipnParams(code, TOTAL))),
      request.get(`/api/orders/${code}`).query({ token, refresh: '1' }),
    ])

    expect(hook.status).toBe(200)
    expect(query.status).toBe(200)
    expect((await order()).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    expect(await transactionCount()).toBe(1)
    await paymentMails(mailer, code)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(await paymentMails(mailer, code)).toHaveLength(1)
  })
})

describe('cần đối soát', () => {
  it('lệch tiền: gắn cờ amount_mismatch, đơn vẫn chưa thanh toán', async () => {
    const { code, order, ipn, reconciliation } = await pendingOrder()

    const res = await ipn(signedIpn(ipnParams(code, 2_000_000)))

    expect(res.status).toBe(200)
    expect((await order()).body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
    expect(await reconciliation()).toEqual([
      { reason: 'amount_mismatch', amount: 2_000_000, receivedAt: '2026-11-02T03:15:30.000Z', status: 'open' },
    ])
  })

  it('trả thiếu rồi chuyển nốt phần còn lại: đơn đã trả đủ, mục lệch tiền tự đóng vì đã đủ tiền', async () => {
    const { code, order, ipn, reconciliation, request, adminToken } = await pendingOrder()
    await ipn(signedIpn(ipnParams(code, 2_000_000)))

    const res = await ipn(signedIpn(ipnParams(code, 30_000, { vnp_TransactionNo: '1' })))

    expect(res.status).toBe(200)
    expect((await order()).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    expect(await reconciliation()).toEqual([expect.objectContaining({ reason: 'amount_mismatch', status: 'resolved' })])
    const open = await request.get('/api/admin/reconciliation').set(bearer(adminToken))
    expect(open.body.total).toBe(0)
    const detail = await request.get(`/api/admin/orders/${code}`).set(bearer(adminToken))
    expect(detail.body.payments[0].reconciliation).toMatchObject({
      status: 'resolved',
      resolution: 'settled_by_payment',
      resolvedBy: null,
      resolvedAt: expect.any(String),
    })
    expect(detail.body.history.at(-1)).toMatchObject({
      action: 'paid',
      actor: { type: 'system' },
      data: { amount: 30_000, settledReconciliationItemIds: [detail.body.payments[0].reconciliation.id] },
    })
  })

  it('tiền về thêm cho đơn đã trả: gắn cờ extra_payment, đơn giữ nguyên đã trả', async () => {
    const { code, order, ipn, reconciliation } = await pendingOrder()
    await ipn(signedIpn(ipnParams(code, TOTAL)))

    const res = await ipn(signedIpn(ipnParams(code, 50_000, { vnp_TransactionNo: '2' })))

    expect(res.status).toBe(200)
    expect((await order()).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    expect(await reconciliation()).toEqual([expect.objectContaining({ reason: 'extra_payment', amount: 50_000 })])
  })

  it('tiền về cho đơn đã hủy: gắn cờ paid_after_cancel, đơn vẫn hủy', async () => {
    const { code, token, order, ipn, reconciliation, request } = await pendingOrder()
    expect((await request.post(`/api/orders/${code}/cancel`).query({ token })).status).toBe(200)

    const res = await ipn(signedIpn(ipnParams(code, TOTAL)))

    expect(res.status).toBe(200)
    expect((await order()).body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'customer',
      paymentStatus: 'unpaid',
    })
    expect(await reconciliation()).toEqual([expect.objectContaining({ reason: 'paid_after_cancel' })])
  })
})

describe('cổng giả lập', () => {
  it('nút "Giả lập đã thanh toán" ghi nhận qua cùng hàm: đúng tiền thì đã trả, số khác thì cần đối soát', async () => {
    const app = await shop({ simulator: true })
    const first = await app.checkout()
    const second = await app.checkout()
    expect(app.payments.created).toHaveLength(0)

    const exact = await app.request
      .post('/api/payments/simulator/paid')
      .send({ orderCode: first.body.code, amount: TOTAL })
    const less = await app.request
      .post('/api/payments/simulator/paid')
      .send({ orderCode: second.body.code, amount: 1_000 })
    const unknown = await app.request.post('/api/payments/simulator/paid').send({ orderCode: 999_999, amount: 1_000 })

    expect(exact.status).toBe(204)
    expect(less.status).toBe(204)
    expect(unknown.status).toBe(404)
    const view = (res: typeof first) => app.request.get(`/api/orders/${res.body.code}`).query({ token: res.body.token })
    expect((await view(first)).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    expect((await view(second)).body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
    expect(await reconciliation(app)).toEqual([expect.objectContaining({ reason: 'amount_mismatch' })])
    expect(await transactions(app, first.body.code)).toEqual([expect.objectContaining({ source: 'simulator' })])
    expect(await transactions(app, second.body.code)).toEqual([expect.objectContaining({ source: 'simulator' })])
  })

  it('không có cổng giả lập thì không có API giả lập thanh toán', async () => {
    const { code, request } = await pendingOrder()

    const res = await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: TOTAL })

    expect(res.status).toBe(404)
  })
})

describe('bảng giao dịch thanh toán', () => {
  it('không sửa, không xóa được', async () => {
    const { code, ipn, prisma } = await pendingOrder()
    await ipn(signedIpn(ipnParams(code, TOTAL)))

    // Không có API nào sửa giao dịch; thử thẳng bằng SQL để chắc trigger chặn.
    await expect(prisma.$executeRaw`UPDATE "payment_transaction" SET "amount" = 1`).rejects.toThrow(
      /chỉ cho phép thêm mới/,
    )
    await expect(prisma.$executeRaw`DELETE FROM "payment_transaction"`).rejects.toThrow(/chỉ cho phép thêm mới/)
    await expect(prisma.$executeRaw`TRUNCATE "payment_transaction" CASCADE`).rejects.toThrow(/chỉ cho phép thêm mới/)
  })
})

describe('trang quay về từ cổng thanh toán', () => {
  it('link gửi cổng chỉ mang mã đơn, cổng không bao giờ nhận token tra cứu', async () => {
    const { checkout, payments } = await shop()

    const res = await checkout()

    expect(res.status).toBe(201)
    expect(payments.created).toHaveLength(1)
    expect(payments.created[0]).toMatchObject({
      returnUrl: 'https://shop.test/don-hang/100000?ket-qua=1',
      description: 'Thanh toán đơn hàng #100000',
    })
    expect(JSON.stringify(payments.created)).not.toContain(res.body.token)
  })
})

describe('ghi nhận từ trang quay về VNPAY', () => {
  const returned = (app: Awaited<ReturnType<typeof pendingOrder>>, body: Record<string, string>) =>
    app.request.post('/api/payments/vnpay/return').send(body)

  it('tham số có chữ ký trên URL quay về: đơn thành đã trả đủ, giao dịch nguồn return, không cần token', async () => {
    const app = await pendingOrder()

    const res = await returned(app, signedIpn(ipnParams(app.code, TOTAL)))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ RspCode: '00', Message: 'Confirm Success' })
    expect((await app.order()).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    // `pendingOrder` đè `token` bằng token đơn; trang quản trị cần token admin.
    expect(await transactions({ ...app, token: app.adminToken }, app.code)).toEqual([
      expect.objectContaining({ source: 'return', amount: TOTAL }),
    ])
  })

  it('trang quay về và IPN cùng báo một khoản: chỉ ghi một lần, IPN tới sau nhận 02', async () => {
    const app = await pendingOrder()
    const signed = signedIpn(ipnParams(app.code, TOTAL))

    await returned(app, signed)
    const ipn = await app.ipn(signed)

    expect(ipn.body.RspCode).toBe('02')
    expect(await app.transactionCount()).toBe(1)
  })

  it('tham số bị sửa hay không phải object thì trả 97 và không ghi gì', async () => {
    const app = await pendingOrder()

    const tampered = await returned(app, { ...signedIpn(ipnParams(app.code, TOTAL)), vnp_Amount: '100' })
    const notObject = await app.request.post('/api/payments/vnpay/return').send(['x'])

    for (const res of [tampered, notObject]) expect(res.body.RspCode).toBe('97')
    expect(await app.transactionCount()).toBe(0)
  })
})
