import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { InMemoryStorage } from '../src/adapters/storage.ts'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

/** Owner đã đăng nhập, có sẵn sản phẩm nháp Air Max 90 với hai biến thể Đen 40 và Trắng 40. */
async function sneakerWithVariants() {
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
  const variants = '/api/admin/products/' + product.id + '/variants'
  const black = await post(app.request, token, variants, { sku: 'AM90-DEN-40', attributes: { mau: 'Đen', size: '40' } })
  const white = await post(app.request, token, variants, {
    sku: 'AM90-TRANG-40',
    attributes: { mau: 'Trắng', size: '40' },
  })
  return { ...app, token, brand, product, black, white }
}

function photo(width = 2000, height = 1500, format: 'jpeg' | 'png' | 'webp' = 'jpeg') {
  return sharp({ create: { width, height, channels: 3, background: '#a33' } })
    .toFormat(format)
    .toBuffer()
}

function upload(request: Request, token: string, productId: string, file: Buffer, filename = 'anh.jpg', alt?: string) {
  const req = request.post(`/api/admin/products/${productId}/images`).set(bearer(token))
  if (alt !== undefined) req.field('alt', alt)
  return req.attach('file', file, filename)
}

/** File mà URL công khai trỏ tới, đọc từ storage giả. */
function publicObject(storage: InMemoryStorage, url: string) {
  expect(url.startsWith('memory://public/')).toBe(true)
  return storage.objects.get(`public/${url.slice('memory://public/'.length)}`)
}

type Image = {
  id: string
  alt: string
  sortOrder: number
  variantIds: string[]
  width: number
  height: number
  originalUrl: string
  sizes: { width: number; url: string }[]
}

describe('tải ảnh sản phẩm', () => {
  it('upload ảnh hợp lệ giữ bản gốc và sinh đủ các cỡ webp trên storage public', async () => {
    const { request, token, product, storage } = await sneakerWithVariants()
    const original = await photo(2000, 1500)

    const res = await upload(request, token, product.id, original, 'giay.jpg', 'Air Max 90 nhìn nghiêng')

    expect(res.status).toBe(201)
    const image = res.body as Image
    expect(image).toMatchObject({
      alt: 'Air Max 90 nhìn nghiêng',
      sortOrder: 0,
      variantIds: [],
      width: 2000,
      height: 1500,
    })
    expect(publicObject(storage, image.originalUrl)).toMatchObject({ contentType: 'image/jpeg', body: original })
    expect(image.sizes.map((s) => s.width)).toEqual([320, 640, 1024, 1600])
    for (const size of image.sizes) {
      const stored = publicObject(storage, size.url)
      expect(stored?.contentType).toBe('image/webp')
      const meta = await sharp(stored!.body).metadata()
      expect({ format: meta.format, width: meta.width }).toEqual({ format: 'webp', width: size.width })
    }
  })

  it('file giả mạo đuôi ảnh bị từ chối theo nội dung thật, không có gì lên storage', async () => {
    const { request, token, product, storage } = await sneakerWithVariants()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .gif()
      .toBuffer()

    const responses = [
      await upload(request, token, product.id, Buffer.from('không phải ảnh'), 'giay.jpg'),
      await upload(request, token, product.id, svg, 'giay.png'),
      await upload(request, token, product.id, gif, 'giay.webp'),
    ]

    for (const res of responses) {
      expect(res.status).toBe(400)
      expect(res.body.error.fields).toEqual([{ path: 'file', message: 'File không phải ảnh jpeg, png hoặc webp' }])
    }
    expect(storage.objects.size).toBe(0)
  })

  it('nhận cả png và webp, ảnh mới xếp cuối', async () => {
    const { request, token, product } = await sneakerWithVariants()

    const png = await upload(request, token, product.id, await photo(800, 800, 'png'), 'anh.png')
    const webp = await upload(request, token, product.id, await photo(800, 800, 'webp'), 'anh')

    expect([png.status, webp.status]).toEqual([201, 201])
    expect(png.body.originalUrl).toMatch(/original\.png$/)
    expect(webp.body.originalUrl).toMatch(/original\.webp$/)
    expect([png.body.sortOrder, webp.body.sortOrder]).toEqual([0, 1])
  })

  it('ảnh quá 10 MB bị từ chối với 413', async () => {
    const { request, token, product, storage } = await sneakerWithVariants()
    const huge = Buffer.concat([await photo(100, 100), Buffer.alloc(10 * 1024 * 1024)])

    const res = await upload(request, token, product.id, huge)

    expect(res.status).toBe(413)
    expect(res.body.error.fields).toEqual([{ path: 'file', message: 'Ảnh vượt quá 10 MB' }])
    expect(storage.objects.size).toBe(0)
  })

  it('thiếu file thì 400; sản phẩm không có thì 404', async () => {
    const { request, token, product } = await sneakerWithVariants()

    const missing = await request.post(`/api/admin/products/${product.id}/images`).set(bearer(token)).field('alt', 'x')
    const unknown = await upload(request, token, '00000000-0000-4000-8000-000000000000', await photo(100, 100))

    expect(missing.status).toBe(400)
    expect(missing.body.error.fields).toEqual([{ path: 'file', message: 'Chưa chọn file ảnh' }])
    expect(unknown.status).toBe(404)
  })
})

function editImage(request: Request, token: string, productId: string, imageId: string, body: Record<string, unknown>) {
  return request.put(`/api/admin/products/${productId}/images/${imageId}`).set(bearer(token)).send(body)
}

function reorder(request: Request, token: string, productId: string, imageIds: string[]) {
  return request.put(`/api/admin/products/${productId}/images/order`).set(bearer(token)).send({ imageIds })
}

function listImages(request: Request, token: string, productId: string) {
  return request
    .get(`/api/admin/products/${productId}/images`)
    .set(bearer(token))
    .then((res) => res.body.items as Image[])
}

function auditOf(request: Request, token: string, entityType: string) {
  return request
    .get('/api/admin/audit')
    .query({ entityType })
    .set(bearer(token))
    .then((res) => res.body.items as { action: string; entityId: string; before: unknown; after: unknown }[])
}

/** Sản phẩm thứ hai cùng thương hiệu, danh mục với Air Max 90. */
async function secondProduct(request: Request, token: string, productId: string) {
  const first = await request.get(`/api/admin/products/${productId}`).set(bearer(token))
  return post(request, token, '/api/admin/products', {
    brandId: first.body.brandId,
    categoryId: first.body.categoryId,
    name: 'Air Force 1',
    slug: 'air-force-1',
    attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
  })
}

describe('alt text và gắn ảnh vào biến thể', () => {
  it('sửa alt text và gắn ảnh vào nhiều biến thể của chính sản phẩm đó, có ghi audit', async () => {
    const { request, token, product, black, white } = await sneakerWithVariants()
    const image = (await upload(request, token, product.id, await photo(100, 100))).body as Image
    const both = [black.id, white.id].sort()

    const res = await editImage(request, token, product.id, image.id, {
      alt: 'Màu đen và trắng',
      variantIds: [white.id, black.id, black.id],
    })
    const [listed] = await listImages(request, token, product.id)
    const audit = await auditOf(request, token, 'product_image')

    expect(res.status).toBe(200)
    expect(res.body.variantIds).toEqual(both)
    expect(listed).toEqual(res.body)
    expect(audit.map((a) => a.action)).toEqual(['media.product_image.update', 'media.product_image.upload'])
    expect(audit[0]).toMatchObject({
      entityId: image.id,
      before: { alt: '', variantIds: [] },
      after: { alt: 'Màu đen và trắng', variantIds: both },
    })
  })

  it('gắn ảnh vào biến thể của sản phẩm khác bị từ chối', async () => {
    const { request, token, product, black } = await sneakerWithVariants()
    const other = await secondProduct(request, token, product.id)
    const image = (await upload(request, token, other.id, await photo(100, 100))).body as Image

    const res = await editImage(request, token, other.id, image.id, { alt: '', variantIds: [black.id] })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([
      { path: 'variantIds.0', message: 'Chỉ gắn được ảnh vào biến thể của chính sản phẩm này' },
    ])
    expect((await listImages(request, token, other.id))[0]?.variantIds).toEqual([])
  })

  it('ảnh của sản phẩm khác thì 404', async () => {
    const { request, token, product } = await sneakerWithVariants()
    const image = (await upload(request, token, product.id, await photo(100, 100))).body as Image
    const other = await secondProduct(request, token, product.id)

    const res = await editImage(request, token, other.id, image.id, { alt: 'x', variantIds: [] })

    expect(res.status).toBe(404)
  })

  it('lưu lại đúng nội dung hiện tại thì không ghi audit', async () => {
    const { request, token, product, black } = await sneakerWithVariants()
    const image = (await upload(request, token, product.id, await photo(100, 100))).body as Image
    await editImage(request, token, product.id, image.id, { alt: 'Đen', variantIds: [black.id] })

    const again = await editImage(request, token, product.id, image.id, { alt: 'Đen', variantIds: [black.id] })

    expect(again.status).toBe(200)
    expect(await auditOf(request, token, 'product_image')).toHaveLength(2)
  })
})

describe('thứ tự ảnh', () => {
  it('sắp lại thứ tự ảnh, ghi audit thứ tự cũ và mới', async () => {
    const { request, token, product } = await sneakerWithVariants()
    const ids: string[] = []
    for (const alt of ['một', 'hai', 'ba']) {
      ids.push((await upload(request, token, product.id, await photo(100, 100), 'a.jpg', alt)).body.id)
    }
    const order = [ids[2]!, ids[0]!, ids[1]!]

    const res = await reorder(request, token, product.id, order)
    const listed = await listImages(request, token, product.id)
    const [entry] = await auditOf(request, token, 'product')

    expect(res.status).toBe(200)
    expect(listed.map((i) => [i.alt, i.sortOrder])).toEqual([
      ['ba', 0],
      ['một', 1],
      ['hai', 2],
    ])
    expect(entry).toMatchObject({
      action: 'media.product_image.reorder',
      entityId: product.id,
      before: { imageIds: ids },
      after: { imageIds: order },
    })
  })

  it('thứ tự thiếu ảnh, thừa ảnh hoặc lặp ảnh bị từ chối', async () => {
    const { request, token, product } = await sneakerWithVariants()
    const a = (await upload(request, token, product.id, await photo(100, 100))).body.id as string
    const b = (await upload(request, token, product.id, await photo(100, 100))).body.id as string

    for (const imageIds of [[a], [a, b, '00000000-0000-4000-8000-000000000000'], [a, a]]) {
      const res = await reorder(request, token, product.id, imageIds)
      expect(res.status).toBe(400)
      expect(res.body.error.fields[0].path).toBe('imageIds')
    }
  })
})

describe('xóa ảnh', () => {
  it('xóa ảnh thì xóa cả bản gốc và mọi cỡ trên storage, có ghi audit', async () => {
    const { request, token, product, storage, black } = await sneakerWithVariants()
    const keep = (await upload(request, token, product.id, await photo(100, 100))).body as Image
    const image = (await upload(request, token, product.id, await photo(100, 100))).body as Image
    await editImage(request, token, product.id, image.id, { alt: 'Đen', variantIds: [black.id] })

    const res = await request.delete(`/api/admin/products/${product.id}/images/${image.id}`).set(bearer(token))
    const [entry] = await auditOf(request, token, 'product_image')

    expect(res.status).toBe(204)
    for (const url of [image.originalUrl, ...image.sizes.map((s) => s.url)]) {
      expect(publicObject(storage, url)).toBeUndefined()
    }
    expect(publicObject(storage, keep.originalUrl)).toBeDefined()
    expect((await listImages(request, token, product.id)).map((i) => i.id)).toEqual([keep.id])
    expect(entry).toMatchObject({
      action: 'media.product_image.delete',
      entityId: image.id,
      before: { alt: 'Đen', variantIds: [black.id] },
    })
  })
})

describe('quyền với ảnh sản phẩm', () => {
  it('thiếu media.upload thì 403 với mọi thao tác ghi; kế toán vẫn xem được ảnh', async () => {
    const { request, token, product } = await sneakerWithVariants()
    const image = (await upload(request, token, product.id, await photo(100, 100))).body as Image
    const accountant = await createStaff(request, token, ['accountant'])
    const other = accountant.accessToken

    const attempts = [
      await upload(request, other, product.id, await photo(100, 100)),
      await editImage(request, other, product.id, image.id, { alt: 'x', variantIds: [] }),
      await reorder(request, other, product.id, [image.id]),
      await request.delete(`/api/admin/products/${product.id}/images/${image.id}`).set(bearer(other)),
    ]
    const listed = await listImages(request, other, product.id)

    expect(attempts.map((r) => r.status)).toEqual([403, 403, 403, 403])
    expect(listed.map((i) => i.id)).toEqual([image.id])
  })

  it('nhân viên bán hàng có media.upload thì tải được ảnh', async () => {
    const { request, token, product } = await sneakerWithVariants()
    const sales = await createStaff(request, token, ['sales'])

    const res = await upload(request, sales.accessToken, product.id, await photo(100, 100))

    expect(res.status).toBe(201)
  })
})
