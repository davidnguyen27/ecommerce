import { describe, expect, it } from 'vitest'
import { bearer } from './support/staff.ts'
import { register, tokenFromMail } from './support/customer.ts'
import { ADDRESS, shop } from './support/shop.ts'

describe('đơn hàng trong tài khoản khách', () => {
  it('đơn khách đặt lúc đã đăng nhập hiện trong lịch sử và xem được chi tiết', async () => {
    const { request, checkout } = await shop()
    const { accessToken } = (await register(request)).body

    const placed = await checkout({ acceptPrivacyPolicy: undefined }).set(bearer(accessToken))
    expect(placed.status).toBe(201)

    const list = await request.get('/api/account/orders').set(bearer(accessToken))
    expect(list.status).toBe(200)
    expect(list.body).toEqual({
      items: [
        {
          code: placed.body.code,
          status: 'pending_payment',
          paymentStatus: 'unpaid',
          fulfillmentStatus: 'not_prepared',
          createdAt: expect.any(String),
          total: 2_030_000,
          itemCount: 1,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const detail = await request.get(`/api/account/orders/${placed.body.code}`).set(bearer(accessToken))
    expect(detail.status).toBe(200)
    expect(detail.headers['cache-control']).toBe('no-store')
    expect(detail.body).toMatchObject({
      code: placed.body.code,
      total: 2_030_000,
      address: { ...ADDRESS, email: 'an@example.com' },
      lines: [{ sku: 'AM-40', quantity: 1 }],
    })
  })
})

describe('địa chỉ lần trước', () => {
  it('chưa đặt đơn nào thì không có; đặt mua thành công thì lưu, đơn mới ghi đè; đặt hỏng thì giữ nguyên', async () => {
    const { request, checkout, v41 } = await shop()
    const { accessToken } = (await register(request)).body
    const lastAddress = () => request.get('/api/account/shipping-address').set(bearer(accessToken))

    const none = await lastAddress()
    expect(none.status).toBe(200)
    expect(none.body).toEqual({ address: null })

    expect((await checkout({ acceptPrivacyPolicy: undefined }).set(bearer(accessToken))).status).toBe(201)
    expect((await lastAddress()).body).toEqual({ address: { ...ADDRESS, email: 'an@example.com' } })

    const moved = { ...ADDRESS, recipientName: 'Trần Thị Bình', streetAddress: '5 Lý Thái Tổ' }
    expect((await checkout({ address: moved, acceptPrivacyPolicy: undefined }).set(bearer(accessToken))).status).toBe(
      201,
    )
    const failed = await checkout({
      address: { ...ADDRESS, streetAddress: '1 Hàng Bài' },
      lines: [{ variantId: v41.id, quantity: 1, price: 2_100_000 }],
      acceptPrivacyPolicy: undefined,
    }).set(bearer(accessToken))
    expect(failed.status).toBe(409)

    expect((await lastAddress()).body).toEqual({ address: { ...moved, email: 'an@example.com' } })
  })
})

describe('gắn đơn vãng lai vào tài khoản', () => {
  it('đơn vãng lai cùng email chỉ gắn vào tài khoản sau khi khách xác minh email', async () => {
    const { request, mailer, checkout } = await shop()
    const mine = await checkout()
    const someoneElse = await checkout({ address: { ...ADDRESS, email: 'binh@example.com', phone: '0987654321' } })
    expect([mine.status, someoneElse.status]).toEqual([201, 201])
    const { accessToken } = (await register(request, { email: 'AN@example.com' })).body

    const before = await request.get('/api/account/orders').set(bearer(accessToken))
    expect(before.body.items).toEqual([])
    expect((await request.get(`/api/account/orders/${mine.body.code}`).set(bearer(accessToken))).status).toBe(404)

    const token = await tokenFromMail(mailer, '/xac-minh-email', 'an@example.com')
    expect((await request.post('/api/auth/verify-email').send({ token })).status).toBe(204)

    const after = await request.get('/api/account/orders').set(bearer(accessToken))
    expect(after.body.items.map((o: { code: number }) => o.code)).toEqual([mine.body.code])
    expect((await request.get(`/api/account/orders/${mine.body.code}`).set(bearer(accessToken))).status).toBe(200)
  })
})

describe('đơn của người khác', () => {
  it('khách không thấy đơn của khách khác, kể cả khi biết mã đơn', async () => {
    const { request, checkout } = await shop()
    const first = (await register(request)).body.accessToken
    const second = (await register(request, { email: 'khac@example.com' })).body.accessToken
    const placed = await checkout({ acceptPrivacyPolicy: undefined }).set(bearer(first))
    expect(placed.status).toBe(201)

    const list = await request.get('/api/account/orders').set(bearer(second))
    const detail = await request.get(`/api/account/orders/${placed.body.code}`).set(bearer(second))

    expect(list.body.items).toEqual([])
    expect(detail.status).toBe(404)
    expect(detail.body.error.message).toBe('Không tìm thấy đơn hàng')
  })

  it('chưa đăng nhập thì 401', async () => {
    const { request } = await shop()

    expect((await request.get('/api/account/orders')).status).toBe(401)
  })
})
