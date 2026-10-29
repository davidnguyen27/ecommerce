import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

const photo = (background = '#a33') =>
  sharp({ create: { width: 64, height: 64, channels: 3, background } })
    .jpeg()
    .toBuffer()

/** Owner đã đăng nhập, sản phẩm Air Max 90 có biến thể AM90-DEN-40, AM90-TRANG-41 và một ảnh chung có sẵn. */
async function catalog() {
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
    name: 'Air Max 90',
    slug: 'air-max-90',
    attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
  })
  const black = await post(app.request, token, `/api/admin/products/${product.id}/variants`, {
    sku: 'AM90-DEN-40',
    attributes: { mau: 'Đen', size: '40' },
  })
  const white = await post(app.request, token, `/api/admin/products/${product.id}/variants`, {
    sku: 'AM90-TRANG-41',
    attributes: { mau: 'Trắng', size: '41' },
  })
  const existing = await app.request
    .post(`/api/admin/products/${product.id}/images`)
    .set(bearer(token))
    .attach('file', await photo(), 'chung.jpg')
  expect(existing.status).toBe(201)
  return { ...app, token, product, black, white, existingImage: existing.body as { id: string } }
}

const uploadBySku = async (request: Request, token: string, fileName: string, file?: Buffer) =>
  request
    .post('/api/admin/images/by-sku')
    .set(bearer(token))
    .attach('file', file ?? (await photo()), fileName)

const imagesOf = async (request: Request, token: string, productId: string) => {
  const res = await request.get(`/api/admin/products/${productId}/images`).set(bearer(token))
  return res.body.items as { id: string; variantIds: string[] }[]
}

describe('tải ảnh theo SKU', () => {
  it('ảnh tên <SKU>.jpg và <SKU>_<n>.jpg gắn vào đúng sản phẩm, đúng biến thể, nối sau ảnh có sẵn', async () => {
    const { request, token, product, black, white, existingImage } = await catalog()

    const first = await uploadBySku(request, token, 'AM90-DEN-40.jpg')
    const second = await uploadBySku(request, token, 'AM90-DEN-40_2.jpg')
    const third = await uploadBySku(
      request,
      token,
      'AM90-TRANG-41_1.png',
      await sharp({ create: { width: 32, height: 32, channels: 3, background: '#fff' } })
        .png()
        .toBuffer(),
    )
    const images = await imagesOf(request, token, product.id)

    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ productId: product.id, sku: 'AM90-DEN-40' })
    expect(images.map((i) => [i.id, i.variantIds])).toEqual([
      [existingImage.id, []],
      [first.body.image.id, [black.id]],
      [second.body.image.id, [black.id]],
      [third.body.image.id, [white.id]],
    ])
  })

  it('SKU viết thường trong tên file vẫn khớp; SKU có dấu gạch dưới được ưu tiên khớp cả tên', async () => {
    const { request, token, product } = await catalog()
    const underscore = await post(request, token, `/api/admin/products/${product.id}/variants`, {
      sku: 'AM90_42',
      attributes: { mau: 'Xám', size: '42' },
    })

    const lower = await uploadBySku(request, token, 'am90-den-40_3.jpeg')
    const withUnderscore = await uploadBySku(request, token, 'AM90_42.jpg')

    expect(lower.status).toBe(201)
    expect(lower.body.sku).toBe('AM90-DEN-40')
    expect(withUnderscore.body).toMatchObject({ sku: 'AM90_42', image: { variantIds: [underscore.id] } })
  })

  it('SKU không tồn tại thì lỗi và không có ảnh nào được lưu', async () => {
    const { request, token, product, storage } = await catalog()
    const objectsBefore = storage.objects.size

    const res = await uploadBySku(request, token, 'KHONG-CO_1.jpg')

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([expect.objectContaining({ path: 'file' })])
    expect(res.body.error.message).toContain('KHONG-CO')
    expect(storage.objects.size).toBe(objectsBefore)
    expect(await imagesOf(request, token, product.id)).toHaveLength(1)
  })

  it('file không phải ảnh bị từ chối', async () => {
    const { request, token } = await catalog()

    const res = await uploadBySku(request, token, 'AM90-DEN-40.jpg', Buffer.from('%PDF-1.4 không phải ảnh'))

    expect(res.status).toBe(400)
  })

  it('thiếu media.upload thì 403', async () => {
    const { request, token } = await catalog()
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')

    expect((await uploadBySku(request, accountant.accessToken, 'AM90-DEN-40.jpg')).status).toBe(403)
  })
})
