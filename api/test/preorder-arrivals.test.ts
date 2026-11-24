import { describe, expect, it, vi } from 'vitest'
import type { InMemoryMailer } from '../src/adapters/mailer.ts'
import { preorderShop } from './support/preorder.ts'
import { ADDRESS } from './support/shop.ts'
import { bearer } from './support/staff.ts'
import { adjust } from './support/stock.ts'

const DAY = 24 * 60 * 60_000

/** Waits for an email with `subject` in the title via the job queue. */
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

type Preorder = {
  arrivedQuantity: number
  quantity: number
  arrivedAt: string | null
  remainderDueAt: string | null
}

/**
 * An AM-41 pre-order campaign (price 2,100,000, 30% deposit, remainder within 7 days, 20 allocation). `deposited(n)`
 * pre-orders `n` pairs and pays the deposit at once, so call order is deposit order. `receive(n)` records a receipt of
 * `n` pairs of AM-41.
 */
async function arrivals() {
  const app = await preorderShop()
  const { request, token, v41 } = app
  const campaignId = await app.open([{ variantId: v41.id, allocation: 20 }])
  let customer = 0
  const place = async (quantity: number) => {
    customer += 1
    const address = {
      ...ADDRESS,
      email: `khach${customer}@example.com`,
      phone: `09100000${String(customer).padStart(2, '0')}`,
    }
    const placed = await app.placed(campaignId, { quantity, address })
    const view = () => request.get(`/api/orders/${placed.code}`).query({ token: placed.token })
    return { ...placed, view }
  }
  const deposited = async (quantity: number) => {
    const order = await place(quantity)
    app.payments.payments.set(`${order.code}-deposit-1`, {
      status: 'paid',
      transactions: [{ reference: `FT-${order.code}`, amount: 630_000 * quantity, paidAt: new Date() }],
    })
    const paid = await request.get(`/api/orders/${order.code}`).query({ token: order.token, refresh: '1' })
    expect(paid.body.paymentStatus).toBe('deposit_paid')
    return order
  }
  const lines = (quantity: number) => [{ sku: 'AM-41', quantity }]
  const preview = async (quantity: number) => {
    const res = await request
      .post('/api/admin/stock/receipts/preview')
      .set(bearer(token))
      .send({ lines: lines(quantity) })
    expect(res.status).toBe(200)
    return res.body.lines[0]
  }
  const receive = async (quantity: number) => {
    const res = await request
      .post('/api/admin/stock/receipts')
      .set(bearer(token))
      .send({ supplierName: 'Nike VN', receivedOn: '2026-12-01', note: '', lines: lines(quantity) })
    expect(res.status).toBe(201)
    return res.body
  }
  const preorderOf = async (order: { view: () => ReturnType<typeof request.get> }) =>
    (await order.view()).body.preorder as Preorder
  /** AM-41 on-hand and reserved on the Stock page. */
  const stock = async () => {
    const res = await request.get('/api/admin/stock').query({ q: 'AM-41' }).set(bearer(token))
    const item = (res.body.items as { sku: string; onHand: number; reserved: number }[]).find((i) => i.sku === 'AM-41')!
    return { onHand: item.onHand, reserved: item.reserved }
  }
  const availability = async () =>
    ((await request.get('/api/products/air-max')).body.variants as { sku: string; availability: string }[]).find(
      (v) => v.sku === 'AM-41',
    )!.availability
  return { ...app, place, deposited, preview, receive, preorderOf, stock, availability }
}

describe('hàng về chia cho đơn đặt trước', () => {
  it('chia từng cái theo thứ tự cọc: A(2) B(3) C(1) nhập 4 thì A đủ, B 2/3, C chưa có; nhập tiếp 2 thì B, C đủ', async () => {
    const app = await arrivals()
    const a = await app.deposited(2)
    const b = await app.deposited(3)
    const c = await app.deposited(1)

    expect(await app.preview(4)).toEqual({
      sku: 'AM-41',
      quantity: 4,
      forPreorders: 4,
      preorderOrders: 2,
      ordersCompleted: 1,
      toStock: 0,
    })
    await app.receive(4)

    const before = Date.now()
    expect(await app.preorderOf(a)).toMatchObject({ arrivedQuantity: 2, quantity: 2, arrivedAt: expect.any(String) })
    expect(await app.preorderOf(b)).toMatchObject({ arrivedQuantity: 2, quantity: 3, arrivedAt: null })
    expect(await app.preorderOf(c)).toMatchObject({ arrivedQuantity: 0, quantity: 1, arrivedAt: null })
    // The arrival is all reserved for deposited orders: no new regular stock, others can still only pre-order.
    expect(await app.stock()).toEqual({ onHand: 4, reserved: 4 })
    expect(await app.availability()).toBe('preorder')
    // Remaining-balance deadline: 7 days after full arrival.
    const { arrivedAt, remainderDueAt } = await app.preorderOf(a)
    expect(Date.parse(remainderDueAt!) - Date.parse(arrivedAt!)).toBe(7 * DAY)
    expect(Date.parse(arrivedAt!)).toBeLessThanOrEqual(before)

    expect(await app.preview(2)).toMatchObject({ forPreorders: 2, preorderOrders: 2, ordersCompleted: 2, toStock: 0 })
    await app.receive(2)

    expect(await app.preorderOf(b)).toMatchObject({ arrivedQuantity: 3, arrivedAt: expect.any(String) })
    expect(await app.preorderOf(c)).toMatchObject({ arrivedQuantity: 1, arrivedAt: expect.any(String) })
    expect(await app.stock()).toEqual({ onHand: 6, reserved: 6 })
  })

  it('khách nhận email "Hàng đã về" đúng một lần khi đơn về đủ, kèm phần còn lại và hạn trả', async () => {
    const app = await arrivals()
    const a = await app.deposited(2)

    await app.receive(1)
    await app.receive(1)
    await app.receive(3)

    const [mail] = await mailsAbout(app.mailer, `Hàng đã về cho đơn đặt trước #${a.code}`)
    expect(mail!.to).toBe('khach1@example.com')
    // Total 4,230,000 (30,000 shipping included) minus 1,260,000 deposit.
    expect(mail!.text).toContain('2.970.000')
    expect(mail!.text).toMatch(/Hạn trả: \d{1,2}\/\d{1,2}\/\d{4}/)
    const link = /https:\/\/shop\.test\/don-hang\/(\d+)\?token=([\w-]+)/.exec(mail!.text)
    expect((await app.request.get(`/api/orders/${link![1]}`).query({ token: link![2] })).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(app.mailer.sent.filter((m) => m.subject.includes('Hàng đã về'))).toHaveLength(1)
  })

  it('không còn đơn chờ thì phần dư thành hàng sẵn', async () => {
    const app = await arrivals()
    await app.deposited(1)

    expect(await app.preview(3)).toMatchObject({ forPreorders: 1, preorderOrders: 1, toStock: 2 })
    await app.receive(3)

    expect(await app.stock()).toEqual({ onHand: 3, reserved: 1 })
    expect(await app.availability()).toBe('in_stock')
  })

  it('đơn chờ cọc không được chia: chờ phiếu nhập sau khi đã cọc', async () => {
    const app = await arrivals()
    const pending = await app.place(1)

    expect(await app.preview(1)).toMatchObject({ forPreorders: 0, preorderOrders: 0, toStock: 1 })
    await app.receive(1)

    expect(await app.preorderOf(pending)).toMatchObject({ arrivedQuantity: 0 })
    expect(await app.stock()).toEqual({ onHand: 1, reserved: 0 })
  })

  it('điều chỉnh tồn không chia hàng cho đơn đặt trước', async () => {
    const app = await arrivals()
    const a = await app.deposited(1)

    const res = await adjust(app.request, app.token, {
      variantId: app.v41.id,
      reason: 'stocktake',
      countedQuantity: 2,
      expectedOnHand: 0,
    })

    expect(res.status).toBe(201)
    expect(await app.preorderOf(a)).toMatchObject({ arrivedQuantity: 0 })
    expect(await app.stock()).toEqual({ onHand: 2, reserved: 0 })
  })

  it('hạ tồn xuống dưới số đang giữ cho đơn đặt trước thì 409, kèm mã đơn đặt trước', async () => {
    const app = await arrivals()
    const a = await app.deposited(2)
    await app.place(1)
    await app.receive(2)

    const res = await adjust(app.request, app.token, {
      variantId: app.v41.id,
      reason: 'stocktake',
      countedQuantity: 1,
      expectedOnHand: 2,
    })

    expect(res.status).toBe(409)
    // Pending-deposit orders hold no stock, so they are not listed.
    expect(res.body.error.details).toEqual({ reserved: 2, orderCodes: [a.code] })
  })

  it('xem trước không ghi gì, và cần quyền nhập kho', async () => {
    const app = await arrivals()
    const a = await app.deposited(1)
    await app.preview(1)

    expect(await app.preorderOf(a)).toMatchObject({ arrivedQuantity: 0 })
    expect(await app.stock()).toEqual({ onHand: 0, reserved: 0 })
    const unknown = await app.request
      .post('/api/admin/stock/receipts/preview')
      .set(bearer(app.token))
      .send({ lines: [{ sku: 'KHONG-CO', quantity: 1 }] })
    expect(unknown.status).toBe(400)
  })
})
