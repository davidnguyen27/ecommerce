import { describe, expect, it } from 'vitest'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }
const BACK = { carrier: 'Viettel Post', trackingNumber: 'VTP9' }

type AdminView = {
  code: number
  status: string
  decision: string | null
  receivedAt: string | null
  hasWarrantyCommitment: boolean | null
  warranty: {
    receivedAt: string | null
    sentAt: string | null
    returnedAt: string | null
    returnShipment: { carrier: string; trackingNumber: string } | null
    outcome: string | null
    outcomeNote: string | null
  } | null
  followUps: { code: number; kind: string }[]
  previousRequestCode: number | null
  lines: { heldSku: string; toSku: string | null; reservedQuantity: number; writtenOffQuantity: number }[]
  returnRefund: { suggested: number } | null
}

/**
 * Cửa hàng có AM-40 (2.000.000, còn 3). `delivered()` đặt đơn vãng lai một đôi rồi giao xong. `ask` gửi yêu cầu bảo hành
 * qua link đơn; `milestone`/`outcome` là thao tác của nhân viên bán hàng.
 */
async function warrantyShop() {
  const app = await shop({ simulator: true })
  const { request, token, checkout, v40 } = app
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
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
  const ask = async (placed: { code: number; token: string }, quantity = 1) => {
    const res = await request
      .post(`/api/orders/${placed.code}/support-requests`)
      .query({ token: placed.token })
      .send({
        kind: 'warranty',
        subject: 'Giày bong keo',
        message: 'Đế bong sau 2 tuần',
        lines: [{ variantId: v40.id, quantity }],
      })
    return res
  }
  const admin = (code: number, path: string, body?: Record<string, unknown>, as = sales.accessToken) =>
    request.post(`/api/admin/support-requests/${code}/${path}`).set(bearer(as)).send(body)
  const view = async (code: number) =>
    (await request.get(`/api/admin/support-requests/${code}`).set(bearer(token))).body as AdminView
  const stock = async () => {
    const res = await request.get('/api/admin/stock').query({ q: 'AM-40' }).set(bearer(token))
    const item = (res.body.items as { sku: string; onHand: number; reserved: number }[]).find((i) => i.sku === 'AM-40')!
    return { onHand: item.onHand, reserved: item.reserved }
  }
  return { ...app, sales, warehouse, delivered, ask, admin, view, stock }
}

describe('gửi yêu cầu bảo hành', () => {
  it('một dòng của đơn đã giao; nhân viên thấy sản phẩm không có cam kết bảo hành, có cam kết thì hết cảnh báo', async () => {
    const { delivered, ask, view, prisma, product, checkout, v40 } = await warrantyShop()
    const placed = await delivered()
    const created = await ask(placed)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      kind: 'warranty',
      lines: [{ sku: 'AM-40', quantity: 1 }],
      warranty: { receivedAt: null, outcome: null },
    })
    const code = created.body.code as number
    expect((await view(code)).hasWarrantyCommitment).toBe(false)

    const type = await prisma.commitmentType.findFirstOrThrow({ where: { kind: 'warranty' } })
    await prisma.productCommitment.create({
      data: { productId: product.id, typeId: type.id, statement: 'Bảo hành chính hãng 12 tháng' },
    })
    expect((await view(code)).hasWarrantyCommitment).toBe(true)

    // Quá số lượng của dòng, hay nhiều dòng: không gửi được.
    const tooMany = await ask(placed, 2)
    expect(tooMany.status).toBe(400)
    // Đơn chưa giao (chưa thanh toán): 409.
    const notDelivered = await checkout({
      lines: [{ variantId: v40.id, quantity: 1, price: 2_000_000 }],
      address: { ...ADDRESS, email: 'moi@example.com', phone: '0900000099' },
    })
    expect(notDelivered.status).toBe(201)
    expect((await ask(notDelivered.body)).status).toBe(409)
  })
})

describe('mốc và kết quả bảo hành', () => {
  it('mốc theo thứ tự (sai thì 409), không đụng tới tồn; sửa xong cần đã trả lại khách', async () => {
    const { delivered, ask, admin, stock, warehouse, request } = await warrantyShop()
    const placed = await delivered()
    const code = (await ask(placed)).body.code as number
    const before = await stock()

    expect((await admin(code, 'warranty-milestone', { milestone: 'sent' })).status).toBe(409)
    expect((await admin(code, 'warranty-milestone', { milestone: 'returned', ...BACK })).status).toBe(409)
    expect((await admin(code, 'warranty-outcome', { outcome: 'repaired' })).status).toBe(409)
    // Kho không có quyền ghi mốc.
    expect((await admin(code, 'warranty-milestone', { milestone: 'received' }, warehouse.accessToken)).status).toBe(403)
    expect((await admin(code, 'warranty-milestone', { milestone: 'returned' })).status).toBe(400)

    expect((await admin(code, 'warranty-milestone', { milestone: 'received' })).status).toBe(200)
    expect((await admin(code, 'warranty-milestone', { milestone: 'received' })).status).toBe(409)
    expect((await admin(code, 'warranty-milestone', { milestone: 'sent' })).status).toBe(200)
    expect((await admin(code, 'warranty-milestone', { milestone: 'returned', ...BACK })).status).toBe(200)
    expect(await stock()).toEqual(before)

    const done = await admin(code, 'warranty-outcome', { outcome: 'repaired' })
    expect(done.status).toBe(200)
    expect(done.body).toMatchObject({
      status: 'resolved',
      warranty: { returnShipment: BACK, outcome: 'repaired' },
      followUps: [],
    })
    expect(await stock()).toEqual(before)
    expect((await admin(code, 'warranty-outcome', { outcome: 'repaired' })).status).toBe(409)

    const customer = await request
      .get(`/api/orders/${placed.code}/support-requests/${code}`)
      .query({ token: placed.token })
    expect(customer.body.warranty).toMatchObject({ outcome: 'repaired', returnShipment: BACK })
  })

  it('từ chối cần lý do (400 nếu thiếu); yêu cầu thành rejected', async () => {
    const { delivered, ask, admin, view } = await warrantyShop()
    const code = (await ask(await delivered())).body.code as number
    expect((await admin(code, 'warranty-outcome', { outcome: 'rejected' })).status).toBe(400)
    const rejected = await admin(code, 'warranty-outcome', {
      outcome: 'rejected',
      note: 'Lỗi do sử dụng, ngoài bảo hành',
    })
    expect(rejected.status).toBe(200)
    expect((await view(code)).warranty).toMatchObject({
      outcome: 'rejected',
      outcomeNote: 'Lỗi do sử dụng, ngoài bảo hành',
    })
    expect((await view(code)).status).toBe('rejected')
  })

  it('đổi mới: tạo yêu cầu đổi cùng biến thể, đã chấp nhận, đã nhận hàng, giữ hàng; kho chỉ còn bàn giao', async () => {
    const { delivered, ask, admin, view, stock, warehouse } = await warrantyShop()
    const placed = await delivered()
    const code = (await ask(placed)).body.code as number
    // Chưa nhận hàng của khách thì chưa đổi mới được.
    expect((await admin(code, 'warranty-outcome', { outcome: 'replaced' })).status).toBe(409)
    expect((await admin(code, 'warranty-milestone', { milestone: 'received' })).status).toBe(200)
    const before = await stock()

    const replaced = await admin(code, 'warranty-outcome', { outcome: 'replaced' })
    expect(replaced.status).toBe(200)
    expect(replaced.body).toMatchObject({ status: 'resolved', warranty: { outcome: 'replaced' } })
    expect(replaced.body.followUps).toEqual([{ code: expect.any(Number), kind: 'exchange' }])
    const followCode = replaced.body.followUps[0].code as number
    const follow = await view(followCode)
    expect(follow).toMatchObject({
      status: 'in_progress',
      decision: 'accepted',
      receivedAt: expect.any(String),
      previousRequestCode: code,
      lines: [{ heldSku: 'AM-40', toSku: 'AM-40', reservedQuantity: 1, writtenOffQuantity: 1 }],
    })
    expect(await stock()).toEqual({ onHand: before.onHand, reserved: before.reserved + 1 })

    const shipped = await admin(followCode, 'exchange-ship', BACK, warehouse.accessToken)
    expect(shipped.status).toBe(200)
    expect(await stock()).toEqual({ onHand: before.onHand - 1, reserved: before.reserved })
  })

  it('hoàn tiền: tạo yêu cầu trả đã chấp nhận, đã nhận hàng; nhân viên đề xuất hoàn theo giá dòng', async () => {
    const { delivered, ask, admin, view, stock } = await warrantyShop()
    const code = (await ask(await delivered())).body.code as number
    expect((await admin(code, 'warranty-milestone', { milestone: 'received' })).status).toBe(200)
    const before = await stock()

    const refunded = await admin(code, 'warranty-outcome', { outcome: 'refunded', note: 'Hãng xác nhận lỗi' })
    expect(refunded.status).toBe(200)
    expect(refunded.body.followUps).toEqual([{ code: expect.any(Number), kind: 'return' }])
    const followCode = refunded.body.followUps[0].code as number
    expect(await view(followCode)).toMatchObject({
      status: 'in_progress',
      decision: 'accepted',
      receivedAt: expect.any(String),
      returnRefund: { suggested: 2_000_000 },
    })
    // Hàng lỗi ghi hỏng, không nhập lại tồn.
    expect(await stock()).toEqual(before)
    const proposed = await admin(followCode, 'refund', { refundAmount: 2_000_000 })
    expect(proposed.status).toBe(200)
    expect(proposed.body.refunds).toEqual([expect.objectContaining({ amount: 2_000_000 })])
  })

  it('hàng mới không đủ để đổi thì 409, không tạo gì; dòng đã trả hết thì không đổi hay hoàn tiếp được', async () => {
    const { delivered, ask, admin, view, prisma } = await warrantyShop()
    const placed = await delivered()
    const code = (await ask(placed)).body.code as number
    expect((await admin(code, 'warranty-milestone', { milestone: 'received' })).status).toBe(200)
    await prisma.productVariant.updateMany({ where: { sku: 'AM-40' }, data: { reserved: { increment: 2 } } })

    expect((await admin(code, 'warranty-outcome', { outcome: 'replaced' })).status).toBe(409)
    expect(await view(code)).toMatchObject({ status: 'in_progress', followUps: [], warranty: { outcome: null } })

    const refunded = await admin(code, 'warranty-outcome', { outcome: 'refunded' })
    expect(refunded.status).toBe(200)
    const second = (await ask(placed)).body.code as number
    expect((await admin(second, 'warranty-milestone', { milestone: 'received' })).status).toBe(200)
    expect((await admin(second, 'warranty-outcome', { outcome: 'refunded' })).status).toBe(409)
  })
})
