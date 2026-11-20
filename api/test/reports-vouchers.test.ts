import { describe, expect, it } from 'vitest'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }
const DAY = 24 * 60 * 60_000
/** Ngày lịch theo giờ Việt Nam, `days` ngày tính từ hôm nay. */
const vnDate = (days = 0) => new Date(Date.now() + 7 * 60 * 60_000 + days * DAY).toISOString().slice(0, 10)

/**
 * Cửa hàng có cổng giả lập (AM-40 giá 2.000.000, còn 3 đôi) và hai mã: GIAM10 (10%, tối đa 500.000) và BOT100
 * (100.000). `place` đặt 1 đôi với một mã như khách vãng lai.
 */
async function voucherShop() {
  const app = await shop({ simulator: true })
  const { request, token } = app
  const createVoucher = async (body: Record<string, unknown>) => {
    const res = await request
      .post('/api/admin/vouchers')
      .set(bearer(token))
      .send({
        startsAt: new Date(Date.now() - DAY).toISOString(),
        endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
        saleTypes: ['standard'],
        ...body,
      })
    expect(res.status).toBe(201)
    return res.body.id as string
  }
  const percentId = await createVoucher({ code: 'GIAM10', kind: 'percent', percent: 10, maxDiscount: 500_000 })
  const fixedId = await createVoucher({ code: 'BOT100', kind: 'fixed', amount: 100_000 })
  let n = 0
  const place = async (voucherCode: string, discount: number) => {
    n += 1
    const res = await app.checkout({
      voucherCode,
      discount,
      address: { ...ADDRESS, email: `khach${n}@example.com`, phone: `09000000${String(n).padStart(2, '0')}` },
    })
    expect(res.status).toBe(201)
    return res.body as { code: number; token: string }
  }
  const pay = async (code: number, amount: number) =>
    expect((await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount })).status).toBe(204)
  const report = async (query = { from: vnDate(), to: vnDate() }) => {
    const res = await request.get('/api/admin/reports/vouchers').query(query).set(bearer(token))
    expect(res.status).toBe(200)
    return res.body
  }
  return { ...app, percentId, fixedId, place, pay, report }
}

describe('báo cáo hiệu quả mã giảm giá', () => {
  it('chỉ owner và kế toán xem được', async () => {
    const { request, token } = await shop()
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
    const get = (as: string) =>
      request.get('/api/admin/reports/vouchers').query({ from: vnDate(), to: vnDate() }).set(bearer(as))

    expect((await get(accountant.accessToken)).body).toMatchObject({ items: [], totals: { redemptions: 0 } })
    expect((await get(sales.accessToken)).status).toBe(403)
  })

  it('mỗi mã: số lượt, tiền giảm, tiền hàng sau giảm và số đơn đã giao; đơn hủy không tính; kỳ theo ngày tạo đơn', async () => {
    const app = await voucherShop()
    const { request, token } = app
    const delivered = await app.place('giam10', 200_000)
    await app.pay(delivered.code, 1_830_000)
    for (const [path, body] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      const res = await request.post(`/api/admin/orders/${delivered.code}/${path}`).set(bearer(token)).send(body)
      expect(res.status).toBe(200)
    }
    const paidOnly = await app.place('giam10', 200_000)
    await app.pay(paidOnly.code, 1_830_000)
    const cancelled = await app.place('bot100', 100_000)
    const cancel = await request.post(`/api/orders/${cancelled.code}/cancel`).query({ token: cancelled.token })
    expect(cancel.status).toBe(200)
    const earlier = await app.place('bot100', 100_000)
    await app.prisma.order.update({
      where: { code: earlier.code },
      data: { createdAt: new Date(Date.now() - 3 * DAY) },
    })

    const today = await app.report()
    const lastDays = await app.report({ from: vnDate(-3), to: vnDate() })

    const giam10 = {
      voucherId: app.percentId,
      code: 'GIAM10',
      kind: 'percent',
      amount: null,
      percent: 10,
      maxDiscount: 500_000,
      redemptions: 2,
      discount: 400_000,
      netGoods: 3_600_000,
      deliveredOrders: 1,
    }
    expect(today.items).toEqual([giam10])
    expect(today.totals).toEqual({ redemptions: 2, discount: 400_000, netGoods: 3_600_000, deliveredOrders: 1 })
    expect(lastDays.items).toEqual([
      giam10,
      {
        voucherId: app.fixedId,
        code: 'BOT100',
        kind: 'fixed',
        amount: 100_000,
        percent: null,
        maxDiscount: null,
        redemptions: 1,
        discount: 100_000,
        netGoods: 1_900_000,
        deliveredOrders: 0,
      },
    ])
    expect(lastDays.totals).toEqual({ redemptions: 3, discount: 500_000, netGoods: 5_500_000, deliveredOrders: 1 })
  })
})
