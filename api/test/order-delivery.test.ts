import { describe, expect, it, vi } from 'vitest'
import type { InMemoryMailer } from '../src/adapters/mailer.ts'
import { shop } from './support/shop.ts'
import { OWNER, bearer, createStaff } from './support/staff.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN123456' }

/** Chờ đủ `count` thư có tiêu đề chứa `subject` qua hàng đợi job, rồi đợi thêm để bắt thư gửi trùng. */
async function mails(mailer: InMemoryMailer, subject: string, count = 1) {
  const found = await vi.waitFor(
    () => {
      const sent = mailer.sent.filter((m) => m.subject.includes(subject))
      if (sent.length < count) throw new Error('Chưa có thư')
      return sent
    },
    { timeout: 10_000, interval: 100 },
  )
  return found
}

/** Cửa hàng có cổng giả lập; `handedOverOrder` đặt hai đôi AM-40, trả đủ, chuẩn bị và bàn giao. */
async function delivery() {
  const app = await shop({ simulator: true })
  const { request, token, checkout, v40 } = app
  const post = (code: number, path: string, body?: Record<string, unknown>, as = token) =>
    request.post(`/api/admin/orders/${code}/${path}`).set(bearer(as)).send(body)
  const handedOverOrder = async () => {
    const placed = await checkout({ lines: [{ variantId: v40.id, quantity: 2, price: 2_000_000 }] })
    expect(placed.status).toBe(201)
    const code = placed.body.code as number
    const paid = await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: 4_030_000 })
    expect(paid.status).toBe(204)
    expect((await post(code, 'prepare')).status).toBe(200)
    expect((await post(code, 'hand-over', SHIPMENT)).status).toBe(200)
    return code
  }
  const deliver = (code: number, as = token) => post(code, 'deliver', undefined, as)
  const fail = (code: number, as = token) => post(code, 'delivery-failed', undefined, as)
  return { ...app, post, handedOverOrder, deliver, fail }
}

describe('đã giao và giao thất bại', () => {
  it('đã giao: đơn hoàn tất, ghi sự kiện và audit', async () => {
    const { handedOverOrder, deliver, request, token } = await delivery()
    const code = await handedOverOrder()

    const res = await deliver(code)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      code,
      status: 'completed',
      paymentStatus: 'paid',
      fulfillmentStatus: 'delivered',
      shipment: { ...SHIPMENT, handedOverAt: expect.any(String) },
    })
    const staffActor = expect.objectContaining({ type: 'staff', email: OWNER.email })
    expect(res.body.history.slice(-2)).toEqual([
      expect.objectContaining({ action: 'handed_over' }),
      expect.objectContaining({ action: 'delivered', actor: staffActor }),
    ])
    const audit = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    expect(audit.body.items[0]).toMatchObject({
      action: 'order.deliver',
      before: { status: 'processing', fulfillmentStatus: 'handed_over' },
      after: { status: 'completed', fulfillmentStatus: 'delivered' },
    })
  })

  it('giao thất bại: đơn vẫn đang xử lý, khách nhận email báo shop sẽ liên hệ đúng một lần', async () => {
    const { handedOverOrder, fail, mailer, request, token } = await delivery()
    const code = await handedOverOrder()

    const res = await fail(code)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code, status: 'processing', fulfillmentStatus: 'failed' })
    expect(res.body.history.slice(-2)).toEqual([
      expect.objectContaining({ action: 'handed_over' }),
      expect.objectContaining({ action: 'delivery_failed' }),
    ])
    const audit = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    expect(audit.body.items[0]).toMatchObject({
      action: 'order.delivery_failed',
      before: { fulfillmentStatus: 'handed_over' },
      after: { fulfillmentStatus: 'failed' },
    })
    const [mail] = await mails(mailer, `Giao hàng chưa thành công đơn hàng #${code}`)
    expect(mail).toMatchObject({ to: 'an@example.com' })
    expect(mail!.text).toContain('Nguyễn Văn An')
    expect(mail!.text).toContain('liên hệ')
    expect(mail!.text).toContain('GHN123456')
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(mailer.sent.filter((m) => m.subject.includes('Giao hàng chưa thành công'))).toHaveLength(1)
  })

  it('bàn giao gửi email có đơn vị vận chuyển, mã vận đơn và link tra cứu, đúng một lần', async () => {
    const { handedOverOrder, mailer, request } = await delivery()
    const code = await handedOverOrder()

    const [mail] = await mails(mailer, `Đơn hàng #${code} đã được giao cho đơn vị vận chuyển`)
    expect(mail).toMatchObject({ to: 'an@example.com' })
    expect(mail!.text).toContain('Giao Hàng Nhanh')
    expect(mail!.text).toContain('GHN123456')
    const link = /https:\/\/shop\.test\/don-hang\/(\d+)\?token=([\w-]+)/.exec(mail!.text)
    expect(link?.[1]).toBe(String(code))
    const viewed = await request.get(`/api/orders/${code}`).query({ token: link![2] })
    expect(viewed.status).toBe(200)
    expect(viewed.body).toMatchObject({ fulfillmentStatus: 'handed_over', shipment: SHIPMENT })
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(mailer.sent.filter((m) => m.subject.includes('đã được giao cho đơn vị vận chuyển'))).toHaveLength(1)
  })

  it('bàn giao lỗi (sai cạnh trạng thái) thì không gửi email', async () => {
    const { handedOverOrder, post, mailer } = await delivery()
    const code = await handedOverOrder()
    await mails(mailer, `Đơn hàng #${code} đã được giao`)

    expect((await post(code, 'hand-over', SHIPMENT)).status).toBe(409)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(mailer.sent.filter((m) => m.subject.includes('đã được giao cho đơn vị vận chuyển'))).toHaveLength(1)
  })

  it('sai cạnh trạng thái thì 409: chưa bàn giao, đã giao rồi, đã thất bại rồi', async () => {
    const { handedOverOrder, deliver, fail, post, checkout, request, token, v40 } = await delivery()
    // Đơn chỉ mới chuẩn bị (tồn ba đôi: đơn bàn giao lấy hai, đơn này một).
    const placed = await checkout({ lines: [{ variantId: v40.id, quantity: 1, price: 2_000_000 }] })
    const preparing = placed.body.code as number
    await request.post('/api/payments/simulator/paid').send({ orderCode: preparing, amount: 2_030_000 })
    expect((await post(preparing, 'prepare')).status).toBe(200)
    const code = await handedOverOrder()

    expect((await deliver(preparing)).status).toBe(409)
    expect((await fail(preparing)).status).toBe(409)
    expect((await deliver(code)).status).toBe(200)
    expect((await deliver(code)).status).toBe(409)
    expect((await fail(code)).status).toBe(409)
    expect((await deliver(999999)).status).toBe(404)

    const order = await request.get(`/api/admin/orders/${code}`).set(bearer(token))
    expect(order.body).toMatchObject({ status: 'completed', fulfillmentStatus: 'delivered' })
  })

  it('đơn giao thất bại không đánh dấu đã giao được nữa', async () => {
    const { handedOverOrder, deliver, fail } = await delivery()
    const code = await handedOverOrder()

    expect((await fail(code)).status).toBe(200)
    expect((await deliver(code)).status).toBe(409)
    expect((await fail(code)).status).toBe(409)
  })

  it('cần quyền order.fulfill: bán hàng không đánh dấu được, kho thì được', async () => {
    const { handedOverOrder, deliver, fail, request, token } = await delivery()
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
    const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
    const code = await handedOverOrder()

    expect((await deliver(code, sales.accessToken)).status).toBe(403)
    expect((await fail(code, sales.accessToken)).status).toBe(403)
    expect((await deliver(code, warehouse.accessToken)).status).toBe(200)
  })
})
