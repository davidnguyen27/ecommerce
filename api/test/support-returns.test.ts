import { describe, expect, it, vi } from 'vitest'
import { returnWindowSnapshot } from '../src/support/returns.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const DAY = 24 * 60 * 60_000
const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }

type AdminView = {
  code: number
  status: string
  decision: string | null
  receivedAt: string | null
  lines: { id: string; quantity: number; restockedQuantity: number; writtenOffQuantity: number; heldSku: string }[]
  returnWindow: { days: number | null; deliveredAt: string | null; overdueDays: number | null } | null
  returnRefund: { suggested: number; refundable: number } | null
  refunds: { id: string; amount: number; status: string }[]
}

/**
 * Cửa hàng có cổng giả lập (AM-40 giá 2.000.000, còn 3 đôi), một nhân viên bán hàng và một nhân viên kho.
 * `delivered(quantity, body)` đặt đơn vãng lai, trả đủ, chuẩn bị, bàn giao, đã giao. `ask` gửi yêu cầu trả qua link đơn.
 */
async function returnShop() {
  const app = await shop({ simulator: true })
  const { request, token, checkout, v40 } = app
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
  let n = 0
  const order = async (quantity = 2, body: Record<string, unknown> = {}) => {
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
  const step = (code: number, path: string, body?: Record<string, unknown>) =>
    request.post(`/api/admin/orders/${code}/${path}`).set(bearer(token)).send(body)
  const delivered = async (quantity = 2, body: Record<string, unknown> = {}) => {
    const placed = await order(quantity, body)
    for (const [path, b] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      expect((await step(placed.code, path, b)).status).toBe(200)
    }
    return placed
  }
  const ask = (
    placed: { code: number; token: string },
    lines: Record<string, unknown>[] = [{ variantId: v40.id, quantity: 1, reason: 'wrong_fit' }],
  ) =>
    request
      .post(`/api/orders/${placed.code}/support-requests`)
      .query({ token: placed.token })
      .send({ kind: 'return', subject: 'Trả giày', message: 'Không vừa', lines })
  const admin = (code: number, path: string, body?: Record<string, unknown>, as = sales.accessToken) =>
    request.post(`/api/admin/support-requests/${code}/${path}`).set(bearer(as)).send(body)
  const view = async (code: number) =>
    (await request.get(`/api/admin/support-requests/${code}`).set(bearer(token))).body as AdminView
  const stock = async () => {
    const res = await request.get('/api/admin/stock').query({ q: 'AM-40' }).set(bearer(token))
    const item = (res.body.items as { sku: string; onHand: number; reserved: number }[]).find((i) => i.sku === 'AM-40')!
    return { onHand: item.onHand, reserved: item.reserved }
  }
  const audits = async () =>
    ((await request.get('/api/admin/audit').set(bearer(token))).body.items as { action: string }[]).map((a) => a.action)
  return { ...app, sales, warehouse, order, delivered, ask, admin, view, stock, audits, step }
}

describe('gửi yêu cầu trả hàng', () => {
  it('đơn đã giao: gửi được, có dòng và hạn đổi trả chụp lúc gửi', async () => {
    const { delivered, ask, view, request, sales } = await returnShop()
    await request
      .put('/api/admin/return-windows')
      .set(bearer(sales.accessToken))
      .send({ items: [{ productType: 'footwear', days: 7 }] })
    const placed = await delivered()

    const res = await ask(placed)

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      kind: 'return',
      status: 'new',
      decision: null,
      lines: [{ sku: 'AM-40', quantity: 1, reason: 'wrong_fit' }],
    })
    expect((await view(res.body.code)).returnWindow).toMatchObject({
      days: 7,
      deliveredAt: expect.any(String),
      overdueDays: 0,
    })
  })

  it('quá hạn đổi trả: số ngày đã quá tính từ lúc giao (sự kiện đơn chỉ ghi thêm nên dời "bây giờ" về sau)', async () => {
    const { delivered, request, sales, prisma } = await returnShop()
    await request
      .put('/api/admin/return-windows')
      .set(bearer(sales.accessToken))
      .send({ items: [{ productType: 'footwear', days: 7 }] })
    const placed = await delivered()
    const order = await prisma.order.findUniqueOrThrow({ where: { code: placed.code }, include: { lines: true } })
    const lines = order.lines.map((l) => ({ orderLineId: l.id }))
    const at = (days: number) => new Date(Date.now() + days * DAY + 60_000)

    expect(await returnWindowSnapshot(prisma, order.id, lines, at(5))).toMatchObject({ days: 7, overdueDays: 0 })
    expect(await returnWindowSnapshot(prisma, order.id, lines, at(10))).toMatchObject({
      days: 7,
      deliveredAt: expect.any(Date),
      overdueDays: 3,
    })
  })

  it('nhóm hàng không cấu hình thì không có số ngày, không cảnh báo', async () => {
    const { delivered, ask, view } = await returnShop()
    const res = await ask(await delivered())
    expect((await view(res.body.code)).returnWindow).toMatchObject({ days: null, overdueDays: null })
  })

  it('đơn chưa giao thì 409; sản phẩm không có trong đơn thì 400; vượt số còn trả được thì 409', async () => {
    const { order, delivered, ask, v40, v41 } = await returnShop()
    const paid = await order(1)
    expect((await ask(paid)).status).toBe(409)

    const placed = await delivered()
    expect((await ask(placed, [{ variantId: v41.id, quantity: 1, reason: 'other' }])).status).toBe(400)
    expect((await ask(placed)).status).toBe(201)
    // Dòng có 2 đôi, yêu cầu trước đã chiếm 1: trả 2 nữa thì vượt.
    const over = await ask(placed, [{ variantId: v40.id, quantity: 2, reason: 'other' }])
    expect(over.status).toBe(409)
    expect(over.body.error.message).toContain('chỉ còn trả hay đổi được 1')
  })

  it('hai yêu cầu cùng lúc trên cùng dòng: chỉ một được nếu tổng vượt số lượng', async () => {
    const { delivered, ask, v40 } = await returnShop()
    const placed = await delivered()
    const both = [{ variantId: v40.id, quantity: 2, reason: 'defective' }]

    const results = await Promise.all([ask(placed, both), ask(placed, both)])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
  })
})

describe('xử lý yêu cầu trả hàng', () => {
  it('chấp nhận → kho nhận về → đề xuất hoàn: tồn, sổ, khoản hoàn origin return, đơn vẫn hoàn tất', async () => {
    const { delivered, ask, admin, view, stock, warehouse, request, token, mailer, audits, v40 } = await returnShop()
    const placed = await delivered()
    const code = (await ask(placed)).body.code as number
    const before = await stock()

    const accepted = await admin(code, 'decide', {
      decision: 'accepted',
      message: 'Bạn gửi hàng về địa chỉ cửa hàng nhé',
    })
    expect(accepted.status).toBe(200)
    expect(accepted.body).toMatchObject({ status: 'in_progress', decision: 'accepted' })
    await vi.waitFor(
      () => {
        if (!mailer.sent.some((m) => m.subject.includes('đã được chấp nhận'))) throw new Error('Chưa có thư')
      },
      { timeout: 10_000, interval: 100 },
    )

    const lineId = (await view(code)).lines[0]!.id
    const received = await admin(
      code,
      'receive',
      { lines: [{ lineId, restocked: 1, writtenOff: 0 }] },
      warehouse.accessToken,
    )
    expect(received.status).toBe(200)
    expect(received.body).toMatchObject({ receivedAt: expect.any(String), returnRefund: { suggested: 2_000_000 } })
    expect(await stock()).toEqual({ onHand: before.onHand + 1, reserved: before.reserved })
    const movements = await request.get('/api/admin/stock/movements').query({ variantId: v40.id }).set(bearer(token))
    expect(movements.body.items[0]).toMatchObject({
      kind: 'return',
      quantity: 1,
      orderCode: placed.code,
      supportRequestCode: code,
    })

    const proposed = await admin(code, 'refund', { refundAmount: 2_000_000 })
    expect(proposed.status).toBe(200)
    expect(proposed.body).toMatchObject({ status: 'resolved', returnRefund: null })
    expect(proposed.body.refunds).toEqual([expect.objectContaining({ amount: 2_000_000, status: 'pending' })])
    const order = await request.get(`/api/admin/orders/${placed.code}`).set(bearer(token))
    expect(order.body).toMatchObject({ status: 'completed', refunding: 2_000_000 })
    expect(order.body.refunds).toEqual([expect.objectContaining({ origin: 'return', amount: 2_000_000 })])
    expect(await audits()).toEqual(
      expect.arrayContaining(['support.decide', 'support.receive', 'support.refund_propose']),
    )
  })

  it('đơn có mã giảm giá: hoàn gợi ý trừ phần giảm của dòng theo số trả, không gồm phí giao; ít hơn thì cần ghi chú', async () => {
    const { delivered, ask, admin, view, warehouse, request, token } = await returnShop()
    const voucher = await request
      .post('/api/admin/vouchers')
      .set(bearer(token))
      .send({
        code: 'TET2027',
        kind: 'percent',
        percent: 10,
        maxDiscount: 500_000,
        startsAt: new Date(Date.now() - DAY).toISOString(),
        endsAt: new Date(Date.now() + 30 * DAY).toISOString(),
        saleTypes: ['standard'],
      })
    expect(voucher.status).toBe(201)
    // 2 đôi × 2.000.000, giảm 10% = 400.000 chia cho dòng; trả 1 đôi thì trừ 200.000.
    const placed = await delivered(2, { voucherCode: 'tet2027', discount: 400_000 })
    const code = (await ask(placed)).body.code as number
    await admin(code, 'decide', { decision: 'accepted', message: 'OK' })
    const lineId = (await view(code)).lines[0]!.id
    await admin(code, 'receive', { lines: [{ lineId, restocked: 0, writtenOff: 1 }] }, warehouse.accessToken)

    expect((await view(code)).returnRefund).toMatchObject({ suggested: 1_800_000 })
    expect((await admin(code, 'refund', { refundAmount: 1_700_000 })).status).toBe(400)
    expect((await admin(code, 'refund', { refundAmount: 99_999_999, note: 'x' })).status).toBe(400)
    const ok = await admin(code, 'refund', { refundAmount: 1_700_000, note: 'Hộp móp, trừ 100.000' })
    expect(ok.body.refunds).toEqual([expect.objectContaining({ amount: 1_700_000 })])
  })

  it('từ chối: yêu cầu kết thúc, email kèm lý do, số lượng được trả lại cho yêu cầu sau', async () => {
    const { delivered, ask, admin, mailer, v40 } = await returnShop()
    const placed = await delivered()
    const all = [{ variantId: v40.id, quantity: 2, reason: 'wrong_fit' }]
    const code = (await ask(placed, all)).body.code as number

    const rejected = await admin(code, 'decide', { decision: 'rejected', message: 'Đã quá hạn đổi trả' })

    expect(rejected.body).toMatchObject({ status: 'rejected', decision: 'rejected' })
    await vi.waitFor(
      () => {
        const mail = mailer.sent.find((m) => m.subject.includes('không được chấp nhận'))
        if (!mail) throw new Error('Chưa có thư')
        expect(mail.text).toContain('Đã quá hạn đổi trả')
      },
      { timeout: 10_000, interval: 100 },
    )
    expect((await ask(placed, all)).status).toBe(201)
  })

  it('sai bước hay sai quyền: nhận trước khi chấp nhận 409; tổng sai 400; hoàn trước khi nhận 409; kho không quyết, bán hàng không nhận', async () => {
    const { delivered, ask, admin, view, warehouse } = await returnShop()
    const code = (await ask(await delivered())).body.code as number
    const lineId = (await view(code)).lines[0]!.id
    const receive = (body: Record<string, unknown>, as = warehouse.accessToken) => admin(code, 'receive', body, as)

    expect((await receive({ lines: [{ lineId, restocked: 1, writtenOff: 0 }] })).status).toBe(409)
    expect((await admin(code, 'decide', { decision: 'accepted', message: 'x' }, warehouse.accessToken)).status).toBe(
      403,
    )
    await admin(code, 'decide', { decision: 'accepted', message: 'OK' })
    expect((await admin(code, 'decide', { decision: 'rejected', message: 'x' })).status).toBe(409)
    expect((await admin(code, 'refund', { refundAmount: 0, note: 'x' })).status).toBe(409)
    expect((await receive({ lines: [{ lineId, restocked: 1, writtenOff: 1 }] })).status).toBe(400)
    expect((await receive({ lines: [{ lineId, restocked: 1, writtenOff: 0 }] }, undefined)).status).toBe(200)
    expect((await receive({ lines: [{ lineId, restocked: 1, writtenOff: 0 }] })).status).toBe(409)
  })

  it('yêu cầu "khác" không chấp nhận/từ chối được', async () => {
    const { delivered, admin, request } = await returnShop()
    const placed = await delivered()
    const other = await request
      .post(`/api/orders/${placed.code}/support-requests`)
      .query({ token: placed.token })
      .send({ kind: 'other', subject: 'Hỏi', message: 'x' })
    expect((await admin(other.body.code, 'decide', { decision: 'accepted', message: 'x' })).status).toBe(409)
  })
})

describe('hạn đổi trả', () => {
  it('xem đủ năm nhóm hàng; bán hàng (content.edit) sửa được, có audit; kho không sửa được; lưu lại y hệt thì không audit', async () => {
    const { request, sales, warehouse, audits } = await returnShop()
    const get = () => request.get('/api/admin/return-windows').set(bearer(warehouse.accessToken))

    expect((await get()).body.items).toHaveLength(5)
    expect((await get()).body.items.every((i: { days: number | null }) => i.days === null)).toBe(true)
    const put = (items: Record<string, unknown>[], as = sales.accessToken) =>
      request.put('/api/admin/return-windows').set(bearer(as)).send({ items })

    expect((await put([{ productType: 'footwear', days: 7 }], warehouse.accessToken)).status).toBe(403)
    expect((await put([{ productType: 'footwear', days: 400 }])).status).toBe(400)
    const saved = await put([
      { productType: 'footwear', days: 7 },
      { productType: 'fragrance', days: 0 },
    ])
    expect(saved.body.items).toEqual(
      expect.arrayContaining([
        { productType: 'footwear', days: 7 },
        { productType: 'fragrance', days: 0 },
        { productType: 'watch', days: null },
      ]),
    )
    const count = (await audits()).filter((a) => a === 'return_window.update').length
    await put([{ productType: 'footwear', days: 7 }])
    expect((await audits()).filter((a) => a === 'return_window.update')).toHaveLength(count)
    const cleared = await put([{ productType: 'fragrance', days: null }])
    expect(cleared.body.items).toContainEqual({ productType: 'fragrance', days: null })
  })
})

describe('khách thấy khoản hoàn; lọc quá hạn đổi trả', () => {
  it('trang yêu cầu của khách có khoản hoàn của yêu cầu trả, đang hoàn', async () => {
    const { delivered, ask, admin, view, warehouse, request } = await returnShop()
    const placed = await delivered()
    const code = (await ask(placed)).body.code as number
    expect((await admin(code, 'decide', { decision: 'accepted', message: 'Gửi về giúp shop' })).status).toBe(200)
    const lineId = (await view(code)).lines[0]!.id
    const lines = [{ lineId, restocked: 1, writtenOff: 0 }]
    expect((await admin(code, 'receive', { lines }, warehouse.accessToken)).status).toBe(200)
    expect((await admin(code, 'refund', { refundAmount: 2_000_000 })).status).toBe(200)

    const customer = await request
      .get(`/api/orders/${placed.code}/support-requests/${code}`)
      .query({ token: placed.token })
    expect(customer.body.refunds).toEqual([
      { amount: 2_000_000, status: 'refunding', createdAt: expect.any(String), completedAt: null },
    ])
  })

  it('danh sách admin lọc được yêu cầu gửi khi đã quá hạn đổi trả', async () => {
    const { delivered, ask, request, token, prisma } = await returnShop()
    const late = (await ask(await delivered(1))).body.code as number
    await ask(await delivered(1))
    // Dựng trạng thái: lúc gửi đã quá hạn 3 ngày (bảng sự kiện đơn chỉ ghi thêm nên không lùi được lúc giao).
    await prisma.supportRequest.update({ where: { code: late }, data: { returnWindowDays: 7, overdueDays: 3 } })

    const list = await request
      .get('/api/admin/support-requests')
      .query({ status: 'all', returnOverdue: 'true' })
      .set(bearer(token))
    expect(list.body.items.map((i: { code: number }) => i.code)).toEqual([late])
  })
})

describe('kết thúc yêu cầu đã nhận hàng; hoàn tạo lại', () => {
  it('đã nhận hàng thì không từ chối được, và số đã nhận về không trả lại được lần nữa', async () => {
    const { delivered, ask, admin, view, warehouse } = await returnShop()
    const placed = await delivered(1)
    const code = (await ask(placed)).body.code as number
    expect((await admin(code, 'decide', { decision: 'accepted', message: 'Gửi về giúp shop' })).status).toBe(200)
    const lines = [{ lineId: (await view(code)).lines[0]!.id, restocked: 1, writtenOff: 0 }]
    expect((await admin(code, 'receive', { lines }, warehouse.accessToken)).status).toBe(200)

    expect((await admin(code, 'reply', { message: 'Đóng', status: 'rejected' })).status).toBe(409)
    expect((await admin(code, 'reply', { message: 'Shop đóng yêu cầu', status: 'resolved' })).status).toBe(200)
    expect((await ask(placed)).status).toBe(409)
  })

  it('tạo lại khoản hoàn trả hàng thất bại: khoản mới vẫn thuộc yêu cầu, khách thấy khoản đang hoàn', async () => {
    const { delivered, ask, admin, view, warehouse, request, token, prisma } = await returnShop()
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    const placed = await delivered(1)
    const code = (await ask(placed)).body.code as number
    expect((await admin(code, 'decide', { decision: 'accepted', message: 'Gửi về giúp shop' })).status).toBe(200)
    const lines = [{ lineId: (await view(code)).lines[0]!.id, restocked: 1, writtenOff: 0 }]
    expect((await admin(code, 'receive', { lines }, warehouse.accessToken)).status).toBe(200)
    const proposed = await admin(code, 'refund', { refundAmount: 2_000_000 })
    const refundId = proposed.body.refunds[0].id as string
    // Dựng trạng thái: cổng báo hoàn thất bại.
    const transaction = await prisma.paymentTransaction.findFirstOrThrow({ where: { order: { code: placed.code } } })
    await prisma.refund.update({
      where: { id: refundId },
      data: {
        status: 'failed',
        method: 'vnpay',
        paymentTransactionId: transaction.id,
        executedById: accountant.id,
        executedAt: new Date(),
        completedAt: new Date(),
      },
    })

    const retried = await request
      .post(`/api/admin/refunds/${refundId}/retry`)
      .set(bearer(accountant.accessToken))
      .send({ amount: 2_000_000 })
    expect(retried.status).toBe(200)
    expect((await view(code)).refunds).toEqual([
      expect.objectContaining({ id: refundId, status: 'failed' }),
      expect.objectContaining({ amount: 2_000_000, status: 'pending' }),
    ])
    const customer = await request
      .get(`/api/orders/${placed.code}/support-requests/${code}`)
      .query({ token: placed.token })
    expect(customer.body.refunds).toEqual([expect.objectContaining({ amount: 2_000_000, status: 'refunding' })])
  })
})
