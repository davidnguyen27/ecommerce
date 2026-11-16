import { describe, expect, it } from 'vitest'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const DAY = 24 * 60 * 60_000
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString()

/** Cửa hàng của `shop()` có mã `TET2027` giảm 10% tối đa 500.000; `order(n)` là khách `n` đặt 1 đôi AM-40 kèm mã. */
async function voucherOrders() {
  const app = await shop()
  const created = await app.request
    .post('/api/admin/vouchers')
    .set(bearer(app.token))
    .send({
      code: 'TET2027',
      kind: 'percent',
      percent: 10,
      maxDiscount: 500_000,
      startsAt: at(-1),
      endsAt: at(30),
      saleTypes: ['standard'],
    })
  expect(created.status).toBe(201)
  const voucherId = created.body.id as string
  const order = async (n: number, body: Record<string, unknown> = { voucherCode: 'TET2027', discount: 200_000 }) => {
    const address = { ...ADDRESS, email: `khach${n}@example.com`, phone: `091000000${n}` }
    const res = await app.checkout({ address, ...body })
    expect(res.status).toBe(201)
    return res.body as { code: number; token: string }
  }
  const adminOrder = (code: number, as = app.token) => app.request.get(`/api/admin/orders/${code}`).set(bearer(as))
  const voucherOrderList = (query: Record<string, string> = {}, as = app.token) =>
    app.request.get(`/api/admin/vouchers/${voucherId}/orders`).query(query).set(bearer(as))
  return { ...app, voucherId, order, adminOrder, voucherOrderList }
}

describe('mã giảm giá trong đơn ở trang quản trị', () => {
  it('chi tiết đơn có mã như lúc đặt, tiền giảm, tiền hàng sau giảm và tiền giảm từng dòng', async () => {
    const app = await voucherOrders()
    const placed = await app.order(1)

    const res = await app.adminOrder(placed.code)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      voucherCode: 'TET2027',
      discount: 200_000,
      subtotal: 2_000_000,
      subtotalAfterDiscount: 1_800_000,
      total: 1_830_000,
      voucher: {
        id: app.voucherId,
        code: 'TET2027',
        kind: 'percent',
        percent: 10,
        maxDiscount: 500_000,
        amount: null,
      },
      lines: [{ sku: 'AM-40', lineTotal: 2_000_000, discount: 200_000 }],
    })
    // Khách cũng thấy tiền giảm của dòng qua link tra cứu.
    const view = await app.request.get(`/api/orders/${placed.code}`).query({ token: placed.token })
    expect(view.body.lines[0].discount).toBe(200_000)
  })

  it('đơn không dùng mã có voucher null và tiền giảm 0', async () => {
    const app = await voucherOrders()
    const placed = await app.order(1, {})
    expect((await app.adminOrder(placed.code)).body).toMatchObject({
      voucher: null,
      voucherCode: null,
      discount: 0,
      subtotalAfterDiscount: 2_000_000,
      lines: [{ discount: 0 }],
    })
  })

  it('lọc danh sách đơn theo mã, không phân biệt hoa thường', async () => {
    const app = await voucherOrders()
    const withVoucher = await app.order(1)
    await app.order(2, {})

    const list = await app.request
      .get('/api/admin/orders')
      .query({ status: 'all', paymentStatus: 'all', fulfillmentStatus: 'all', voucherCode: 'tet2027' })
      .set(bearer(app.token))

    expect(list.status).toBe(200)
    expect(list.body.items.map((o: { code: number }) => o.code)).toEqual([withVoucher.code])
  })

  it('chi tiết mã liệt kê đơn đã dùng, mới nhất trước; đơn đã hủy có nhưng không tính lượt', async () => {
    const app = await voucherOrders()
    const first = await app.order(1)
    const second = await app.order(2)
    await app.order(3, {})
    const cancel = await app.request.post(`/api/orders/${first.code}/cancel`).query({ token: first.token })
    expect(cancel.status).toBe(200)

    const res = await app.voucherOrderList()

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 2, page: 1 })
    expect(res.body.items).toEqual([
      expect.objectContaining({ code: second.code, status: 'pending_payment', discount: 200_000, counted: true }),
      expect.objectContaining({ code: first.code, status: 'cancelled', counted: false, email: 'khach1@example.com' }),
    ])
    const paged = await app.voucherOrderList({ page: '2', pageSize: '1' })
    expect(paged.body.items.map((o: { code: number }) => o.code)).toEqual([first.code])
    expect((await app.request.get(`/api/admin/vouchers/${app.voucherId}`).set(bearer(app.token))).body.used).toBe(1)
  })

  it('mã không tồn tại thì 404; kho xem được danh sách đơn của mã; nhân viên không có vai trò thì 403', async () => {
    const app = await voucherOrders()
    await app.order(1)
    const unknown = await app.request
      .get('/api/admin/vouchers/00000000-0000-4000-8000-000000000000/orders')
      .set(bearer(app.token))
    expect(unknown.status).toBe(404)

    const warehouse = await createStaff(app.request, app.token, ['warehouse'], 'kho@example.com')
    expect((await app.voucherOrderList({}, warehouse.accessToken)).status).toBe(200)
    await app.prisma.staff.update({ where: { id: warehouse.id }, data: { roles: [] } })
    expect((await app.voucherOrderList({}, warehouse.accessToken)).status).toBe(403)
  })
})
