import { describe, expect, it, vi } from 'vitest'
import type { InMemoryMailer } from '../src/adapters/mailer.ts'
import type { PaymentInfo } from '../src/payments/gateway.ts'
import { signedWebhook, webhookData } from './support/payos.ts'
import { shop } from './support/shop.ts'

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

type Prisma = Awaited<ReturnType<typeof shop>>['prisma']

// Danh sách giao dịch và cần đối soát chưa có API đọc (ticket 07, 10), nên đếm bằng SQL trực tiếp.
async function transactionCount(prisma: Prisma) {
  const [row] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "payment_transaction"`
  return row!.n
}

function reconciliation(prisma: Prisma) {
  return prisma.$queryRaw<{ reason: string; amount: bigint; receivedAt: Date; status: string }[]>`
    SELECT "reason"::text AS reason, "amount", "received_at" AS "receivedAt", "status"::text AS status
    FROM "reconciliation_item" ORDER BY "created_at"`
}

/** Cổng trả lời truy vấn: đơn đã nhận một khoản. */
const paidInfo = (amount: number, reference: string): PaymentInfo => ({
  status: 'paid',
  amountPaid: amount,
  transactions: [{ reference, amount, paidAt: new Date('2026-11-02T03:20:00Z') }],
})

/** Cửa hàng đã có một đơn AM-40 chờ thanh toán, tổng 2.030.000. */
async function pendingOrder() {
  const app = await shop()
  const res = await app.checkout()
  expect(res.status).toBe(201)
  const { code, token } = res.body as { code: number; token: string }
  const order = () => app.request.get(`/api/orders/${code}`).query({ token })
  const webhook = (body: unknown) => app.request.post('/api/payments/payos/webhook').send(body as object)
  return { ...app, code, token, order, webhook }
}

describe('ghi nhận thanh toán qua webhook', () => {
  it('webhook đúng chữ ký, đúng tiền: đơn thành đã trả đủ, hết hạn giữ hàng và khách nhận email một lần', async () => {
    const { code, order, webhook, mailer, request } = await pendingOrder()

    const res = await webhook(signedWebhook(webhookData(code, TOTAL)))

    expect(res.status).toBe(200)
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

  it('sai chữ ký thì 400 và không ghi gì', async () => {
    const { code, order, webhook, prisma } = await pendingOrder()
    const body = signedWebhook(webhookData(code, TOTAL))

    const tampered = await webhook({ ...body, data: { ...body.data, amount: 1 } })
    const otherKey = await webhook(signedWebhook(webhookData(code, TOTAL), 'khoa-khac'))
    const unsigned = await webhook({ data: webhookData(code, TOTAL) })

    for (const res of [tampered, otherKey, unsigned]) expect(res.status).toBe(400)
    expect((await order()).body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
    expect(await transactionCount(prisma)).toBe(0)
  })

  it('cùng một webhook gửi hai lần: chỉ ghi một giao dịch và gửi một email', async () => {
    const { code, order, webhook, prisma, mailer } = await pendingOrder()
    const body = signedWebhook(webhookData(code, TOTAL))

    const first = await webhook(body)
    const second = await webhook(body)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await order()).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    expect(await transactionCount(prisma)).toBe(1)
    await paymentMails(mailer, code)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(await paymentMails(mailer, code)).toHaveLength(1)
  })

  it('webhook cho mã đơn không có (như webhook thử của PayOS) vẫn trả 2xx và không ghi gì', async () => {
    const { webhook, prisma } = await pendingOrder()

    const res = await webhook(signedWebhook(webhookData(123, 3_000)))

    expect(res.status).toBe(200)
    expect(await transactionCount(prisma)).toBe(0)
  })
})

describe('ghi nhận thanh toán khi khách quay về', () => {
  it('refresh=1 hỏi cổng và ghi nhận được khi chưa có webhook', async () => {
    const { code, order, payments, token, request } = await pendingOrder()
    payments.payments.set(code, paidInfo(TOTAL, 'FT-Q1'))

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
    const { code, payments, request, prisma } = await pendingOrder()
    payments.payments.set(code, paidInfo(TOTAL, 'FT-Q1'))

    const res = await request.get(`/api/orders/${code}`).query({ token: 'sai', refresh: '1' })

    expect(res.status).toBe(404)
    expect(await transactionCount(prisma)).toBe(0)
  })

  it('webhook và truy vấn cùng về một khoản: chỉ ghi một lần, email một lần', async () => {
    const { code, order, webhook, payments, token, request, prisma, mailer } = await pendingOrder()
    payments.payments.set(code, paidInfo(TOTAL, `FT${code}A`))

    const [hook, query] = await Promise.all([
      webhook(signedWebhook(webhookData(code, TOTAL))),
      request.get(`/api/orders/${code}`).query({ token, refresh: '1' }),
    ])

    expect(hook.status).toBe(200)
    expect(query.status).toBe(200)
    expect((await order()).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    expect(await transactionCount(prisma)).toBe(1)
    await paymentMails(mailer, code)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(await paymentMails(mailer, code)).toHaveLength(1)
  })
})

describe('cần đối soát', () => {
  it('lệch tiền: gắn cờ amount_mismatch, đơn vẫn chưa thanh toán', async () => {
    const { code, order, webhook, prisma } = await pendingOrder()

    const res = await webhook(signedWebhook(webhookData(code, 2_000_000)))

    expect(res.status).toBe(200)
    expect((await order()).body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
    expect(await reconciliation(prisma)).toEqual([
      { reason: 'amount_mismatch', amount: 2_000_000n, receivedAt: new Date('2026-11-02T03:15:30Z'), status: 'open' },
    ])
  })

  it('tiền về thêm cho đơn đã trả: gắn cờ extra_payment, đơn giữ nguyên đã trả', async () => {
    const { code, order, webhook, prisma } = await pendingOrder()
    await webhook(signedWebhook(webhookData(code, TOTAL)))

    const res = await webhook(signedWebhook(webhookData(code, 50_000, { reference: 'FT-THEM' })))

    expect(res.status).toBe(200)
    expect((await order()).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    expect(await reconciliation(prisma)).toEqual([
      expect.objectContaining({ reason: 'extra_payment', amount: 50_000n }),
    ])
  })

  it('tiền về cho đơn đã hủy: gắn cờ paid_after_cancel, đơn vẫn hủy', async () => {
    const { code, token, order, webhook, prisma, request } = await pendingOrder()
    expect((await request.post(`/api/orders/${code}/cancel`).query({ token })).status).toBe(200)

    const res = await webhook(signedWebhook(webhookData(code, TOTAL)))

    expect(res.status).toBe(200)
    expect((await order()).body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'customer',
      paymentStatus: 'unpaid',
    })
    expect(await reconciliation(prisma)).toEqual([expect.objectContaining({ reason: 'paid_after_cancel' })])
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
    expect(await reconciliation(app.prisma)).toEqual([expect.objectContaining({ reason: 'amount_mismatch' })])
    const sources = await app.prisma.$queryRaw<{ source: string }[]>`
      SELECT "source"::text AS source FROM "payment_transaction"`
    expect(sources).toEqual([{ source: 'simulator' }, { source: 'simulator' }])
  })

  it('không có cổng giả lập thì không có API giả lập thanh toán', async () => {
    const { code, request } = await pendingOrder()

    const res = await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: TOTAL })

    expect(res.status).toBe(404)
  })
})

describe('bảng giao dịch thanh toán', () => {
  it('không sửa, không xóa được', async () => {
    const { code, webhook, prisma } = await pendingOrder()
    await webhook(signedWebhook(webhookData(code, TOTAL)))

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
      cancelUrl: 'https://shop.test/don-hang/100000?ket-qua=1',
    })
    expect(JSON.stringify(payments.created)).not.toContain(res.body.token)
  })
})
