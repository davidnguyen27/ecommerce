import { describe, expect, it } from 'vitest'
import { shop } from './support/shop.ts'
import { OWNER, bearer, createStaff } from './support/staff.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN123456' }

/** Cửa hàng có cổng giả lập; `paidOrder` đặt hai đôi AM-40 và trả đủ tiền. */
async function fulfillment() {
  const app = await shop({ simulator: true })
  const { request, token, checkout, v40 } = app
  const place = async () => {
    const res = await checkout({ lines: [{ variantId: v40.id, quantity: 2, price: 2_000_000 }] })
    expect(res.status).toBe(201)
    return res.body.code as number
  }
  const paidOrder = async () => {
    const code = await place()
    const paid = await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: 4_030_000 })
    expect(paid.status).toBe(204)
    return code
  }
  const prepare = (code: number, as = token) => request.post(`/api/admin/orders/${code}/prepare`).set(bearer(as))
  const handOver = (code: number, body: Record<string, unknown> = SHIPMENT, as = token) =>
    request.post(`/api/admin/orders/${code}/hand-over`).set(bearer(as)).send(body)
  const stock = async () => {
    const res = await request.get('/api/admin/stock').query({ q: 'AM-40' }).set(bearer(token))
    const { onHand, reserved } = res.body.items[0] as { onHand: number; reserved: number }
    return { onHand, reserved }
  }
  return { ...app, place, paidOrder, prepare, handOver, stock }
}

describe('chuẩn bị và bàn giao vận chuyển', () => {
  it('bàn giao trừ cả tồn và số đang giữ, sổ có dòng xuất bán tham chiếu tới đơn', async () => {
    const { paidOrder, prepare, handOver, stock, request, token, v40 } = await fulfillment()
    const code = await paidOrder()
    expect(await stock()).toEqual({ onHand: 3, reserved: 2 })

    const prepared = await prepare(code)
    expect(prepared.status).toBe(200)
    expect(prepared.body).toMatchObject({ code, fulfillmentStatus: 'preparing', shipment: null })
    expect(await stock()).toEqual({ onHand: 3, reserved: 2 })

    const handed = await handOver(code)
    expect(handed.status).toBe(200)
    expect(handed.body).toMatchObject({
      code,
      status: 'processing',
      fulfillmentStatus: 'handed_over',
      shipment: { ...SHIPMENT, handedOverAt: expect.any(String) },
    })
    expect(await stock()).toEqual({ onHand: 1, reserved: 0 })

    const movements = await request.get('/api/admin/stock/movements').query({ kind: 'sale' }).set(bearer(token))
    expect(movements.body.items).toEqual([
      expect.objectContaining({
        kind: 'sale',
        quantity: -2,
        onHandAfter: 1,
        orderCode: code,
        variant: { id: v40.id, sku: 'AM-40' },
      }),
    ])
  })

  it('bàn giao thiếu đơn vị vận chuyển hay mã vận đơn thì 400 theo trường, tồn không đổi', async () => {
    const { paidOrder, prepare, handOver, stock } = await fulfillment()
    const code = await paidOrder()
    await prepare(code)

    const res = await handOver(code, { carrier: 'GHN', trackingNumber: '   ' })
    const empty = await handOver(code, {})

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([expect.objectContaining({ path: 'trackingNumber' })])
    expect(empty.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual(['carrier', 'trackingNumber'])
    expect(await stock()).toEqual({ onHand: 3, reserved: 2 })
  })

  it('sai cạnh trạng thái giao hàng thì 409', async () => {
    const { paidOrder, prepare, handOver, stock } = await fulfillment()
    const code = await paidOrder()

    expect((await handOver(code)).status).toBe(409)
    expect((await prepare(code)).status).toBe(200)
    expect((await prepare(code)).status).toBe(409)
    expect((await handOver(code)).status).toBe(200)
    expect((await handOver(code)).status).toBe(409)
    expect((await prepare(code)).status).toBe(409)
    expect(await stock()).toEqual({ onHand: 1, reserved: 0 })
  })

  it('đơn chưa trả tiền hay đã hủy thì không chuẩn bị được; mã lạ 404', async () => {
    const { place, prepare, request, token } = await fulfillment()
    // Đặt và hủy trước để còn đủ hàng cho đơn chưa trả (mỗi đơn hai đôi, tồn ba đôi).
    const cancelled = await place()
    await request.post(`/api/admin/orders/${cancelled}/cancel`).set(bearer(token))
    const unpaid = await place()

    expect((await prepare(unpaid)).status).toBe(409)
    expect((await prepare(cancelled)).status).toBe(409)
    expect((await prepare(999999)).status).toBe(404)
    const order = await request.get(`/api/admin/orders/${unpaid}`).set(bearer(token))
    expect(order.body.fulfillmentStatus).toBe('not_prepared')
  })

  it('cần quyền order.fulfill: bán hàng không chuẩn bị, không bàn giao được; kho thì được', async () => {
    const { paidOrder, prepare, handOver, request, token } = await fulfillment()
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
    const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
    const code = await paidOrder()

    expect((await prepare(code, sales.accessToken)).status).toBe(403)
    expect((await prepare(code, warehouse.accessToken)).status).toBe(200)
    expect((await handOver(code, SHIPMENT, sales.accessToken)).status).toBe(403)
    expect((await handOver(code, SHIPMENT, warehouse.accessToken)).status).toBe(200)
  })

  it('mỗi thao tác ghi audit và sự kiện đơn, hiện trong lịch sử thao tác', async () => {
    const { paidOrder, prepare, handOver, request, token } = await fulfillment()
    const code = await paidOrder()
    await prepare(code)
    const res = await handOver(code)

    const staffActor = expect.objectContaining({ type: 'staff', email: OWNER.email })
    expect(res.body.history.slice(-4)).toEqual([
      expect.objectContaining({ source: 'event', action: 'preparing', actor: staffActor }),
      expect.objectContaining({
        source: 'audit',
        action: 'order.prepare',
        actor: staffActor,
        data: { before: { fulfillmentStatus: 'not_prepared' }, after: { fulfillmentStatus: 'preparing' } },
      }),
      expect.objectContaining({ source: 'event', action: 'handed_over', actor: staffActor, data: SHIPMENT }),
      expect.objectContaining({
        source: 'audit',
        action: 'order.hand_over',
        actor: staffActor,
        data: { before: { fulfillmentStatus: 'preparing' }, after: { fulfillmentStatus: 'handed_over', ...SHIPMENT } },
      }),
    ])
    const audit = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(['order.hand_over', 'order.prepare'])
  })

  it('đơn đã bàn giao không còn giữ hàng: hạ tồn về 0 bằng kiểm kê được', async () => {
    const { paidOrder, prepare, handOver, request, token, v40, stock } = await fulfillment()
    const code = await paidOrder()
    await prepare(code)
    await handOver(code)

    const res = await request
      .post('/api/admin/stock/adjustments')
      .set(bearer(token))
      .send({ variantId: v40.id, reason: 'stocktake', countedQuantity: 0, expectedOnHand: 1 })

    expect(res.status).toBe(201)
    expect(await stock()).toEqual({ onHand: 0, reserved: 0 })
  })
})
