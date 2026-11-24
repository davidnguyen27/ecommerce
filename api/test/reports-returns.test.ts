import { describe, expect, it } from 'vitest'
import { backdate } from './support/backdate.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'
import { adjust } from './support/stock.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }
const BACK = { carrier: 'Viettel Post', trackingNumber: 'VTP9' }
const DAY = 24 * 60 * 60_000
/** Vietnam-time calendar day, `days` days from today. */
const vnDate = (days = 0) => new Date(Date.now() + 7 * 60 * 60_000 + days * DAY).toISOString().slice(0, 10)

/**
 * A shop with the simulator (AM-40 at 2,000,000, 3 pairs). `delivered(n)` orders n pairs, pays, delivers; `ask` sends
 * a request via the order link; `admin` acts on requests as the owner.
 */
async function returnsShop() {
  const app = await shop({ simulator: true })
  const { request, token, checkout, v40 } = app
  let n = 0
  const delivered = async (quantity: number) => {
    n += 1
    const res = await checkout({
      lines: [{ variantId: v40.id, quantity, price: 2_000_000 }],
      address: { ...ADDRESS, email: `khach${n}@example.com`, phone: `09000000${String(n).padStart(2, '0')}` },
    })
    expect(res.status).toBe(201)
    const placed = res.body as { code: number; token: string }
    await request
      .post('/api/payments/simulator/paid')
      .send({ orderCode: placed.code, amount: 30_000 + quantity * 2_000_000 })
    for (const [path, body] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      expect(
        (await request.post(`/api/admin/orders/${placed.code}/${path}`).set(bearer(token)).send(body)).status,
      ).toBe(200)
    }
    return placed
  }
  const ask = async (placed: { code: number; token: string }, kind: string, line: Record<string, unknown>) => {
    const res = await request
      .post(`/api/orders/${placed.code}/support-requests`)
      .query({ token: placed.token })
      .send({
        kind,
        subject: 'Hỗ trợ',
        message: 'Nhờ shop xử lý',
        lines: [{ variantId: v40.id, quantity: 1, ...line }],
      })
    expect(res.status).toBe(201)
    return res.body.code as number
  }
  const admin = async (code: number, path: string, body?: Record<string, unknown>) => {
    const res = await request.post(`/api/admin/support-requests/${code}/${path}`).set(bearer(token)).send(body)
    expect(res.status).toBe(200)
  }
  const report = async () => {
    const res = await request
      .get('/api/admin/reports/returns')
      .query({ from: vnDate(), to: vnDate() })
      .set(bearer(token))
    expect(res.status).toBe(200)
    return res.body
  }
  return { ...app, delivered, ask, admin, report }
}

describe('báo cáo đổi trả và bảo hành', () => {
  it('chỉ owner và kế toán xem được; kỳ không có gì thì đủ mọi kết quả bằng 0', async () => {
    const { request, token } = await shop()
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
    const get = (as: string) =>
      request.get('/api/admin/reports/returns').query({ from: vnDate(), to: vnDate() }).set(bearer(as))

    const empty = await get(accountant.accessToken)
    expect(empty.body).toMatchObject({
      requests: [
        { kind: 'return', accepted: 0, rejected: 0, pending: 0, total: 0 },
        { kind: 'exchange', accepted: 0, rejected: 0, pending: 0, total: 0 },
      ],
      lines: [],
      returnRate: [],
      warrantyTotal: 0,
    })
    expect((await get(sales.accessToken)).status).toBe(403)
  })

  it('yêu cầu trả, đổi theo quyết định; số lượng theo lý do × nhóm hàng; tỷ lệ trả chỉ tính yêu cầu trả đã chấp nhận', async () => {
    const app = await returnsShop()
    const { v41, editVariant, request, token } = app
    expect((await editVariant(v41, 'AM-41', '41', { price: 2_000_000 })).status).toBe(200)
    await adjust(request, token, { variantId: v41.id, reason: 'stocktake', countedQuantity: 2, expectedOnHand: 0 })

    const pair = await app.delivered(2)
    const accepted = await app.ask(pair, 'return', { reason: 'wrong_fit' })
    await app.admin(accepted, 'decide', { decision: 'accepted', message: 'Gửi về nhé' })
    const rejected = await app.ask(pair, 'return', { reason: 'defective' })
    await app.admin(rejected, 'decide', { decision: 'rejected', message: 'Ảnh không cho thấy lỗi' })
    const single = await app.delivered(1)
    await app.ask(single, 'exchange', { toVariantId: v41.id })

    const report = await app.report()

    expect(report.requests).toEqual([
      { kind: 'return', accepted: 1, rejected: 1, pending: 0, total: 2 },
      { kind: 'exchange', accepted: 0, rejected: 0, pending: 1, total: 1 },
    ])
    expect(report.lines).toEqual([
      { kind: 'exchange', reason: null, productType: 'footwear', quantity: 1 },
      { kind: 'return', reason: 'defective', productType: 'footwear', quantity: 1 },
      { kind: 'return', reason: 'wrong_fit', productType: 'footwear', quantity: 1 },
    ])
    expect(report.returnRate).toEqual([{ productType: 'footwear', returned: 1, delivered: 3, rate: 1 / 3 }])
  })

  it('có hàng trả nhưng không có hàng giao trong kỳ: tỷ lệ trả là null', async () => {
    const app = await returnsShop()
    const order = await app.delivered(1)
    await backdate(app.prisma, 'order_event', order.code, new Date(Date.now() - 3 * DAY), 'delivered')
    const code = await app.ask(order, 'return', { reason: 'wrong_fit' })
    await app.admin(code, 'decide', { decision: 'accepted', message: 'Gửi về nhé' })

    expect((await app.report()).returnRate).toEqual([
      { productType: 'footwear', returned: 1, delivered: 0, rate: null },
    ])
  })

  it('bảo hành theo kết quả: đã sửa, từ chối tiếp nhận, đang xử lý', async () => {
    const app = await returnsShop()
    const order = await app.delivered(3)
    const repaired = await app.ask(order, 'warranty', {})
    await app.admin(repaired, 'decide', { decision: 'accepted', message: 'Gửi về nhé' })
    await app.admin(repaired, 'warranty-milestone', { milestone: 'received' })
    await app.admin(repaired, 'warranty-milestone', { milestone: 'sent' })
    await app.admin(repaired, 'warranty-milestone', { milestone: 'returned', ...BACK })
    await app.admin(repaired, 'warranty-outcome', { outcome: 'repaired' })
    const declined = await app.ask(order, 'warranty', {})
    await app.admin(declined, 'decide', { decision: 'rejected', message: 'Lỗi do sử dụng' })
    await app.ask(order, 'warranty', {})

    const report = await app.report()

    expect(report.warranty).toEqual([
      { outcome: 'repaired', count: 1 },
      { outcome: 'replaced', count: 0 },
      { outcome: 'rejected', count: 0 },
      { outcome: 'refunded', count: 0 },
      { outcome: 'declined', count: 1 },
      { outcome: 'in_progress', count: 1 },
    ])
    expect(report.warrantyTotal).toBe(3)
    // Warranty is not a return: the return rate is 0 over the 3 delivered pairs.
    expect(report.returnRate).toEqual([{ productType: 'footwear', returned: 0, delivered: 3, rate: 0 }])
  })
})
