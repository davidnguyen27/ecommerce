import { describe, expect, it } from 'vitest'
import { expireOverdueOrders } from '../src/orders/cancel-order.ts'
import { CUSTOMER, register } from './support/customer.ts'
import { signedWebhook, webhookData } from './support/payos.ts'
import { shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const MINUTE = 60_000
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * MINUTE)

/** Cửa hàng đã có một đơn AM-40 chờ thanh toán (giữ 1 đôi trên 3). */
async function pendingOrder(options?: Parameters<typeof shop>[0]) {
  const app = await shop(options)
  const res = await app.checkout()
  expect(res.status).toBe(201)
  const { code, token: orderToken } = res.body as { code: number; token: string }
  const order = () => app.request.get(`/api/orders/${code}`).query({ token: orderToken })
  const reserved = async () => {
    const stock = await app.request.get('/api/admin/stock').query({ q: 'AM-40' }).set(bearer(app.token))
    return (stock.body.items as { reserved: number }[])[0]!.reserved
  }
  // Job hết hạn không có endpoint: test gọi thẳng hàm job chạy với `now` ở tương lai, rồi kiểm qua HTTP.
  const expire = (now: Date) =>
    expireOverdueOrders({ prisma: app.prisma, payments: app.payments, logger: app.logger }, now)
  /** Sự kiện "cancelled" trong lịch sử đơn ở trang quản trị. */
  const cancelEvents = async (orderCode = code) => {
    const res = await app.request.get(`/api/admin/orders/${orderCode}`).set(bearer(app.token))
    expect(res.status).toBe(200)
    return (res.body.history as { action: string }[]).filter((entry) => entry.action === 'cancelled')
  }
  return { ...app, code, orderToken, order, reserved, expire, cancelEvents }
}

describe('hết hạn giữ hàng', () => {
  it('đặt mua xếp job expire-order đúng lúc hết hạn, và có job quét mỗi phút', async () => {
    const { code, prisma } = await pendingOrder()
    const { id, reservedUntil } = await prisma.order.findUniqueOrThrow({ where: { code } })

    // Job chạy sau 15 phút, ngoài thời gian của test: kiểm hàng đợi pg-boss bằng SQL.
    const jobs = await prisma.$queryRaw<{ data: unknown; startAfter: Date }[]>`
      SELECT "data", "start_after" AS "startAfter" FROM "pgboss"."job" WHERE "name" = 'expire-order'`
    expect(jobs).toEqual([{ data: { orderId: id }, startAfter: reservedUntil }])
    const schedules = await prisma.$queryRaw<{ cron: string }[]>`
      SELECT "cron" FROM "pgboss"."schedule" WHERE "name" = 'expire-overdue-orders'`
    expect(schedules).toEqual([{ cron: '* * * * *' }])
  })

  it('quá hạn thì đơn hủy vì hết hạn, nhả giữ hàng và hủy link thanh toán', async () => {
    const { code, order, reserved, expire, payments } = await pendingOrder()
    expect(await reserved()).toBe(1)

    await expire(inMinutes(16))

    expect((await order()).body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'expired',
      paymentStatus: 'unpaid',
      reservedUntil: null,
    })
    expect(await reserved()).toBe(0)
    expect(payments.cancelled).toEqual([code])
  })

  it('chạy lại thì không đổi gì: không nhả thêm hàng, không hủy link lần nữa, không thêm sự kiện', async () => {
    const { code, order, reserved, expire, payments, checkout, cancelEvents } = await pendingOrder()
    // Một đơn khác còn giữ hàng: nhả hai lần thì số giữ của đơn này sẽ sai.
    expect((await checkout()).status).toBe(201)
    await expire(inMinutes(16))
    const before = (await order()).body

    expect(await expire(inMinutes(17))).toBe(0)

    expect((await order()).body).toEqual(before)
    expect(payments.cancelled).toEqual([code, code + 1])
    expect(await reserved()).toBe(0)
    expect(await cancelEvents(code)).toHaveLength(1)
    expect(await cancelEvents(code + 1)).toHaveLength(1)
  })

  it('không động tới đơn chưa quá hạn hay đơn đã trả', async () => {
    const { code, order, reserved, expire, payments, request, checkout } = await pendingOrder({ simulator: true })
    const paid = await checkout()
    const pay = await request
      .post('/api/payments/simulator/paid')
      .send({ orderCode: paid.body.code, amount: 2_030_000 })
    expect(pay.status).toBe(204)

    expect(await expire(inMinutes(14))).toBe(0)
    expect((await order()).body).toMatchObject({ status: 'pending_payment' })

    expect(await expire(inMinutes(16))).toBe(1)
    expect((await order()).body).toMatchObject({ status: 'cancelled', cancelReason: 'expired' })
    const paidView = await request.get(`/api/orders/${paid.body.code}`).query({ token: paid.body.token })
    expect(paidView.body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    // Đơn đã trả vẫn giữ hàng tới khi bàn giao: chỉ phần của đơn hết hạn được nhả.
    expect(await reserved()).toBe(1)
    expect(payments.cancelled).toEqual([code])
  })

  it('cổng lỗi khi hủy link thì chỉ log, đơn vẫn hủy và nhả hàng', async () => {
    const { code, order, reserved, expire, payments, logs } = await pendingOrder()
    payments.failCancel = true

    expect(await expire(inMinutes(16))).toBe(1)

    expect((await order()).body).toMatchObject({ status: 'cancelled' })
    expect(await reserved()).toBe(0)
    expect(logs()).toContainEqual(expect.objectContaining({ orderCode: code, msg: 'Không hủy được link thanh toán' }))
  })
})

describe('tiền về sau khi đơn đã hết hạn', () => {
  it('gắn cờ cần đối soát paid_after_cancel, đơn vẫn hủy và không giữ lại hàng', async () => {
    const { code, order, reserved, expire, request, token } = await pendingOrder()
    await expire(inMinutes(16))

    const res = await request.post('/api/payments/payos/webhook').send(signedWebhook(webhookData(code, 2_030_000)))

    expect(res.status).toBe(200)
    expect((await order()).body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'expired',
      paymentStatus: 'unpaid',
    })
    expect(await reserved()).toBe(0)
    const items = await request.get('/api/admin/reconciliation').set(bearer(token))
    expect(items.body.items).toEqual([
      expect.objectContaining({
        reason: 'paid_after_cancel',
        amount: 2_030_000,
        status: 'open',
        order: expect.objectContaining({ code }),
      }),
    ])
  })
})

describe('cổng giả lập', () => {
  it('nút "Giả lập hết hạn" hủy đơn ngay bằng cùng hàm hết hạn; đơn đã trả thì 409', async () => {
    const { code, order, reserved, request, checkout } = await pendingOrder({ simulator: true })
    const paid = await checkout()
    await request.post('/api/payments/simulator/paid').send({ orderCode: paid.body.code, amount: 2_030_000 })

    const res = await request.post('/api/payments/simulator/expired').send({ orderCode: code })
    const onPaid = await request.post('/api/payments/simulator/expired').send({ orderCode: paid.body.code })
    const unknown = await request.post('/api/payments/simulator/expired').send({ orderCode: 999_999 })

    expect(res.status).toBe(204)
    expect(onPaid.status).toBe(409)
    expect(unknown.status).toBe(404)
    expect((await order()).body).toMatchObject({ status: 'cancelled', cancelReason: 'expired' })
    expect(await reserved()).toBe(1)
  })

  it('không có cổng giả lập thì không có API giả lập hết hạn', async () => {
    const { code, request } = await pendingOrder()

    expect((await request.post('/api/payments/simulator/expired').send({ orderCode: code })).status).toBe(404)
  })
})

describe('khách hủy đơn chưa thanh toán', () => {
  it('bằng link có token: đơn hủy, nhả hàng, hủy link, không gửi email; bấm lại vẫn 200 và không đổi gì', async () => {
    const { code, orderToken, request, reserved, payments, mailer, cancelEvents } = await pendingOrder()

    const res = await request.post(`/api/orders/${code}/cancel`).query({ token: orderToken })
    const again = await request.post(`/api/orders/${code}/cancel`).query({ token: orderToken })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code, status: 'cancelled', cancelReason: 'customer', reservedUntil: null })
    expect(again.status).toBe(200)
    expect(again.body).toEqual(res.body)
    expect(await reserved()).toBe(0)
    expect(payments.cancelled).toEqual([code])
    expect(await cancelEvents()).toEqual([
      expect.objectContaining({ actor: { type: 'customer', id: null, email: null }, data: { reason: 'customer' } }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(mailer.sent).toEqual([])
  })

  it('token sai thì 404 và đơn giữ nguyên', async () => {
    const { code, request, order, reserved } = await pendingOrder()

    const wrong = await request.post(`/api/orders/${code}/cancel`).query({ token: 'sai' })
    const missing = await request.post(`/api/orders/${code}/cancel`)

    expect(wrong.status).toBe(404)
    expect(missing.status).toBe(404)
    expect((await order()).body).toMatchObject({ status: 'pending_payment' })
    expect(await reserved()).toBe(1)
  })

  it('đơn đã trả thì 409, không hủy được', async () => {
    const { code, orderToken, request, order } = await pendingOrder({ simulator: true })
    await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: 2_030_000 })

    const res = await request.post(`/api/orders/${code}/cancel`).query({ token: orderToken })

    expect(res.status).toBe(409)
    expect((await order()).body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
  })

  it('trong tài khoản: hủy được đơn của mình, đơn của người khác là 404', async () => {
    // Đơn vãng lai của `pendingOrder` đứng cạnh đơn đặt khi đăng nhập.
    const { code: guestCode, request, prisma, checkout, reserved, cancelEvents } = await pendingOrder()
    const mine = (await register(request)).body.accessToken as string
    const other = (await register(request, { email: 'nguoi-khac@example.com' })).body.accessToken as string
    const customer = await prisma.customer.findUniqueOrThrow({ where: { email: CUSTOMER.email } })
    const placed = await checkout().set(bearer(mine))
    expect(placed.status).toBe(201)
    const { code, token: orderToken } = placed.body as { code: number; token: string }

    const byOther = await request.post(`/api/account/orders/${code}/cancel`).set(bearer(other))
    const guestOrder = await request.post(`/api/account/orders/${guestCode}/cancel`).set(bearer(mine))
    const signedOut = await request.post(`/api/account/orders/${code}/cancel`)
    expect(byOther.status).toBe(404)
    expect(guestOrder.status).toBe(404)
    expect(signedOut.status).toBe(401)
    expect(await reserved()).toBe(2)

    const res = await request.post(`/api/account/orders/${code}/cancel`).set(bearer(mine))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code, status: 'cancelled', cancelReason: 'customer' })
    const viaToken = await request.get(`/api/orders/${code}`).query({ token: orderToken })
    expect(viaToken.body).toMatchObject({ status: 'cancelled' })
    expect(await reserved()).toBe(1)
    expect(await cancelEvents(code)).toEqual([
      expect.objectContaining({ actor: { type: 'customer', id: customer.id, email: CUSTOMER.email } }),
    ])
  })
})

describe('nhân viên hủy đơn chưa thanh toán', () => {
  it('cần quyền order.fulfill; hủy thì nhả hàng, hủy link, ghi audit và trả chi tiết đơn', async () => {
    const { code, request, token, order, reserved, payments } = await pendingOrder()
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
    const warehouseStaff = await createStaff(request, token, ['warehouse'], 'kho@example.com')

    const denied = await request.post(`/api/admin/orders/${code}/cancel`).set(bearer(sales.accessToken))
    expect(denied.status).toBe(403)
    expect((await order()).body).toMatchObject({ status: 'pending_payment' })

    const res = await request.post(`/api/admin/orders/${code}/cancel`).set(bearer(warehouseStaff.accessToken))
    const unknown = await request.post('/api/admin/orders/999999/cancel').set(bearer(warehouseStaff.accessToken))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code, status: 'cancelled', cancelReason: 'staff' })
    expect(unknown.status).toBe(404)
    expect((await order()).body).toMatchObject({ status: 'cancelled', cancelReason: 'staff' })
    expect(await reserved()).toBe(0)
    expect(payments.cancelled).toEqual([code])
    const audit = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    expect(audit.body.items).toEqual([
      expect.objectContaining({
        action: 'order.cancel',
        actor: expect.objectContaining({ id: warehouseStaff.id }),
        before: { status: 'pending_payment' },
        after: { status: 'cancelled', cancelReason: 'staff' },
      }),
    ])
    expect((res.body.history as { action: string }[]).filter((e) => e.action === 'cancelled')).toEqual([
      expect.objectContaining({ actor: expect.objectContaining({ type: 'staff', id: warehouseStaff.id }) }),
    ])
  })

  it('hủy lại đơn đã hủy thì 200 với đơn hiện tại, không ghi thêm audit hay sự kiện', async () => {
    const { code, orderToken, request, token, payments } = await pendingOrder()
    expect((await request.post(`/api/orders/${code}/cancel`).query({ token: orderToken })).status).toBe(200)

    const res = await request.post(`/api/admin/orders/${code}/cancel`).set(bearer(token))
    const again = await request.post(`/api/admin/orders/${code}/cancel`).set(bearer(token))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code, status: 'cancelled', cancelReason: 'customer' })
    expect(again.status).toBe(200)
    expect(again.body).toEqual(res.body)
    expect((res.body.history as { action: string }[]).filter((e) => e.action === 'cancelled')).toHaveLength(1)
    expect(payments.cancelled).toEqual([code])
    const audit = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    expect(audit.body.items).toEqual([])
  })

  it('đơn đã trả thì 409 và không ghi audit', async () => {
    const { code, request, token } = await pendingOrder({ simulator: true })
    await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: 2_030_000 })

    const res = await request.post(`/api/admin/orders/${code}/cancel`).set(bearer(token))

    expect(res.status).toBe(409)
    const audit = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    expect(audit.body.items).toEqual([])
  })
})
