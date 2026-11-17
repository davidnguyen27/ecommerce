import { describe, expect, it, vi } from 'vitest'
import { register } from './support/customer.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const TOTAL = 2_030_000
const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }

/** Cửa hàng có cổng giả lập; `order({ paid })` đặt một đơn vãng lai, trả đủ nếu cần; `ask` gửi yêu cầu qua link đơn. */
async function cancelShop() {
  const app = await shop({ simulator: true })
  const { request, token, checkout } = app
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  let n = 0
  const order = async ({ paid = true } = {}) => {
    n += 1
    const res = await checkout({
      address: { ...ADDRESS, email: `khach${n}@example.com`, phone: `09000000${String(n).padStart(2, '0')}` },
    })
    expect(res.status).toBe(201)
    const placed = res.body as { code: number; token: string }
    if (paid) await request.post('/api/payments/simulator/paid').send({ orderCode: placed.code, amount: TOTAL })
    return placed
  }
  const ask = (placed: { code: number; token: string }, kind = 'cancel') =>
    request
      .post(`/api/orders/${placed.code}/support-requests`)
      .query({ token: placed.token })
      .send({ kind, subject: 'Xin hủy đơn', message: 'Tôi đổi ý' })
  const admin = (path: string, body?: Record<string, unknown>, as = sales.accessToken) =>
    request.post(path).set(bearer(as)).send(body)
  return { ...app, sales, order, ask, admin }
}

describe('yêu cầu hủy đơn', () => {
  it('đơn đã trả chưa giao: gửi được; nhân viên hủy đơn thì yêu cầu tự xong, có tin hệ thống, không gửi thư "đã xong"', async () => {
    const { order, ask, admin, request, mailer } = await cancelShop()
    const placed = await order()

    const created = await ask(placed)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ kind: 'cancel', status: 'new', orderCode: placed.code })
    const code = created.body.code as number

    const cancelled = await admin(`/api/admin/orders/${placed.code}/cancel-paid`, {
      cause: 'changed_mind',
      refundAmount: TOTAL,
    })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.history).toContainEqual(
      expect.objectContaining({ action: 'support_resolved', data: { requestCodes: [code] } }),
    )

    const seen = await request.get(`/api/orders/${placed.code}/support-requests/${code}`).query({ token: placed.token })
    expect(seen.body).toMatchObject({ status: 'resolved', resolvedAt: expect.any(String) })
    expect(seen.body.messages.at(-1)).toMatchObject({ author: 'system', body: expect.stringContaining('đã được hủy') })
    await vi.waitFor(
      () => {
        if (!mailer.sent.some((m) => m.subject === `Đơn hàng #${placed.code} đã bị hủy`)) throw new Error('Chưa có thư')
      },
      { timeout: 10_000, interval: 100 },
    )
    expect(mailer.sent.filter((m) => m.subject.includes('đã được xử lý xong'))).toHaveLength(0)
  })

  it('đơn chưa trả hay đã bàn giao thì không gửi được (409); đơn đã cọc thì gửi được', async () => {
    const { order, ask, admin, token } = await cancelShop()
    const unpaid = await order({ paid: false })
    expect((await ask(unpaid)).status).toBe(409)

    const shipped = await order()
    await admin(`/api/admin/orders/${shipped.code}/prepare`, undefined, token)
    await admin(`/api/admin/orders/${shipped.code}/hand-over`, SHIPMENT, token)
    const late = await ask(shipped)
    expect(late.status).toBe(409)
    expect(late.body.error.message).toContain('chưa giao cho đơn vị vận chuyển')

    const preparing = await order()
    await admin(`/api/admin/orders/${preparing.code}/prepare`, undefined, token)
    expect((await ask(preparing)).status).toBe(201)
  })

  it('đơn được bàn giao sau khi khách gửi: yêu cầu vẫn mở để nhân viên trả lời', async () => {
    const { order, ask, admin, token } = await cancelShop()
    const placed = await order()
    const code = (await ask(placed)).body.code as number
    await admin(`/api/admin/orders/${placed.code}/prepare`, undefined, token)
    await admin(`/api/admin/orders/${placed.code}/hand-over`, SHIPMENT, token)

    const reply = await admin(`/api/admin/support-requests/${code}/reply`, {
      message: 'Đơn đã giao đi, bạn gửi yêu cầu trả hàng sau khi nhận nhé.',
      status: 'resolved',
    })

    expect(reply.status).toBe(200)
    expect(reply.body.status).toBe('resolved')
  })

  it('tạo yêu cầu hủy không có đơn thì 400 (trang tài khoản và nhân viên tạo hộ)', async () => {
    const { request, admin } = await cancelShop()
    const { accessToken } = (await register(request)).body as { accessToken: string }

    const account = await request
      .post('/api/account/support-requests')
      .set(bearer(accessToken))
      .send({ kind: 'cancel', subject: 'x', message: 'y' })
    expect(account.status).toBe(400)
    const staff = await admin('/api/admin/support-requests', {
      kind: 'cancel',
      customerEmail: 'khach@example.com',
      subject: 'x',
      message: 'y',
    })
    expect(staff.status).toBe(400)
  })

  it('nhân viên tạo hộ yêu cầu hủy theo mã đơn', async () => {
    const { order, admin } = await cancelShop()
    const placed = await order()

    const res = await admin('/api/admin/support-requests', {
      kind: 'cancel',
      orderCode: placed.code,
      subject: 'Khách gọi xin hủy',
      message: 'Khách gọi lúc 9h',
    })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'cancel', createdBy: 'staff' })
  })
})
