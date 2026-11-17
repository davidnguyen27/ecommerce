import { describe, expect, it, vi } from 'vitest'
import { flagOverdueExchanges } from '../src/support/exchanges.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { adjust } from './support/stock.ts'
import { bearer, createStaff } from './support/staff.ts'

const DAY = 24 * 60 * 60_000
const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }

type AdminView = {
  code: number
  status: string
  receivedAt: string | null
  lines: { id: string; quantity: number; heldSku: string; toSku: string | null; reservedQuantity: number }[]
  exchangeShipment: { carrier: string; trackingNumber: string } | null
  exchangeOverdueAt: string | null
  returnRefund: { suggested: number } | null
}

/**
 * Cửa hàng có AM-40 (2.000.000, còn 3) và AM-41 cùng sản phẩm. `sameprice(onHand)` đưa AM-41 về cùng giá và đặt tồn để
 * đổi được. `delivered()` đặt đơn vãng lai 2 đôi AM-40 rồi giao xong. `ask` gửi yêu cầu đổi qua link đơn.
 */
async function exchangeShop() {
  const app = await shop({ simulator: true })
  const { request, token, checkout, v40, v41, editVariant } = app
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
  const setStock = async (variant: { id: string }, sku: string, countedQuantity: number) => {
    const current = await stock(sku)
    const res = await adjust(request, token, {
      variantId: variant.id,
      reason: 'stocktake',
      countedQuantity,
      expectedOnHand: current.onHand,
    })
    expect(res.status).toBe(201)
  }
  const sameprice = async (onHand: number) => {
    expect((await editVariant(v41, 'AM-41', '41', { price: 2_000_000 })).status).toBe(200)
    await setStock(v41, 'AM-41', onHand)
  }
  let n = 0
  const delivered = async (quantity = 2) => {
    n += 1
    const res = await checkout({
      lines: [{ variantId: v40.id, quantity, price: 2_000_000 }],
      address: { ...ADDRESS, email: `khach${n}@example.com`, phone: `09000000${String(n).padStart(2, '0')}` },
    })
    expect(res.status).toBe(201)
    const placed = res.body as { code: number; token: string }
    const detail = await request.get(`/api/orders/${placed.code}`).query({ token: placed.token })
    await request.post('/api/payments/simulator/paid').send({ orderCode: placed.code, amount: detail.body.total })
    for (const [path, b] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      const step = await request.post(`/api/admin/orders/${placed.code}/${path}`).set(bearer(token)).send(b)
      expect(step.status).toBe(200)
    }
    return placed
  }
  const ask = (
    placed: { code: number; token: string },
    lines: Record<string, unknown>[] = [{ variantId: v40.id, quantity: 1, toVariantId: v41.id }],
    kind = 'exchange',
  ) =>
    request
      .post(`/api/orders/${placed.code}/support-requests`)
      .query({ token: placed.token })
      .send({ kind, subject: 'Đổi size', message: 'Chật quá', lines })
  const admin = (code: number, path: string, body?: Record<string, unknown>, as = sales.accessToken) =>
    request.post(`/api/admin/support-requests/${code}/${path}`).set(bearer(as)).send(body)
  const view = async (code: number) =>
    (await request.get(`/api/admin/support-requests/${code}`).set(bearer(token))).body as AdminView
  const stock = async (sku: string) => {
    const res = await request.get('/api/admin/stock').query({ q: sku }).set(bearer(token))
    const item = (res.body.items as { sku: string; onHand: number; reserved: number }[]).find((i) => i.sku === sku)!
    return { onHand: item.onHand, reserved: item.reserved }
  }
  /** Chấp nhận rồi kho nhận đủ hàng cũ về (nhập lại tồn). */
  const acceptAndReceive = async (code: number) => {
    expect((await admin(code, 'decide', { decision: 'accepted', message: 'Gửi về giúp shop' })).status).toBe(200)
    const lines = (await view(code)).lines.map((l) => ({ lineId: l.id, restocked: l.quantity, writtenOff: 0 }))
    const received = await admin(code, 'receive', { lines }, warehouse.accessToken)
    expect(received.status).toBe(200)
  }
  return { ...app, sales, warehouse, sameprice, setStock, delivered, ask, admin, view, stock, acceptAndReceive }
}

describe('gửi yêu cầu đổi hàng', () => {
  it('biến thể khác giá, khác sản phẩm, ngừng bán hay hết hàng: 409 kèm lý do', async () => {
    const { delivered, ask, editVariant, setStock, request, token, brand, category, product, v40, v41 } =
      await exchangeShop()
    const placed = await delivered()

    // AM-41 giá 2.100.000, còn hàng.
    await setStock(v41, 'AM-41', 5)
    const pricier = await ask(placed)
    expect(pricier.status).toBe(409)
    expect(pricier.body.error.message).toContain('khác giá')

    // Cùng giá nhưng hết hàng.
    expect((await editVariant(v41, 'AM-41', '41', { price: 2_000_000 })).status).toBe(200)
    await setStock(v41, 'AM-41', 0)
    const empty = await ask(placed)
    expect(empty.status).toBe(409)
    expect(empty.body.error.message).toContain('không còn đủ hàng')

    // Biến thể của sản phẩm khác.
    const other = await request
      .post('/api/admin/products')
      .set(bearer(token))
      .send({
        brandId: brand.id,
        categoryId: category.id,
        name: 'Pegasus',
        slug: 'pegasus',
        attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
      })
    const foreign = await request
      .post(`/api/admin/products/${other.body.id}/variants`)
      .set(bearer(token))
      .send({ sku: 'PG-40', attributes: { mau: 'Đen', size: '40' }, price: 2_000_000 })
    expect(foreign.status).toBe(201)
    const crossed = await ask(placed, [{ variantId: v40.id, quantity: 1, toVariantId: foreign.body.id }])
    expect(crossed.status).toBe(409)
    expect(crossed.body.error.message).toContain('cùng sản phẩm')

    // Trùng biến thể đang giữ.
    const same = await ask(placed, [{ variantId: v40.id, quantity: 1, toVariantId: v40.id }])
    expect(same.status).toBe(409)

    // Ngừng bán (không còn trong phiên bản đang xuất bản).
    await setStock(v41, 'AM-41', 5)
    expect((await editVariant(v41, 'AM-41', '41', { price: 2_000_000, status: 'discontinued' })).status).toBe(200)
    const republish = await request
      .put(`/api/admin/products/${product.id}/status`)
      .set(bearer(token))
      .send({ status: 'published' })
    expect(republish.status).toBe(200)
    const stopped = await ask(placed)
    expect(stopped.status).toBe(409)
    expect(stopped.body.error.message).toContain('không còn bán')
  })

  it('đổi được: tạo yêu cầu có biến thể đổi sang; trang khách thấy lựa chọn đổi được', async () => {
    const { delivered, ask, sameprice, request, v41 } = await exchangeShop()
    await sameprice(2)
    const placed = await delivered()

    const options = await request
      .get(`/api/orders/${placed.code}/support-requests/exchange-options`)
      .query({ token: placed.token })
    expect(options.status).toBe(200)
    expect(options.body.lines).toEqual([
      expect.objectContaining({
        heldSku: 'AM-40',
        returnable: 2,
        options: [expect.objectContaining({ sku: 'AM-41' })],
      }),
    ])

    const res = await ask(placed, [{ variantId: options.body.lines[0].variantId, quantity: 2, toVariantId: v41.id }])
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'exchange', lines: [{ sku: 'AM-40', quantity: 2, toSku: 'AM-41' }] })
  })
})

describe('xử lý yêu cầu đổi', () => {
  it('chấp nhận giữ hàng; bàn giao trước khi nhận hàng cũ là 409; bàn giao trừ tồn, ghi sale trỏ về đơn và yêu cầu', async () => {
    const { delivered, ask, sameprice, admin, view, stock, warehouse, prisma, mailer, request, token } =
      await exchangeShop()
    await sameprice(2)
    const placed = await delivered()
    const { code } = (await ask(placed)).body as { code: number }

    expect((await admin(code, 'decide', { decision: 'accepted', message: 'Gửi về giúp shop' })).status).toBe(200)
    expect(await stock('AM-41')).toEqual({ onHand: 2, reserved: 1 })
    expect((await view(code)).lines[0]).toMatchObject({ toSku: 'AM-41', reservedQuantity: 1 })

    expect((await admin(code, 'exchange-ship', SHIPMENT, warehouse.accessToken)).status).toBe(409)

    const lineId = (await view(code)).lines[0]!.id
    const received = await admin(
      code,
      'receive',
      { lines: [{ lineId, restocked: 1, writtenOff: 0 }] },
      warehouse.accessToken,
    )
    expect(received.status).toBe(200)
    expect(received.body.returnRefund).toBeNull()
    // Bán hàng không bàn giao được.
    expect((await admin(code, 'exchange-ship', SHIPMENT)).status).toBe(403)

    const shipped = await admin(code, 'exchange-ship', SHIPMENT, warehouse.accessToken)
    expect(shipped.status).toBe(200)
    expect(shipped.body).toMatchObject({ status: 'resolved', exchangeShipment: SHIPMENT })
    expect(await stock('AM-41')).toEqual({ onHand: 1, reserved: 0 })
    expect((await admin(code, 'exchange-ship', SHIPMENT, warehouse.accessToken)).status).toBe(409)

    const request_ = await prisma.supportRequest.findUniqueOrThrow({ where: { code } })
    const order = await prisma.order.findUniqueOrThrow({ where: { code: placed.code } })
    const sale = await prisma.stockMovement.findMany({ where: { supportRequestId: request_.id, kind: 'sale' } })
    expect(sale).toEqual([expect.objectContaining({ quantity: -1, orderId: order.id })])

    const customer = await request
      .get(`/api/orders/${placed.code}/support-requests/${code}`)
      .query({ token: placed.token })
    expect(customer.body.exchangeShipment).toMatchObject(SHIPMENT)
    await vi.waitFor(
      () => {
        if (!mailer.sent.some((m) => m.text.includes('GHN1'))) throw new Error('Chưa có thư kèm mã vận đơn')
      },
      { timeout: 10_000, interval: 100 },
    )
    const audits = await request.get('/api/admin/audit').set(bearer(token))
    expect((audits.body.items as { action: string }[]).map((a) => a.action)).toContain('support.exchange_ship')
  })

  it('giữ không đủ lúc chấp nhận thì 409 và không giữ gì', async () => {
    const { delivered, ask, sameprice, setStock, admin, stock, v41 } = await exchangeShop()
    await sameprice(1)
    const placed = await delivered()
    const { code } = (await ask(placed)).body as { code: number }
    await setStock(v41, 'AM-41', 0)

    const accepted = await admin(code, 'decide', { decision: 'accepted', message: 'Gửi về giúp shop' })
    expect(accepted.status).toBe(409)
    expect(await stock('AM-41')).toEqual({ onHand: 0, reserved: 0 })
  })

  it('đóng (từ chối) yêu cầu đã chấp nhận mà chưa giao thì nhả hàng giữ', async () => {
    const { delivered, ask, sameprice, admin, stock, view } = await exchangeShop()
    await sameprice(2)
    const placed = await delivered()
    const { code } = (await ask(placed)).body as { code: number }
    expect((await admin(code, 'decide', { decision: 'accepted', message: 'Gửi về giúp shop' })).status).toBe(200)
    expect(await stock('AM-41')).toEqual({ onHand: 2, reserved: 1 })

    const closed = await admin(code, 'reply', { message: 'Bạn không gửi hàng, shop đóng yêu cầu', status: 'rejected' })
    expect(closed.status).toBe(200)
    expect(await stock('AM-41')).toEqual({ onHand: 2, reserved: 0 })
    expect((await view(code)).lines[0]!.reservedQuantity).toBe(0)
  })

  it('job gắn cờ yêu cầu đã chấp nhận quá 14 ngày chưa nhận hàng; danh sách admin lọc được', async () => {
    const { delivered, ask, sameprice, admin, prisma, request, token } = await exchangeShop()
    await sameprice(2)
    const placed = await delivered()
    const { code } = (await ask(placed)).body as { code: number }
    expect((await admin(code, 'decide', { decision: 'accepted', message: 'Gửi về giúp shop' })).status).toBe(200)

    expect(await flagOverdueExchanges(prisma, new Date(Date.now() + 13 * DAY))).toBe(0)
    expect(await flagOverdueExchanges(prisma, new Date(Date.now() + 15 * DAY))).toBe(1)
    expect(await flagOverdueExchanges(prisma, new Date(Date.now() + 16 * DAY))).toBe(0)

    const list = await request
      .get('/api/admin/support-requests')
      .query({ status: 'all', exchangeOverdue: 'true' })
      .set(bearer(token))
    expect(list.body.items.map((i: { code: number }) => i.code)).toEqual([code])
    const detail = await request.get(`/api/admin/support-requests/${code}`).set(bearer(token))
    expect(detail.body.exchangeOverdueAt).toEqual(expect.any(String))
    // Không tự hủy, không nhả hàng.
    expect(detail.body.status).toBe('in_progress')
  })
})

describe('trả hay đổi tiếp sau khi đã đổi', () => {
  it('trả tiếp: nhận về đúng biến thể đã đổi, hoàn theo giá dòng gốc', async () => {
    const { delivered, ask, sameprice, admin, view, stock, warehouse, acceptAndReceive, v40, v41, editVariant } =
      await exchangeShop()
    await sameprice(2)
    const placed = await delivered(1)
    const { code } = (await ask(placed)).body as { code: number }
    await acceptAndReceive(code)
    expect((await admin(code, 'exchange-ship', SHIPMENT, warehouse.accessToken)).status).toBe(200)
    // Giá AM-41 đổi sau đó không ảnh hưởng số hoàn.
    expect((await editVariant(v41, 'AM-41', '41', { price: 2_100_000 })).status).toBe(200)

    const ret = await ask(placed, [{ variantId: v40.id, quantity: 1, reason: 'wrong_fit' }], 'return')
    expect(ret.status).toBe(201)
    const returnCode = ret.body.code as number
    expect((await view(returnCode)).lines[0]).toMatchObject({ heldSku: 'AM-41' })
    const before = await stock('AM-41')
    await acceptAndReceive(returnCode)
    expect(await stock('AM-41')).toEqual({ onHand: before.onHand + 1, reserved: before.reserved })
    expect((await view(returnCode)).returnRefund).toMatchObject({ suggested: 2_000_000 })
  })

  it('đổi tiếp: biến thể đang giữ là biến thể đã đổi, đổi ngược về biến thể gốc được', async () => {
    const { delivered, ask, sameprice, admin, view, warehouse, acceptAndReceive, v40, request } = await exchangeShop()
    await sameprice(2)
    const placed = await delivered(1)
    const { code } = (await ask(placed)).body as { code: number }
    // Chưa giao hàng đổi: dòng vẫn bị chiếm, không gửi thêm được.
    expect((await ask(placed)).status).toBe(409)
    await acceptAndReceive(code)
    expect((await admin(code, 'exchange-ship', SHIPMENT, warehouse.accessToken)).status).toBe(200)

    const options = await request
      .get(`/api/orders/${placed.code}/support-requests/exchange-options`)
      .query({ token: placed.token })
    expect(options.body.lines[0]).toMatchObject({ heldSku: 'AM-41', returnable: 1 })
    expect(options.body.lines[0].options).toEqual([expect.objectContaining({ sku: 'AM-40' })])

    const back = await ask(placed, [{ variantId: v40.id, quantity: 1, toVariantId: v40.id }])
    expect(back.status).toBe(201)
    expect((await view(back.body.code)).lines[0]).toMatchObject({ heldSku: 'AM-41', toSku: 'AM-40' })
  })
})
