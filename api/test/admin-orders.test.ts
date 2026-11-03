import { describe, expect, it } from 'vitest'
import { CUSTOMER, register } from './support/customer.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

/** Cửa hàng có cổng giả lập, kèm hàm đặt đơn và trả tiền đủ qua cổng giả lập. */
async function orders() {
  const app = await shop({ simulator: true })
  const { request, token, checkout } = app
  /** Đặt một đơn AM-40; `address` ghi đè từng phần thông tin nhận hàng. */
  const place = async (address: Partial<typeof ADDRESS> = {}) => {
    const res = await checkout({ address: { ...ADDRESS, ...address } })
    expect(res.status).toBe(201)
    return res.body as { code: number; token: string }
  }
  const pay = async (code: number) => {
    const res = await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: 2_030_000 })
    expect(res.status).toBe(204)
  }
  const list = (query: Record<string, string | number> = {}, as = token) =>
    request.get('/api/admin/orders').query(query).set(bearer(as))
  const codes = async (query: Record<string, string | number> = {}) => {
    const res = await list(query)
    expect(res.status).toBe(200)
    return (res.body.items as { code: number }[]).map((o) => o.code)
  }
  return { ...app, place, pay, list, codes }
}

describe('danh sách đơn ở trang quản trị', () => {
  it('mặc định là hàng chờ soạn: đơn đã trả đủ, chưa chuẩn bị, cũ trước', async () => {
    const { place, pay, codes } = await orders()
    const first = await place()
    const pending = await place()
    const second = await place({ email: 'binh@example.com', phone: '0987654321' })
    await pay(second.code)
    await pay(first.code)

    expect(await codes()).toEqual([first.code, second.code])
    expect(await codes({ sort: 'newest' })).toEqual([second.code, first.code])
    expect(await codes({ status: 'all', paymentStatus: 'all', fulfillmentStatus: 'all' })).toEqual([
      first.code,
      pending.code,
      second.code,
    ])
    expect(await codes({ status: 'pending_payment', paymentStatus: 'all', fulfillmentStatus: 'all' })).toEqual([
      pending.code,
    ])
  })

  it('tìm theo mã đơn, số điện thoại (gõ kiểu nào cũng được) hoặc email', async () => {
    const { place, codes } = await orders()
    const an = await place()
    const binh = await place({ email: 'Binh.Tran@Example.com', phone: '0987654321' })
    const any = { status: 'all', paymentStatus: 'all', fulfillmentStatus: 'all' }

    expect(await codes({ ...any, q: String(binh.code) })).toEqual([binh.code])
    expect(await codes({ ...any, q: '+84 987 654 321' })).toEqual([binh.code])
    expect(await codes({ ...any, q: '0912.345.678' })).toEqual([an.code])
    expect(await codes({ ...any, q: 'binh.tran@' })).toEqual([binh.code])
    expect(await codes({ ...any, q: 'EXAMPLE.COM' })).toEqual([an.code, binh.code])
    expect(await codes({ ...any, q: 'khong-co' })).toEqual([])
  })
})

describe('chi tiết đơn ở trang quản trị', () => {
  it('có dòng đơn, thông tin nhận hàng và hóa đơn công ty như lúc đặt', async () => {
    const { checkout, request, token, v40 } = await orders()
    const invoice = { companyName: 'Công ty TNHH An Bình', taxCode: '0101234567', address: '1 Tràng Tiền, Hà Nội' }
    const placed = await checkout({ invoice, note: 'Giao giờ hành chính' })

    const res = await request.get(`/api/admin/orders/${placed.body.code}`).set(bearer(token))
    const unknown = await request.get('/api/admin/orders/999999').set(bearer(token))

    expect(res.status).toBe(200)
    expect(unknown.status).toBe(404)
    expect(res.body).toMatchObject({
      code: placed.body.code,
      status: 'pending_payment',
      customerId: null,
      invoice,
      note: 'Giao giờ hành chính',
      address: { recipientName: ADDRESS.recipientName, phone: ADDRESS.phone, email: 'an@example.com' },
      lines: [{ variantId: v40.id, sku: 'AM-40', productName: 'Air Max', quantity: 1, price: 2_000_000 }],
      total: 2_030_000,
      payments: [],
    })
  })

  it('lịch sử gộp sự kiện đơn với audit theo thời gian, đủ khách, nhân viên và hệ thống', async () => {
    const { place, request, token } = await orders()
    const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
    const { code } = await place()
    expect((await request.post(`/api/admin/orders/${code}/cancel`).set(bearer(warehouse.accessToken))).status).toBe(204)
    // Tiền về sau khi đơn đã hủy: hệ thống ghi giao dịch và gắn cờ cần đối soát.
    await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: 2_030_000 })

    const res = await request.get(`/api/admin/orders/${code}`).set(bearer(token))

    const staffActor = { type: 'staff', id: warehouse.id, name: 'Nhân Viên', email: 'kho@example.com' }
    expect(res.body.history).toEqual([
      expect.objectContaining({
        source: 'event',
        action: 'created',
        actor: { type: 'customer', id: null, email: null },
      }),
      expect.objectContaining({ source: 'event', action: 'cancelled', actor: staffActor, data: { reason: 'staff' } }),
      expect.objectContaining({
        source: 'audit',
        action: 'order.cancel',
        actor: staffActor,
        data: { before: { status: 'pending_payment' }, after: { status: 'cancelled', cancelReason: 'staff' } },
      }),
      expect.objectContaining({ source: 'event', action: 'payment_flagged', actor: { type: 'system' } }),
    ])
    expect(res.body.payments).toEqual([
      expect.objectContaining({
        amount: 2_030_000,
        source: 'simulator',
        reconciliation: { reason: 'paid_after_cancel', status: 'open' },
      }),
    ])
  })

  it('khách đã đăng nhập hiện bằng email tài khoản', async () => {
    const { request, token, checkout, prisma } = await orders()
    const accessToken = (await register(request)).body.accessToken as string
    // Không có API quản trị khách hàng: lấy id khách bằng prisma để so.
    const customer = await prisma.customer.findUniqueOrThrow({ where: { email: CUSTOMER.email } })
    const placed = await checkout({ acceptPrivacyPolicy: undefined }).set(bearer(accessToken))
    expect(placed.status).toBe(201)

    const res = await request.get(`/api/admin/orders/${placed.body.code}`).set(bearer(token))

    expect(res.body.customerId).toBe(customer.id)
    expect(res.body.history[0].actor).toEqual({ type: 'customer', id: customer.id, email: CUSTOMER.email })
  })
})

describe('quyền xem đơn', () => {
  it('mọi vai trò có order.view; chỉ owner và thủ kho có order.fulfill', async () => {
    const { request, token } = await orders()
    const perms = async (role: 'sales' | 'warehouse' | 'accountant') => {
      const staff = await createStaff(request, token, [role], `${role}@example.com`)
      const me = await request.get('/api/admin/me').set(bearer(staff.accessToken))
      return (me.body.permissions as string[]).filter((p) => p.startsWith('order.'))
    }

    expect(await perms('sales')).toEqual(['order.view'])
    expect(await perms('accountant')).toEqual(['order.view'])
    expect(await perms('warehouse')).toEqual(['order.view', 'order.fulfill'])
  })
})
