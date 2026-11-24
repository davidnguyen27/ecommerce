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
 * A shop with AM-40 (2,000,000, 3 left) and AM-41 of the same product. `sameprice(onHand)` sets AM-41 to the same price
 * and stock so it is exchangeable. `delivered()` places a guest order of 2 pairs of AM-40 and delivers it. `ask` sends
 * an exchange request via the order link.
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
  const delivered = async (quantity = 1) => {
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
  /** Accept, then the warehouse receives all the old items (restocked). */
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

    // AM-41 at 2,100,000, in stock.
    await setStock(v41, 'AM-41', 5)
    const pricier = await ask(placed)
    expect(pricier.status).toBe(409)
    expect(pricier.body.error.message).toContain('khác giá')

    // Same price but out of stock.
    expect((await editVariant(v41, 'AM-41', '41', { price: 2_000_000 })).status).toBe(200)
    await setStock(v41, 'AM-41', 0)
    const empty = await ask(placed)
    expect(empty.status).toBe(409)
    expect(empty.body.error.message).toContain('không còn đủ hàng')

    // A variant of another product.
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

    // The same variant already held.
    const same = await ask(placed, [{ variantId: v40.id, quantity: 1, toVariantId: v40.id }])
    expect(same.status).toBe(409)

    // Discontinued (no longer in the published version).
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
        returnable: 1,
        options: [expect.objectContaining({ sku: 'AM-41' })],
      }),
    ])

    const res = await ask(placed, [{ variantId: options.body.lines[0].variantId, quantity: 1, toVariantId: v41.id }])
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'exchange', lines: [{ sku: 'AM-40', quantity: 1, toSku: 'AM-41' }] })
  })
})

describe('xử lý yêu cầu đổi', () => {
  it('chấp nhận giữ hàng; bàn giao trước khi nhận hàng cũ là 409; bàn giao trừ tồn, ghi sale trỏ về đơn và yêu cầu', async () => {
    const { delivered, ask, sameprice, admin, view, stock, warehouse, mailer, request, token, v41 } =
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
    // Sales cannot hand over.
    expect((await admin(code, 'exchange-ship', SHIPMENT)).status).toBe(403)

    const shipped = await admin(code, 'exchange-ship', SHIPMENT, warehouse.accessToken)
    expect(shipped.status).toBe(200)
    expect(shipped.body).toMatchObject({ status: 'resolved', exchangeShipment: SHIPMENT })
    expect(await stock('AM-41')).toEqual({ onHand: 1, reserved: 0 })
    expect((await admin(code, 'exchange-ship', SHIPMENT, warehouse.accessToken)).status).toBe(409)

    const sale = await request.get('/api/admin/stock/movements').query({ variantId: v41.id }).set(bearer(token))
    expect(sale.body.items[0]).toMatchObject({
      kind: 'sale',
      quantity: -1,
      orderCode: placed.code,
      supportRequestCode: code,
    })

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

    expect(await flagOverdueExchanges(prisma, new Date(Date.now() + 6 * DAY))).toBe(0)
    expect(await flagOverdueExchanges(prisma, new Date(Date.now() + 8 * DAY))).toBe(1)
    expect(await flagOverdueExchanges(prisma, new Date(Date.now() + 9 * DAY))).toBe(0)

    const list = await request
      .get('/api/admin/support-requests')
      .query({ status: 'all', exchangeOverdue: 'true' })
      .set(bearer(token))
    expect(list.body.items.map((i: { code: number }) => i.code)).toEqual([code])
    const detail = await request.get(`/api/admin/support-requests/${code}`).set(bearer(token))
    expect(detail.body.exchangeOverdueAt).toEqual(expect.any(String))
    // No auto-cancel, no release.
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
    // A later AM-41 price change does not affect the refund.
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
    // The exchange is not delivered yet: the line is still taken, no more requests.
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

describe('nhân viên tạo hộ yêu cầu đổi', () => {
  it('xem biến thể đổi được của đơn và tạo hộ yêu cầu đổi; mã đơn lạ thì 400', async () => {
    const { delivered, sameprice, request, sales, v40, v41 } = await exchangeShop()
    await sameprice(2)
    const placed = await delivered()

    const options = await request
      .get('/api/admin/support-requests/exchange-options')
      .query({ orderCode: placed.code })
      .set(bearer(sales.accessToken))
    expect(options.status).toBe(200)
    expect(options.body.lines).toEqual([
      expect.objectContaining({ heldSku: 'AM-40', options: [expect.objectContaining({ sku: 'AM-41' })] }),
    ])
    const unknown = await request
      .get('/api/admin/support-requests/exchange-options')
      .query({ orderCode: 999_999 })
      .set(bearer(sales.accessToken))
    expect(unknown.status).toBe(400)

    const created = await request
      .post('/api/admin/support-requests')
      .set(bearer(sales.accessToken))
      .send({
        kind: 'exchange',
        orderCode: placed.code,
        subject: 'Khách gọi đổi size',
        message: 'Đổi sang 41',
        lines: [{ variantId: v40.id, quantity: 1, toVariantId: v41.id }],
      })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ kind: 'exchange', createdBy: 'staff', lines: [{ toSku: 'AM-41' }] })
  })
})

describe('đổi cả dòng; kết thúc sau khi nhận hàng cũ', () => {
  it('đổi một phần dòng, hay khi dòng đang có yêu cầu trả, thì 409', async () => {
    const { delivered, ask, sameprice, request, v40, v41 } = await exchangeShop()
    await sameprice(3)
    const placed = await delivered(2)
    expect((await ask(placed, [{ variantId: v40.id, quantity: 1, toVariantId: v41.id }])).status).toBe(409)
    const returned = await ask(placed, [{ variantId: v40.id, quantity: 1, reason: 'wrong_fit' }], 'return')
    expect(returned.status).toBe(201)
    expect((await ask(placed, [{ variantId: v40.id, quantity: 1, toVariantId: v41.id }])).status).toBe(409)
    const options = await request
      .get(`/api/orders/${placed.code}/support-requests/exchange-options`)
      .query({ token: placed.token })
    expect(options.body.lines[0]).toMatchObject({ returnable: 0 })
  })

  it('đã nhận hàng cũ mà chưa giao hàng đổi thì không kết thúc được yêu cầu', async () => {
    const { delivered, ask, sameprice, admin, acceptAndReceive, stock } = await exchangeShop()
    await sameprice(2)
    const code = (await ask(await delivered())).body.code as number
    await acceptAndReceive(code)
    expect((await admin(code, 'reply', { message: 'Đóng', status: 'resolved' })).status).toBe(409)
    expect((await admin(code, 'reply', { message: 'Đóng', status: 'rejected' })).status).toBe(409)
    expect(await stock('AM-41')).toEqual({ onHand: 2, reserved: 1 })
  })
})

describe('email đổi hàng', () => {
  it('nhận yêu cầu: liệt kê dòng đổi và báo cửa hàng chịu phí gửi; chấp nhận: hướng dẫn, mã yêu cầu, hạn 7 ngày', async () => {
    const { delivered, ask, sameprice, admin, mailer } = await exchangeShop()
    await sameprice(2)
    const placed = await delivered()
    const code = (await ask(placed)).body.code as number
    expect((await admin(code, 'decide', { decision: 'accepted', message: 'Gọi GHN tới lấy hàng' })).status).toBe(200)

    const mailOf = (subject: RegExp) =>
      vi.waitFor(
        () => {
          const found = mailer.sent.find((m) => subject.test(m.subject))
          if (!found) throw new Error('Chưa có thư')
          return found
        },
        { timeout: 10_000, interval: 100 },
      )
    const created = await mailOf(/Đã nhận yêu cầu/)
    expect(created.text).toContain('AM-40) × 1 → đổi sang AM-41')
    expect(created.text).toContain('Cửa hàng chịu toàn bộ phí gửi hàng')
    const accepted = await mailOf(/đã được chấp nhận/)
    expect(accepted.text).toContain('Gọi GHN tới lấy hàng')
    expect(accepted.text).toContain(`#YC${code}`)
    expect(accepted.text).toContain('trong vòng 7 ngày')
  })
})
