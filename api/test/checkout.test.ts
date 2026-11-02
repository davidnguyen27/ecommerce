import { describe, expect, it } from 'vitest'
import { bearer } from './support/staff.ts'
import { ADDRESS, shop } from './support/shop.ts'

describe('đặt mua', () => {
  it('tạo đơn chờ thanh toán, giữ hàng 15 phút và trả link thanh toán cùng token tra cứu', async () => {
    const { request, token, checkout, payments, v40 } = await shop()
    const before = Date.now()

    const res = await checkout({
      lines: [{ variantId: v40.id, quantity: 2, price: 2_000_000 }],
      note: 'Giao giờ hành chính',
    })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      code: 100000,
      token: expect.any(String),
      checkoutUrl: 'https://pay.test/100000',
      reservedUntil: expect.any(String),
    })
    const reservedUntil = Date.parse(res.body.reservedUntil)
    expect(reservedUntil - before).toBeGreaterThanOrEqual(15 * 60_000 - 1_000)
    expect(reservedUntil - before).toBeLessThanOrEqual(15 * 60_000 + 10_000)
    expect(payments.created).toEqual([
      expect.objectContaining({ orderCode: 100000, amount: 4_030_000, expiresAt: new Date(res.body.reservedUntil) }),
    ])

    const order = await request.get('/api/orders/100000').query({ token: res.body.token })
    expect(order.status).toBe(200)
    expect(order.body).toMatchObject({
      code: 100000,
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'not_prepared',
      reservedUntil: res.body.reservedUntil,
      address: { ...ADDRESS, email: 'an@example.com', provinceName: 'Hà Nội', wardName: 'Phường Ba Đình' },
      note: 'Giao giờ hành chính',
      lines: [
        {
          variantId: v40.id,
          sku: 'AM-40',
          productName: 'Air Max',
          attributes: { mau: 'Đen', size: '40' },
          image: expect.objectContaining({ originalUrl: expect.any(String) }),
          price: 2_000_000,
          quantity: 2,
          lineTotal: 4_000_000,
        },
      ],
      subtotal: 4_000_000,
      shippingFee: 30_000,
      total: 4_030_000,
      policies: [{ slug: 'doi-tra', title: 'Đổi trả', version: 1 }],
    })

    const stock = await request.get('/api/admin/stock').query({ q: 'AM-40' }).set(bearer(token))
    expect(stock.body.items[0]).toMatchObject({ sku: 'AM-40', onHand: 3, reserved: 2 })
  })

  it('giữ hết số tồn thì khách thấy biến thể hết hàng ở trang sản phẩm, danh sách và báo giá', async () => {
    const { request, checkout, v40 } = await shop()

    const res = await checkout({ lines: [{ variantId: v40.id, quantity: 3, price: 2_000_000 }] })

    expect(res.status).toBe(201)
    const page = await request.get('/api/products/air-max')
    expect(page.body.variants.find((v: { sku: string }) => v.sku === 'AM-40').inStock).toBe(false)
    const list = await request.get('/api/products')
    expect(list.body.items[0]).toMatchObject({ slug: 'air-max', inStock: false })
    const quote = await request.post('/api/checkout/quote').send({ lines: [{ variantId: v40.id, quantity: 1 }] })
    expect(quote.body.lines[0]).toMatchObject({ inStock: false })
  })

  it('đơn lưu thông tin nhận hàng đã chuẩn hóa: số điện thoại dạng 0xxxxxxxxx, email chữ thường', async () => {
    const { request, checkout } = await shop()

    const res = await checkout({ address: { ...ADDRESS, phone: '+84 912.345.678' } })

    const order = await request.get(`/api/orders/${res.body.code}`).query({ token: res.body.token })
    expect(order.body.address).toMatchObject({ phone: '0912345678', email: 'an@example.com' })
  })
})

describe('đặt mua bị từ chối', () => {
  /** Không có đơn nào được tạo và không giữ hàng nào: số đang giữ vẫn 0, cổng chưa tạo link nào. */
  async function expectNothingWritten(app: Awaited<ReturnType<typeof shop>>) {
    const stock = await app.request.get('/api/admin/stock').set(bearer(app.token))
    expect(stock.body.items.map((i: { reserved: number }) => i.reserved)).toEqual([0, 0])
    expect(app.payments.created).toEqual([])
  }

  it('giá đã đổi, biến thể ngừng bán hay hết hàng thì 409 kèm thay đổi của từng dòng', async () => {
    const app = await shop()
    const { checkout, editVariant, v40, v41 } = app
    expect((await editVariant(v40, 'AM-40', '40', { price: 1_900_000 })).status).toBe(200)

    const priceAndOutOfStock = await checkout({
      lines: [
        { variantId: v40.id, quantity: 1, price: 2_000_000 },
        { variantId: v41.id, quantity: 1, price: 2_100_000 },
      ],
    })
    expect((await editVariant(v41, 'AM-41', '41', { status: 'discontinued' })).status).toBe(200)
    const discontinued = await checkout({ lines: [{ variantId: v41.id, quantity: 1, price: 2_100_000 }] })

    expect(priceAndOutOfStock.status).toBe(409)
    expect(priceAndOutOfStock.body.error.details).toEqual({
      lines: [
        { variantId: v40.id, change: { kind: 'price', from: 2_000_000, to: 1_900_000 } },
        { variantId: v41.id, change: { kind: 'out_of_stock' } },
      ],
    })
    expect(discontinued.status).toBe(409)
    expect(discontinued.body.error.details).toEqual({
      lines: [{ variantId: v41.id, change: { kind: 'discontinued' } }],
    })
    await expectNothingWritten(app)
  })

  it('một dòng thiếu hàng thì không giữ dòng nào', async () => {
    const app = await shop()
    const { checkout, v40, v41 } = app

    const res = await checkout({
      lines: [
        { variantId: v40.id, quantity: 2, price: 2_000_000 },
        { variantId: v41.id, quantity: 1, price: 2_100_000 },
      ],
    })

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual({ lines: [{ variantId: v41.id, change: { kind: 'out_of_stock' } }] })
    await expectNothingWritten(app)
  })

  it('chọn nhiều hơn số còn lại thì 409 hết hàng, không lộ số tồn', async () => {
    const app = await shop()

    const res = await app.checkout({ lines: [{ variantId: app.v40.id, quantity: 4, price: 2_000_000 }] })

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual({ lines: [{ variantId: app.v40.id, change: { kind: 'out_of_stock' } }] })
    expect(JSON.stringify(res.body)).not.toMatch(/"3"|: ?3\b/)
  })

  it('sản phẩm không còn xuất bản thì dòng đó là ngừng bán', async () => {
    const app = await shop()
    const archive = await app.request
      .put(`/api/admin/products/${app.product.id}/status`)
      .set(bearer(app.token))
      .send({ status: 'archived' })
    expect(archive.status).toBe(200)

    const res = await app.checkout()

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual({ lines: [{ variantId: app.v40.id, change: { kind: 'discontinued' } }] })
    await expectNothingWritten(app)
  })

  it('quá 5 cái một biến thể bị từ chối theo trường', async () => {
    const app = await shop()

    const res = await app.checkout({ lines: [{ variantId: app.v40.id, quantity: 6, price: 2_000_000 }] })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([{ path: 'lines.0.quantity', message: 'Tối đa 5 cái mỗi biến thể' }])
    await expectNothingWritten(app)
  })

  it('thông tin nhận hàng sai bị từ chối theo trường, kể cả phường/xã không thuộc tỉnh/thành đã chọn', async () => {
    const app = await shop()

    const missing = await app.checkout({ address: { ...ADDRESS, phone: '12345', recipientName: ' ' } })
    const wrongWard = await app.checkout({ address: { ...ADDRESS, provinceCode: '79' } })

    expect(missing.status).toBe(400)
    expect(missing.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual([
      'address.phone',
      'address.recipientName',
    ])
    expect(wrongWard.status).toBe(400)
    expect(wrongWard.body.error.fields).toEqual([
      { path: 'address.wardCode', message: 'Phường/xã không thuộc tỉnh/thành đã chọn' },
    ])
  })

  it('cổng thanh toán lỗi khi tạo link thì 502, không có đơn và không giữ hàng', async () => {
    const app = await shop()
    app.payments.failCreate = true

    const res = await app.checkout()

    expect(res.status).toBe(502)
    expect(res.body.error.message).toBe('Chưa tạo được thanh toán, thử lại')
    await expectNothingWritten(app)
  })

  it('chưa cấu hình phí giao mặc định thì 503', async () => {
    const app = await shop()
    await app.prisma.shippingFeeSetting.deleteMany()

    const res = await app.checkout()

    expect(res.status).toBe(503)
    expect(res.body.error.message).toBe('Cửa hàng chưa sẵn sàng nhận đơn')
    await expectNothingWritten(app)
  })
})

describe('giữ hàng đồng thời', () => {
  it('nhiều khách đặt biến thể cuối cùng cùng lúc thì đúng một đơn được tạo', async () => {
    const { request, token, checkout, v40 } = await shop()
    const down = await request
      .post('/api/admin/stock/adjustments')
      .set(bearer(token))
      .send({ variantId: v40.id, reason: 'stocktake', countedQuantity: 1, expectedOnHand: 3 })
    expect(down.status).toBe(201)

    const results = await Promise.all([checkout(), checkout(), checkout(), checkout()])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
    const stock = await request.get('/api/admin/stock').query({ q: 'AM-40' }).set(bearer(token))
    expect(stock.body.items[0]).toMatchObject({ onHand: 1, reserved: 1 })
  })
})

describe('snapshot của đơn', () => {
  it('đổi giá, tên, chính sách hay phí giao sau khi đặt không đổi đơn; đơn giữ đúng phiên bản chính sách', async () => {
    const { request, token, checkout, editVariant, product, brand, category, policy, v40 } = await shop()
    const placed = await checkout()
    const before = await request.get(`/api/orders/${placed.body.code}`).query({ token: placed.body.token })

    expect((await editVariant(v40, 'AM-40', '40', { price: 1_500_000 })).status).toBe(200)
    const rename = await request
      .put(`/api/admin/products/${product.id}`)
      .set(bearer(token))
      .send({
        brandId: brand.id,
        categoryId: category.id,
        name: 'Air Max Mới',
        slug: 'air-max',
        attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
      })
    expect(rename.status).toBe(200)
    const republish = await request
      .put(`/api/admin/products/${product.id}/status`)
      .set(bearer(token))
      .send({ status: 'published' })
    expect(republish.status).toBe(200)
    const editPolicy = await request
      .put(`/api/admin/pages/${policy.id}`)
      .set(bearer(token))
      .send({ title: 'Đổi trả mới', body: 'Đổi trong 3 ngày' })
    expect(editPolicy.status).toBe(200)
    const republishPolicy = await request.post(`/api/admin/pages/${policy.id}/publish`).set(bearer(token))
    expect(republishPolicy.body.version).toBe(2)
    const fees = await request
      .put('/api/admin/shipping-fees')
      .set(bearer(token))
      .send({ defaultFee: 50_000, freeShippingThreshold: null, provinceFees: [] })
    expect(fees.status).toBe(200)

    const after = await request.get(`/api/orders/${placed.body.code}`).query({ token: placed.body.token })
    expect(after.body).toEqual(before.body)
    expect(after.body).toMatchObject({
      lines: [expect.objectContaining({ productName: 'Air Max', price: 2_000_000 })],
      shippingFee: 30_000,
      policies: [{ slug: 'doi-tra', title: 'Đổi trả', version: 1 }],
    })
  })
})

describe('tra cứu đơn bằng token', () => {
  it('token sai, thiếu token hay mã lạ đều là 404 như nhau', async () => {
    const { request, checkout } = await shop()
    const placed = await checkout()

    const wrong = await request.get(`/api/orders/${placed.body.code}`).query({ token: 'sai' })
    const missing = await request.get(`/api/orders/${placed.body.code}`)
    const unknown = await request.get('/api/orders/999999').query({ token: placed.body.token })

    for (const res of [wrong, missing, unknown]) {
      expect(res.status).toBe(404)
      expect(res.body.error.message).toBe('Không tìm thấy đơn hàng')
    }
  })
})

describe('kho khi có hàng đang giữ', () => {
  it('điều chỉnh tồn xuống dưới số đang giữ thì 409 kèm mã các đơn đang giữ; phiếu nhập vẫn được', async () => {
    const { request, token, checkout, v40 } = await shop()
    const first = await checkout()
    const second = await checkout()

    const down = await request
      .post('/api/admin/stock/adjustments')
      .set(bearer(token))
      .send({ variantId: v40.id, reason: 'lost', quantity: 2, expectedOnHand: 3 })
    const receipt = await request
      .post('/api/admin/stock/receipts')
      .set(bearer(token))
      .send({ supplierName: 'Lô 2', receivedOn: '2026-11-02', lines: [{ sku: 'AM-40', quantity: 2 }] })
    const stillOk = await request
      .post('/api/admin/stock/adjustments')
      .set(bearer(token))
      .send({ variantId: v40.id, reason: 'lost', quantity: 3, expectedOnHand: 5 })

    expect(down.status).toBe(409)
    expect(down.body.error.details).toEqual({ reserved: 2, orderCodes: [first.body.code, second.body.code] })
    expect(down.body.error.fields).toEqual([{ path: 'quantity', message: expect.stringContaining('#100000, #100001') }])
    expect(receipt.status).toBe(201)
    expect(stillOk.status).toBe(201)
    expect(stillOk.body).toMatchObject({ onHand: 2, reserved: 2 })
  })
})

describe('lịch sử đơn', () => {
  it('đặt mua ghi sự kiện tạo đơn; bảng sự kiện không sửa, không xóa được', async () => {
    const { prisma, checkout } = await shop()
    await checkout()

    // Chưa có API đọc lịch sử đơn (ticket 07), nên đọc và thử sửa bằng SQL trực tiếp.
    const events = await prisma.$queryRaw<{ kind: string; actor: string }[]>`
      SELECT "kind", "actor"::text AS actor FROM "order_event"`
    expect(events).toEqual([{ kind: 'created', actor: 'customer' }])
    await expect(prisma.$executeRaw`UPDATE "order_event" SET "kind" = 'x'`).rejects.toThrow(/chỉ cho phép thêm mới/)
    await expect(prisma.$executeRaw`DELETE FROM "order_event"`).rejects.toThrow(/chỉ cho phép thêm mới/)
    await expect(prisma.$executeRaw`TRUNCATE "order_event" CASCADE`).rejects.toThrow(/chỉ cho phép thêm mới/)
  })
})
