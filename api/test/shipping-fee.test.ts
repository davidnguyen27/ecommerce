import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'
import { adjust } from './support/stock.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

const photo = () =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: '#333' } })
    .jpeg()
    .toBuffer()

/** Owner đã đăng nhập, có giày Air Max đã xuất bản: AM-40 giá 2.000.000 còn 3 đôi, AM-41 giá 2.100.000 hết hàng. */
async function shop({ groundShippingOnly = false } = {}) {
  const app = await appWithOwner()
  const { accessToken: token } = await login(app.request, OWNER.email, OWNER.password)
  const brand = await post(app.request, token, '/api/admin/brands', { name: 'Nike', slug: 'nike' })
  const category = await post(app.request, token, '/api/admin/categories', {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
  })
  const product = await post(app.request, token, '/api/admin/products', {
    brandId: brand.id,
    categoryId: category.id,
    name: 'Air Max',
    slug: 'air-max',
    attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
    groundShippingOnly,
  })
  const variant = (sku: string, size: string, price: number) =>
    post(app.request, token, `/api/admin/products/${product.id}/variants`, {
      sku,
      attributes: { mau: 'Đen', size },
      price,
    })
  const v40 = await variant('AM-40', '40', 2_000_000)
  const v41 = await variant('AM-41', '41', 2_100_000)
  const image = await app.request
    .post(`/api/admin/products/${product.id}/images`)
    .set(bearer(token))
    .attach('file', await photo(), 'anh.jpg')
  expect(image.status).toBe(201)
  const publish = await app.request
    .put(`/api/admin/products/${product.id}/status`)
    .set(bearer(token))
    .send({ status: 'published' })
  expect(publish.status).toBe(200)
  await adjust(app.request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 3, expectedOnHand: 0 })

  const configure = (body: Record<string, unknown>) =>
    app.request.put('/api/admin/shipping-fees').set(bearer(token)).send(body)
  const quote = (body: Record<string, unknown>) => app.request.post('/api/checkout/quote').send(body)
  return { ...app, token, product, v40, v41, configure, quote }
}

const HA_NOI = '01'
const HO_CHI_MINH = '79'

describe('báo giá đặt mua', () => {
  it('chưa cấu hình mức phí giao mặc định thì 503 "Cửa hàng chưa sẵn sàng nhận đơn"', async () => {
    const { quote, v40 } = await shop()

    const res = await quote({ lines: [{ variantId: v40.id, quantity: 1 }], provinceCode: HA_NOI })

    expect(res.status).toBe(503)
    expect(res.body.error.message).toBe('Cửa hàng chưa sẵn sàng nhận đơn')
  })

  it('mức riêng của tỉnh/thành thắng mức mặc định; tổng phải trả gồm phí giao', async () => {
    const { quote, configure, v40 } = await shop()
    expect(
      (
        await configure({
          defaultFee: 40_000,
          freeShippingThreshold: null,
          provinceFees: [{ provinceCode: HO_CHI_MINH, fee: 25_000 }],
        })
      ).status,
    ).toBe(200)

    const hcm = await quote({ lines: [{ variantId: v40.id, quantity: 2 }], provinceCode: HO_CHI_MINH })
    const hn = await quote({ lines: [{ variantId: v40.id, quantity: 2 }], provinceCode: HA_NOI })

    expect(hcm.status).toBe(200)
    expect(hcm.body).toMatchObject({ subtotal: 4_000_000, shippingFee: 25_000, total: 4_025_000 })
    expect(hn.body).toMatchObject({ subtotal: 4_000_000, shippingFee: 40_000, total: 4_040_000 })
  })
})

describe('báo giá: phí giao', () => {
  it('tổng tiền hàng từ ngưỡng miễn phí trở lên thì phí giao bằng 0, dưới ngưỡng thì vẫn tính', async () => {
    const { quote, configure, v40 } = await shop()
    await configure({
      defaultFee: 30_000,
      freeShippingThreshold: 4_000_000,
      provinceFees: [{ provinceCode: HA_NOI, fee: 20_000 }],
    })

    const reached = await quote({ lines: [{ variantId: v40.id, quantity: 2 }], provinceCode: HA_NOI })
    const below = await quote({ lines: [{ variantId: v40.id, quantity: 1 }], provinceCode: HA_NOI })

    expect(reached.body).toMatchObject({
      subtotal: 4_000_000,
      shippingFee: 0,
      total: 4_000_000,
      freeShippingThreshold: 4_000_000,
    })
    expect(below.body).toMatchObject({ subtotal: 2_000_000, shippingFee: 20_000, total: 2_020_000 })
  })

  it('không gửi tỉnh/thành (trang giỏ hàng) thì chưa tính phí giao và tổng phải trả', async () => {
    const { quote, configure, v40 } = await shop()
    await configure({ defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] })

    const res = await quote({ lines: [{ variantId: v40.id, quantity: 1 }] })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ subtotal: 2_000_000, shippingFee: null, total: null })
  })

  it('mã tỉnh/thành không có trong danh mục hành chính bị từ chối theo trường', async () => {
    const { quote, configure, v40 } = await shop()
    await configure({ defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] })

    // 02 là Hà Giang cũ, đã nhập vào Tuyên Quang từ 01/07/2025.
    const res = await quote({ lines: [{ variantId: v40.id, quantity: 1 }], provinceCode: '02' })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([expect.objectContaining({ path: 'provinceCode' })])
  })
})

describe('báo giá: từng dòng', () => {
  it('trả giá hiện tại, còn hàng hay hết theo từng dòng; dòng hết hàng không vào tổng tiền hàng', async () => {
    const { quote, configure, v40, v41 } = await shop()
    await configure({ defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] })

    const res = await quote({
      lines: [
        { variantId: v40.id, quantity: 1 },
        { variantId: v41.id, quantity: 2 },
      ],
    })

    expect(res.body.lines).toEqual([
      expect.objectContaining({
        variantId: v40.id,
        quantity: 1,
        product: { slug: 'air-max', name: 'Air Max' },
        sku: 'AM-40',
        attributes: { mau: 'Đen', size: '40' },
        image: expect.objectContaining({ originalUrl: expect.any(String) }),
        price: 2_000_000,
        lineTotal: 2_000_000,
        discontinued: false,
        inStock: true,
      }),
      expect.objectContaining({ variantId: v41.id, price: 2_100_000, lineTotal: null, inStock: false }),
    ])
    expect(res.body.subtotal).toBe(2_000_000)
    expect(res.body.groundShippingOnly).toBe(false)
  })

  it('giá đổi sau khi thêm vào giỏ thì báo giá theo giá mới', async () => {
    const { request, token, quote, configure, product, v40 } = await shop()
    await configure({ defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] })
    const reprice = await request
      .put(`/api/admin/products/${product.id}/variants/${v40.id}`)
      .set(bearer(token))
      .send({ sku: 'AM-40', attributes: { mau: 'Đen', size: '40' }, price: 1_800_000 })
    expect(reprice.status).toBe(200)

    const res = await quote({ lines: [{ variantId: v40.id, quantity: 1 }] })

    expect(res.body.lines[0]).toMatchObject({ price: 1_800_000, lineTotal: 1_800_000 })
  })

  it('biến thể ngừng bán, sản phẩm thôi xuất bản hoặc id lạ đều là dòng ngừng bán, không có giá', async () => {
    const { request, token, quote, configure, product, v40, v41 } = await shop()
    await configure({ defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] })
    const discontinue = await request
      .put(`/api/admin/products/${product.id}/variants/${v41.id}`)
      .set(bearer(token))
      .send({ sku: 'AM-41', attributes: { mau: 'Đen', size: '41' }, price: 2_100_000, status: 'discontinued' })
    expect(discontinue.status).toBe(200)
    const unknown = '00000000-0000-4000-8000-000000000000'

    const discontinued = await quote({ lines: [{ variantId: v41.id, quantity: 1 }] })
    const archive = await request
      .put(`/api/admin/products/${product.id}/status`)
      .set(bearer(token))
      .send({ status: 'archived' })
    expect(archive.status).toBe(200)
    const unpublished = await quote({
      lines: [
        { variantId: v40.id, quantity: 1 },
        { variantId: unknown, quantity: 1 },
      ],
    })

    expect(discontinued.body.lines[0]).toMatchObject({
      product: { slug: 'air-max' },
      discontinued: true,
      price: null,
      lineTotal: null,
      inStock: false,
    })
    expect(unpublished.body.lines).toEqual([
      expect.objectContaining({ variantId: v40.id, product: null, discontinued: true, price: null }),
      expect.objectContaining({ variantId: unknown, product: null, discontinued: true, price: null }),
    ])
    expect(unpublished.body.subtotal).toBe(0)
  })

  it('có sản phẩm chỉ giao đường bộ thì bật cờ giao đường bộ', async () => {
    const { quote, configure, v40 } = await shop({ groundShippingOnly: true })
    await configure({ defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] })

    const res = await quote({ lines: [{ variantId: v40.id, quantity: 1 }] })

    expect(res.body.groundShippingOnly).toBe(true)
  })

  it('quá 5 cái mỗi biến thể bị từ chối theo dòng', async () => {
    const { quote, configure, v40 } = await shop()
    await configure({ defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] })

    const res = await quote({ lines: [{ variantId: v40.id, quantity: 6 }] })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([expect.objectContaining({ path: 'lines.0.quantity' })])
  })
})

describe('cấu hình phí giao ở trang quản trị', () => {
  it('chưa cấu hình thì chưa có mức mặc định; lưu xong đọc lại đúng cấu hình, mức riêng theo mã tỉnh', async () => {
    const { request, token, configure } = await shop()
    const empty = await request.get('/api/admin/shipping-fees').set(bearer(token))

    const saved = await configure({
      defaultFee: 35_000,
      freeShippingThreshold: 1_000_000,
      provinceFees: [
        { provinceCode: HO_CHI_MINH, fee: 20_000 },
        { provinceCode: HA_NOI, fee: 25_000 },
      ],
    })
    const read = await request.get('/api/admin/shipping-fees').set(bearer(token))

    expect(empty.body).toEqual({ defaultFee: null, freeShippingThreshold: null, provinceFees: [] })
    expect(saved.status).toBe(200)
    expect(read.body).toEqual({
      defaultFee: 35_000,
      freeShippingThreshold: 1_000_000,
      provinceFees: [
        { provinceCode: HA_NOI, fee: 25_000 },
        { provinceCode: HO_CHI_MINH, fee: 20_000 },
      ],
    })
  })

  it('nhân viên thiếu quyền price.edit không xem, không sửa được phí giao (403)', async () => {
    const { request, token } = await shop()
    const { accessToken } = await createStaff(request, token, ['warehouse'])

    const read = await request.get('/api/admin/shipping-fees').set(bearer(accessToken))
    const write = await request
      .put('/api/admin/shipping-fees')
      .set(bearer(accessToken))
      .send({ defaultFee: 0, freeShippingThreshold: null, provinceFees: [] })

    expect(read.status).toBe(403)
    expect(write.status).toBe(403)
  })

  it('kế toán (price.edit) sửa được; mỗi lần đổi ghi audit shipping.fee.update kèm before/after, sửa không đổi gì thì không ghi', async () => {
    const { request, token } = await shop()
    const { accessToken } = await createStaff(request, token, ['accountant'])
    const put = (body: Record<string, unknown>) =>
      request.put('/api/admin/shipping-fees').set(bearer(accessToken)).send(body)
    const first = { defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] }
    const second = {
      defaultFee: 30_000,
      freeShippingThreshold: 2_000_000,
      provinceFees: [{ provinceCode: HA_NOI, fee: 0 }],
    }

    await put(first)
    await put(second)
    const unchanged = await put(second)
    const audit = await request.get('/api/admin/audit').query({ entityType: 'shipping_fee' }).set(bearer(token))

    expect(unchanged.status).toBe(200)
    expect(unchanged.body).toEqual(second)
    expect(audit.body.items).toEqual([
      expect.objectContaining({ action: 'shipping.fee.update', before: first, after: second }),
      expect.objectContaining({
        action: 'shipping.fee.update',
        before: { defaultFee: null, freeShippingThreshold: null, provinceFees: [] },
        after: first,
      }),
    ])
  })

  it('mã tỉnh/thành sai, tỉnh lặp hoặc số tiền âm bị từ chối theo trường, không ghi gì', async () => {
    const { request, token, configure } = await shop()

    const res = await configure({
      defaultFee: -1,
      freeShippingThreshold: null,
      provinceFees: [
        { provinceCode: '99', fee: 10_000 },
        { provinceCode: HA_NOI, fee: 10_000 },
        { provinceCode: HA_NOI, fee: 15_000 },
      ],
    })
    const read = await request.get('/api/admin/shipping-fees').set(bearer(token))

    expect(res.status).toBe(400)
    expect(res.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual([
      'defaultFee',
      'provinceFees.0.provinceCode',
      'provinceFees.2.provinceCode',
    ])
    expect(read.body.defaultFee).toBeNull()
  })
})
