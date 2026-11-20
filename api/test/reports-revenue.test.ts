import { describe, expect, it } from 'vitest'
import { backdate } from './support/backdate.ts'
import { REMAINING, depositedPreorder } from './support/preorder.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff, type Request } from './support/staff.ts'
import { adjust } from './support/stock.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }
const DAY = 24 * 60 * 60_000
/** Ngày lịch theo giờ Việt Nam, `days` ngày tính từ hôm nay. */
const vnDate = (days = 0) => new Date(Date.now() + 7 * 60 * 60_000 + days * DAY).toISOString().slice(0, 10)

type Figures = {
  deliveredOrders: number
  grossStandard: number
  grossPreorder: number
  gross: number
  returns: number
  net: number
  shippingFees: number
  forfeitedDeposits: number
}
type Report = { rows: (Figures & { period: string })[]; total: Figures }

const ZERO: Figures = {
  deliveredOrders: 0,
  grossStandard: 0,
  grossPreorder: 0,
  gross: 0,
  returns: 0,
  net: 0,
  shippingFees: 0,
  forfeitedDeposits: 0,
}

const revenue = async (request: Request, token: string, query: Record<string, string>) => {
  const res = await request.get('/api/admin/reports/revenue').query(query).set(bearer(token))
  expect(res.status).toBe(200)
  return res.body as Report
}

/**
 * Cửa hàng có cổng giả lập (AM-40 giá 2.000.000, còn 3 đôi; phí giao 30.000). `delivered` đặt đơn vãng lai, trả đủ,
 * chuẩn bị, bàn giao, đã giao. `today()` là báo cáo của riêng hôm nay.
 */
async function revenueShop() {
  const app = await shop({ simulator: true })
  const { request, token, checkout, v40 } = app
  let n = 0
  const step = (code: number, path: string, body?: Record<string, unknown>) =>
    request.post(`/api/admin/orders/${code}/${path}`).set(bearer(token)).send(body)
  const paidOrder = async (quantity = 1, body: Record<string, unknown> = {}) => {
    n += 1
    const res = await checkout({
      lines: [{ variantId: v40.id, quantity, price: 2_000_000 }],
      address: { ...ADDRESS, email: `khach${n}@example.com`, phone: `09000000${String(n).padStart(2, '0')}` },
      ...body,
    })
    expect(res.status).toBe(201)
    const placed = res.body as { code: number; token: string }
    const detail = await request.get(`/api/orders/${placed.code}`).query({ token: placed.token })
    await request.post('/api/payments/simulator/paid').send({ orderCode: placed.code, amount: detail.body.total })
    return placed
  }
  const handedOver = async (quantity = 1, body: Record<string, unknown> = {}) => {
    const placed = await paidOrder(quantity, body)
    expect((await step(placed.code, 'prepare')).status).toBe(200)
    expect((await step(placed.code, 'hand-over', SHIPMENT)).status).toBe(200)
    return placed
  }
  const delivered = async (quantity = 1, body: Record<string, unknown> = {}) => {
    const placed = await handedOver(quantity, body)
    expect((await step(placed.code, 'deliver')).status).toBe(200)
    return placed
  }
  const support = (code: number, path: string, body?: Record<string, unknown>) =>
    request.post(`/api/admin/support-requests/${code}/${path}`).set(bearer(token)).send(body)
  const report = (query: Record<string, string>) => revenue(request, token, query)
  const today = async () => (await report({ from: vnDate(), to: vnDate() })).total
  return { ...app, step, paidOrder, handedOver, delivered, support, report, today }
}

describe('báo cáo doanh thu', () => {
  it('chỉ owner và kế toán xem được; bán hàng và kho bị 403', async () => {
    const { request, token } = await shop()
    const query = { from: vnDate(), to: vnDate() }
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
    const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')

    expect((await revenue(request, accountant.accessToken, query)).total).toEqual(ZERO)
    for (const staff of [sales, warehouse]) {
      const res = await request.get('/api/admin/reports/revenue').query(query).set(bearer(staff.accessToken))
      expect(res.status).toBe(403)
    }
  })

  it('kỳ sai thì 400: thiếu ngày, ngày cuối trước ngày đầu, dài quá 366 ngày', async () => {
    const { request, token } = await shop()
    const get = (query: Record<string, string>) =>
      request.get('/api/admin/reports/revenue').query(query).set(bearer(token))

    expect((await get({ from: '2026-11-01' })).status).toBe(400)
    const reversed = await get({ from: '2026-11-02', to: '2026-11-01' })
    expect(reversed.status).toBe(400)
    expect(reversed.body.error.fields).toEqual([expect.objectContaining({ path: 'to' })])
    expect((await get({ from: '2025-01-01', to: '2026-01-02' })).status).toBe(400)
    expect((await get({ from: '2025-01-01', to: '2026-01-01', groupBy: 'month' })).status).toBe(200)
    expect((await get({ from: '2026-11-01', to: '2026-11-01', groupBy: 'week' })).status).toBe(400)
  })

  it('đơn đã giao tính theo ngày giao: tiền hàng sau giảm, phí giao để riêng; đơn mới bàn giao chưa tính', async () => {
    const app = await revenueShop()
    const voucher = await app.request
      .post('/api/admin/vouchers')
      .set(bearer(app.token))
      .send({
        code: 'GIAM10',
        kind: 'percent',
        percent: 10,
        maxDiscount: 500_000,
        startsAt: new Date(Date.now() - DAY).toISOString(),
        endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
        saleTypes: ['standard', 'preorder'],
      })
    expect(voucher.status).toBe(201)

    await app.delivered(1, { voucherCode: 'giam10', discount: 200_000 })
    await app.delivered(1)
    await app.handedOver(1)

    expect(await app.today()).toEqual({
      ...ZERO,
      deliveredOrders: 2,
      grossStandard: 1_800_000 + 2_000_000,
      gross: 3_800_000,
      net: 3_800_000,
      shippingFees: 60_000,
    })
  })

  it('ngày theo giờ Việt Nam: giao lúc 23:30 ngày 31/10 thuộc 31/10, giao lúc 00:00 ngày 01/11 thuộc 01/11', async () => {
    const app = await revenueShop()
    const late = await app.delivered()
    const midnight = await app.delivered()
    await backdate(app.prisma, 'order_event', late.code, new Date('2026-10-31T16:30:00Z'), 'delivered')
    await backdate(app.prisma, 'order_event', midnight.code, new Date('2026-10-31T17:00:00Z'), 'delivered')

    const report = await app.report({ from: '2026-10-30', to: '2026-11-01' })

    expect(report.rows.map((r) => [r.period, r.deliveredOrders])).toEqual([
      ['2026-10-30', 0],
      ['2026-10-31', 1],
      ['2026-11-01', 1],
    ])
    expect(report.total).toMatchObject({ deliveredOrders: 2, gross: 4_000_000 })
    const october = await app.report({ from: '2026-10-01', to: '2026-10-31' })
    expect(october.total).toMatchObject({ deliveredOrders: 1 })
  })

  it('nhóm theo tháng: mỗi tháng của kỳ một dòng, kể cả tháng không có số', async () => {
    const app = await revenueShop()
    const october = await app.delivered()
    const november = await app.delivered(2)
    await backdate(app.prisma, 'order_event', october.code, new Date('2026-10-15T03:00:00Z'), 'delivered')
    await backdate(app.prisma, 'order_event', november.code, new Date('2026-11-15T03:00:00Z'), 'delivered')

    const report = await app.report({ from: '2026-09-20', to: '2026-11-30', groupBy: 'month' })

    expect(report.rows.map((r) => [r.period, r.gross])).toEqual([
      ['2026-09', 0],
      ['2026-10', 2_000_000],
      ['2026-11', 4_000_000],
    ])
  })

  it('đơn đặt trước cọc tháng trước, giao hôm nay: doanh thu thuộc hôm nay, ở cột đặt trước', async () => {
    const app = await depositedPreorder()
    const { request, token, code } = app
    await app.arrive()
    expect((await app.payRemainder()).status).toBe(200)
    expect((await app.settle([REMAINING, 'FT-REM'])).body.paymentStatus).toBe('paid')
    for (const [path, body] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      expect((await request.post(`/api/admin/orders/${code}/${path}`).set(bearer(token)).send(body)).status).toBe(200)
    }
    await backdate(app.prisma, 'payment_transaction', code, new Date(Date.now() - 35 * DAY))

    const lastMonth = await revenue(request, token, { from: vnDate(-40), to: vnDate(-30) })
    const today = await revenue(request, token, { from: vnDate(), to: vnDate() })

    expect(lastMonth.total).toEqual(ZERO)
    expect(today.total).toEqual({
      ...ZERO,
      deliveredOrders: 1,
      grossPreorder: 2_100_000,
      gross: 2_100_000,
      net: 2_100_000,
      shippingFees: 30_000,
    })
  })

  it('hàng trả lại trừ theo ngày hoàn xong; khoản hoàn đang chờ chưa trừ', async () => {
    const app = await revenueShop()
    const placed = await app.delivered(2)
    const asked = await app.request
      .post(`/api/orders/${placed.code}/support-requests`)
      .query({ token: placed.token })
      .send({
        kind: 'return',
        subject: 'Trả giày',
        message: 'Không vừa',
        lines: [{ variantId: app.v40.id, quantity: 1, reason: 'wrong_fit' }],
      })
    const request = asked.body.code as number
    expect((await app.support(request, 'decide', { decision: 'accepted', message: 'Gửi về nhé' })).status).toBe(200)
    const view = await app.request.get(`/api/admin/support-requests/${request}`).set(bearer(app.token))
    const lineId = view.body.lines[0].id as string
    const lines = [{ lineId, restocked: 1, writtenOff: 0 }]
    expect((await app.support(request, 'receive', { lines })).status).toBe(200)
    const proposed = await app.support(request, 'refund', { refundAmount: 2_000_000 })
    const refundId = proposed.body.refunds[0].id as string

    expect(await app.today()).toMatchObject({ gross: 4_000_000, returns: 0, net: 4_000_000 })

    const manual = await app.request
      .post(`/api/admin/refunds/${refundId}/manual`)
      .set(bearer(app.token))
      .send({ bankReference: 'FT-HOAN', transferredOn: vnDate(), note: 'VCB' })
    expect(manual.status).toBe(200)
    expect(await app.today()).toMatchObject({ gross: 4_000_000, returns: 2_000_000, net: 2_000_000 })

    // Hoàn xong hôm qua: hôm qua có hàng trả lại mà không có đơn giao, hôm nay chỉ còn doanh thu gộp.
    await app.prisma.refund.update({ where: { id: refundId }, data: { completedAt: new Date(Date.now() - DAY) } })
    const twoDays = await app.report({ from: vnDate(-1), to: vnDate() })
    expect(twoDays.rows.map((r) => [r.gross, r.returns, r.net])).toEqual([
      [0, 2_000_000, -2_000_000],
      [4_000_000, 0, 4_000_000],
    ])
  })

  it('đổi hàng không đổi doanh thu', async () => {
    const app = await revenueShop()
    const { request, token, v40, v41, editVariant } = app
    expect((await editVariant(v41, 'AM-41', '41', { price: 2_000_000 })).status).toBe(200)
    await adjust(request, token, { variantId: v41.id, reason: 'stocktake', countedQuantity: 2, expectedOnHand: 0 })
    const placed = await app.delivered()
    const before = await app.today()

    const asked = await request
      .post(`/api/orders/${placed.code}/support-requests`)
      .query({ token: placed.token })
      .send({
        kind: 'exchange',
        subject: 'Đổi size',
        message: 'Chật',
        lines: [{ variantId: v40.id, quantity: 1, toVariantId: v41.id }],
      })
    const code = asked.body.code as number
    expect((await app.support(code, 'decide', { decision: 'accepted', message: 'Gửi về nhé' })).status).toBe(200)
    const view = await request.get(`/api/admin/support-requests/${code}`).set(bearer(token))
    const lines = [{ lineId: view.body.lines[0].id as string, restocked: 1, writtenOff: 0 }]
    expect((await app.support(code, 'receive', { lines })).status).toBe(200)
    expect((await app.support(code, 'exchange-ship', SHIPMENT)).status).toBe(200)

    expect(before).toMatchObject({ deliveredOrders: 1, gross: 2_000_000 })
    expect(await app.today()).toEqual(before)
  })

  it('mất cọc của đơn đặt trước bị hủy là dòng riêng: đã nhận trừ khoản hoàn chưa thất bại; không vào doanh thu', async () => {
    const app = await depositedPreorder()
    const { request, token, code } = app
    const cancelled = await request
      .post(`/api/admin/orders/${code}/cancel-paid`)
      .set(bearer(token))
      .send({ cause: 'changed_mind', refundAmount: 300_000, note: 'Giữ 330.000 theo chính sách' })
    expect(cancelled.status).toBe(200)

    const today = await revenue(request, token, { from: vnDate(), to: vnDate() })

    expect(today.total).toEqual({ ...ZERO, forfeitedDeposits: 330_000 })
  })
})
