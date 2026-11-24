import { describe, expect, it } from 'vitest'
import { shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN123456' }
const AGAIN = { carrier: 'Viettel Post', trackingNumber: 'VTP999' }
const TOTAL = 4_030_000

/**
 * A shop with the simulator (AM-40 with 3 pairs). `failedOrder` orders two pairs of AM-40, pays, prepares, hands over
 * (1 left) and fails delivery. Fulfillment actions use the warehouse clerk.
 */
async function failedDelivery() {
  const app = await shop({ simulator: true })
  const { request, token, checkout, v40 } = app
  const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const post = (code: number, path: string, body?: Record<string, unknown>, as = warehouse.accessToken) =>
    request.post(`/api/admin/orders/${code}/${path}`).set(bearer(as)).send(body)
  const failedOrder = async () => {
    const placed = await checkout({ lines: [{ variantId: v40.id, quantity: 2, price: 2_000_000 }] })
    expect(placed.status).toBe(201)
    const code = placed.body.code as number
    const paid = await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: TOTAL })
    expect(paid.status).toBe(204)
    expect((await post(code, 'prepare')).status).toBe(200)
    expect((await post(code, 'hand-over', SHIPMENT)).status).toBe(200)
    expect((await post(code, 'delivery-failed')).status).toBe(200)
    return code
  }
  const back = (code: number, restocked: number, writtenOff: number) =>
    post(code, 'return-to-stock', { lines: [{ variantId: v40.id, restocked, writtenOff }] })
  const stock = async () => {
    const res = await request.get('/api/admin/stock').query({ q: 'AM-40' }).set(bearer(token))
    const item = (res.body.items as { sku: string; onHand: number; reserved: number }[]).find((i) => i.sku === 'AM-40')!
    return { onHand: item.onHand, reserved: item.reserved }
  }
  const audits = async () => {
    const res = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    return (res.body.items as { action: string }[]).map((a) => a.action)
  }
  return { ...app, warehouse, sales, post, failedOrder, back, stock, audits }
}

describe('giao lại', () => {
  it('đổi đơn vị vận chuyển và mã vận đơn, quay về đã bàn giao, không đổi tồn; mã cũ còn trong lịch sử', async () => {
    const { failedOrder, post, stock, audits } = await failedDelivery()
    const code = await failedOrder()
    expect(await stock()).toEqual({ onHand: 1, reserved: 0 })

    const res = await post(code, 'redeliver', AGAIN)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ fulfillmentStatus: 'handed_over', shipment: AGAIN })
    expect(await stock()).toEqual({ onHand: 1, reserved: 0 })
    expect(res.body.history).toContainEqual(
      expect.objectContaining({
        action: 'redelivered',
        data: expect.objectContaining({ ...AGAIN, previous: SHIPMENT }),
      }),
    )
    expect(await audits()).toContain('order.redeliver')
    // Already redelivered: no second redelivery; deliver as usual.
    expect((await post(code, 'redeliver', AGAIN)).status).toBe(409)
    expect((await post(code, 'deliver')).status).toBe(200)
  })

  it('thiếu mã vận đơn thì 400; đơn chưa giao thất bại thì 409', async () => {
    const { failedOrder, post, checkout, request } = await failedDelivery()
    const code = await failedOrder()
    expect((await post(code, 'redeliver', { carrier: 'GHN' })).status).toBe(400)

    const other = (await checkout()).body.code as number
    await request.post('/api/payments/simulator/paid').send({ orderCode: other, amount: 2_030_000 })
    expect((await post(other, 'redeliver', AGAIN)).status).toBe(409)
  })
})

describe('nhận hàng hoàn về', () => {
  it('phần nhập lại tồn ghi sổ "hàng hoàn về" trỏ về đơn; phần hỏng/mất không ghi sổ; xóa thông tin vận chuyển', async () => {
    const { failedOrder, back, stock, request, token, audits } = await failedDelivery()
    const code = await failedOrder()

    const res = await back(code, 1, 1)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'processing', fulfillmentStatus: 'returned', shipment: null })
    expect(res.body.lines[0]).toMatchObject({ returnedQuantity: 1, writtenOffQuantity: 1 })
    expect(await stock()).toEqual({ onHand: 2, reserved: 0 })
    const ledger = await request.get('/api/admin/stock/movements').set(bearer(token))
    const returns = (ledger.body.items as { kind: string; quantity: number; orderCode: number | null }[]).filter(
      (m) => m.kind === 'return',
    )
    expect(returns).toEqual([expect.objectContaining({ quantity: 1, orderCode: code })])
    expect(res.body.history).toContainEqual(
      expect.objectContaining({
        action: 'returned_to_stock',
        data: expect.objectContaining({ lines: [{ sku: 'AM-40', restocked: 1, writtenOff: 1 }], ...SHIPMENT }),
      }),
    )
    expect(await audits()).toContain('order.return_to_stock')
  })

  it('tổng hai số khác số lượng, hay dòng lạ thì 400; chưa giao thất bại thì 409; không có order.fulfill thì 403', async () => {
    const { failedOrder, back, post, sales, v41 } = await failedDelivery()
    const code = await failedOrder()

    expect((await back(code, 1, 0)).status).toBe(400)
    expect((await back(code, 2, 1)).status).toBe(400)
    const wrong = await post(code, 'return-to-stock', { lines: [{ variantId: v41.id, restocked: 2, writtenOff: 0 }] })
    expect(wrong.status).toBe(400)
    expect(
      (
        await post(
          code,
          'return-to-stock',
          { lines: [{ variantId: 'x', restocked: 2, writtenOff: 0 }] },
          sales.accessToken,
        )
      ).status,
    ).toBe(403)
    expect((await back(code, 2, 0)).status).toBe(200)
    expect((await back(code, 2, 0)).status).toBe(409)
  })
})

describe('sau khi hàng hoàn về', () => {
  it('giao lại từ kho: giữ hàng lại, quay về chưa chuẩn bị, rồi chuẩn bị và bàn giao như thường', async () => {
    const { failedOrder, back, post, stock, audits } = await failedDelivery()
    const code = await failedOrder()
    expect((await back(code, 2, 0)).status).toBe(200)

    const res = await post(code, 'restock-redeliver')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ fulfillmentStatus: 'not_prepared', shipment: null })
    expect(res.body.lines[0]).toMatchObject({ returnedQuantity: 0, writtenOffQuantity: 0 })
    expect(await stock()).toEqual({ onHand: 3, reserved: 2 })
    expect(await audits()).toContain('order.restock_redeliver')
    expect((await post(code, 'prepare')).status).toBe(200)
    expect((await post(code, 'hand-over', AGAIN)).status).toBe(200)
    expect(await stock()).toEqual({ onHand: 1, reserved: 0 })
  })

  it('giao lại từ kho mà không đủ hàng thì 409, đơn giữ nguyên', async () => {
    const { failedOrder, back, post, stock } = await failedDelivery()
    const code = await failedOrder()
    expect((await back(code, 0, 2)).status).toBe(200) // both pairs lost, 1 left in stock

    const res = await post(code, 'restock-redeliver')

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual({ skus: ['AM-40'] })
    expect(await stock()).toEqual({ onHand: 1, reserved: 0 })
  })

  it('hủy: ở giao thất bại thì 409, đã nhận hàng hoàn về thì được và tồn không đổi', async () => {
    const { failedOrder, back, post, stock, sales } = await failedDelivery()
    const code = await failedOrder()
    const cancel = () => post(code, 'cancel-paid', { cause: 'delivery_failed', refundAmount: TOTAL }, sales.accessToken)

    expect((await cancel()).status).toBe(409)
    expect((await back(code, 2, 0)).status).toBe(200)
    const res = await cancel()

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'cancelled', cancelCause: 'delivery_failed', refunding: TOTAL })
    expect(await stock()).toEqual({ onHand: 3, reserved: 0 })
  })
})
