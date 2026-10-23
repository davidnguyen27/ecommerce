import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

const BLACK_40 = { sku: 'AM90-DEN-40', attributes: { mau: 'Đen', size: '40' }, price: 3_500_000 }
const WHITE_41 = { sku: 'AM90-TRANG-41', attributes: { mau: 'Trắng', size: '41' }, price: 3_200_000 }

function sneaker(brandId: string, categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    brandId,
    categoryId,
    name: 'Air Max 90',
    slug: 'air-max-90',
    modelCode: 'CN8490-002',
    description: 'Giày chạy bộ cổ thấp.',
    usageCare: 'Lau bằng khăn ẩm.',
    sizeChart: { columns: ['EU', 'Chiều dài chân (cm)'], rows: [['40', '25']] },
    originStatement: 'Nhập khẩu từ Nike Mỹ.',
    attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
    ...overrides,
  }
}

/** Owner đã đăng nhập; có thương hiệu Nike, danh mục Giày dép > Sneaker > Chạy bộ và sản phẩm nháp Air Max 90 chưa có gì. */
async function catalog() {
  const app = await appWithOwner()
  const { accessToken: token } = await login(app.request, OWNER.email, OWNER.password)
  const brand = await post(app.request, token, '/api/admin/brands', { name: 'Nike', slug: 'nike' })
  const sneakers = await post(app.request, token, '/api/admin/categories', {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
  })
  const running = await post(app.request, token, '/api/admin/categories', {
    name: 'Chạy bộ',
    slug: 'chay-bo',
    productType: 'footwear',
    parentId: sneakers.id,
  })
  const product = await post(app.request, token, '/api/admin/products', sneaker(brand.id, running.id))
  return { ...app, token, brand, sneakers, running, product }
}

const photo = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: '#a33' } })
    .jpeg()
    .toBuffer()

async function uploadImage(request: Request, token: string, productId: string, alt = 'Ảnh') {
  const res = await request
    .post(`/api/admin/products/${productId}/images`)
    .set(bearer(token))
    .field('alt', alt)
    .attach('file', await photo(), 'anh.jpg')
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

function setStatus(request: Request, token: string, productId: string, status: string) {
  return request.put(`/api/admin/products/${productId}/status`).set(bearer(token)).send({ status })
}

/** Sản phẩm đủ điều kiện xuất bản: hai biến thể đang bán có giá và một ảnh. */
async function readyToPublish() {
  const app = await catalog()
  const variants = `/api/admin/products/${app.product.id}/variants`
  const black = await post(app.request, app.token, variants, BLACK_40)
  const white = await post(app.request, app.token, variants, WHITE_41)
  const image = await uploadImage(app.request, app.token, app.product.id)
  return { ...app, black, white, image }
}

async function published() {
  const app = await readyToPublish()
  const res = await setStatus(app.request, app.token, app.product.id, 'published')
  expect(res.status).toBe(200)
  return app
}

describe('xuất bản sản phẩm', () => {
  it('sản phẩm chưa có biến thể và chưa có ảnh thì không xuất bản được, lỗi nêu từng lý do', async () => {
    const { request, token, product } = await catalog()

    const res = await setStatus(request, token, product.id, 'published')

    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([
      { path: 'variants', message: 'Cần ít nhất một biến thể đang bán' },
      { path: 'images', message: 'Cần ít nhất một ảnh' },
    ])
    const detail = await request.get(`/api/admin/products/${product.id}`).set(bearer(token))
    expect(detail.body.status).toBe('draft')
  })

  it('có biến thể đang bán nhưng thiếu ảnh thì không xuất bản được', async () => {
    const { request, token, product } = await catalog()
    await post(request, token, `/api/admin/products/${product.id}/variants`, BLACK_40)

    const res = await setStatus(request, token, product.id, 'published')

    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([{ path: 'images', message: 'Cần ít nhất một ảnh' }])
  })

  it('chỉ có biến thể ngừng bán thì không xuất bản được', async () => {
    const { request, token, product } = await catalog()
    await post(request, token, `/api/admin/products/${product.id}/variants`, { ...BLACK_40, status: 'discontinued' })
    await uploadImage(request, token, product.id)

    const res = await setStatus(request, token, product.id, 'published')

    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([{ path: 'variants', message: 'Cần ít nhất một biến thể đang bán' }])
  })

  it('biến thể đang bán chưa có giá thì không xuất bản được', async () => {
    const { request, token, product } = await catalog()
    await post(request, token, `/api/admin/products/${product.id}/variants`, BLACK_40)
    await post(request, token, `/api/admin/products/${product.id}/variants`, { ...WHITE_41, price: undefined })
    await uploadImage(request, token, product.id)

    const res = await setStatus(request, token, product.id, 'published')

    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([
      { path: 'variants.1.price', message: 'Biến thể AM90-TRANG-41 đang bán nhưng chưa có giá' },
    ])
  })

  it('đủ điều kiện thì xuất bản được, tạo phiên bản 1 và ghi audit', async () => {
    const { request, token, product } = await readyToPublish()

    const res = await setStatus(request, token, product.id, 'published')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      status: 'published',
      liveVersion: { version: 1, publishedAt: expect.any(String) },
      hasUnpublishedChanges: false,
    })
    const audit = await request.get('/api/admin/audit').query({ entityType: 'product' }).set(bearer(token))
    expect(audit.body.items[0]).toMatchObject({
      action: 'catalog.product.publish',
      entityId: product.id,
      before: { status: 'draft', liveVersion: null },
      after: { status: 'published', liveVersion: 1 },
    })
  })

  it('xuất bản lại khi không có gì thay đổi thì không tạo phiên bản mới và không ghi audit', async () => {
    const { request, token, product } = await published()

    const again = await setStatus(request, token, product.id, 'published')

    expect(again.status).toBe(200)
    expect(again.body.liveVersion.version).toBe(1)
    const audit = await request.get('/api/admin/audit').query({ entityType: 'product' }).set(bearer(token))
    expect(audit.body.items.filter((e: { action: string }) => e.action === 'catalog.product.publish')).toHaveLength(1)
  })
})

describe('chuyển trạng thái', () => {
  it('không đưa được sản phẩm đã xuất bản thẳng về nháp; lỗi gợi ý lưu trữ', async () => {
    const { request, token, product } = await published()

    const res = await setStatus(request, token, product.id, 'draft')

    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/lưu trữ/)
    expect(res.body.error.fields).toEqual([{ path: 'status', message: expect.any(String) }])
  })

  it('lưu trữ được sản phẩm nháp, đưa về nháp được sản phẩm lưu trữ, và cả hai đều ghi audit', async () => {
    const { request, token, product } = await catalog()

    const archived = await setStatus(request, token, product.id, 'archived')
    const draft = await setStatus(request, token, product.id, 'draft')

    expect(archived.status).toBe(200)
    expect(archived.body.status).toBe('archived')
    expect(draft.status).toBe(200)
    expect(draft.body.status).toBe('draft')
    const audit = await request.get('/api/admin/audit').query({ entityType: 'product' }).set(bearer(token))
    expect(audit.body.items.slice(0, 2)).toMatchObject([
      { action: 'catalog.product.unarchive', before: { status: 'archived' }, after: { status: 'draft' } },
      { action: 'catalog.product.archive', before: { status: 'draft' }, after: { status: 'archived' } },
    ])
  })

  it('sản phẩm lưu trữ không xuất bản thẳng được, phải đưa về nháp trước', async () => {
    const { request, token, product } = await published()
    await setStatus(request, token, product.id, 'archived')

    const direct = await setStatus(request, token, product.id, 'published')
    await setStatus(request, token, product.id, 'draft')
    const again = await setStatus(request, token, product.id, 'published')

    expect(direct.status).toBe(409)
    expect(again.status).toBe(200)
    expect(again.body.liveVersion.version).toBe(2)
  })

  it('lưu trữ sản phẩm đã xuất bản thì vẫn xem được trong admin cùng toàn bộ audit', async () => {
    const { request, token, product } = await published()

    const res = await setStatus(request, token, product.id, 'archived')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'archived', liveVersion: null })
    const list = await request.get('/api/admin/products').set(bearer(token))
    expect(list.body.items).toEqual([expect.objectContaining({ id: product.id, status: 'archived' })])
    const audit = await request.get('/api/admin/audit').query({ entityType: 'product' }).set(bearer(token))
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual([
      'catalog.product.archive',
      'catalog.product.publish',
      'catalog.product.create',
    ])
  })

  it('chuyển trạng thái cần catalog.edit', async () => {
    const { request, token, product } = await readyToPublish()
    const { accessToken } = await createStaff(request, token, ['accountant'])

    const res = await setStatus(request, accessToken, product.id, 'published')

    expect(res.status).toBe(403)
  })
})

describe('ảnh của sản phẩm đã xuất bản', () => {
  it('không gỡ được ảnh cuối cùng của sản phẩm đã xuất bản; lỗi gợi ý lưu trữ', async () => {
    const { request, token, product, image } = await published()

    const res = await request.delete(`/api/admin/products/${product.id}/images/${image.id}`).set(bearer(token))

    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/lưu trữ/)
    const images = await request.get(`/api/admin/products/${product.id}/images`).set(bearer(token))
    expect(images.body.items).toHaveLength(1)
  })

  it('sản phẩm nháp thì gỡ được ảnh cuối cùng', async () => {
    const { request, token, product, image } = await readyToPublish()

    const res = await request.delete(`/api/admin/products/${product.id}/images/${image.id}`).set(bearer(token))

    expect(res.status).toBe(204)
  })

  it('gỡ ảnh đang hiện trên website thì file còn giữ tới khi xuất bản lại', async () => {
    const { request, token, product, image, storage } = await published()
    await uploadImage(request, token, product.id, 'Ảnh mới')
    const before = await request.get('/api/products/air-max-90')
    const url = before.body.images[0].originalUrl as string
    const key = `public/${url.slice('memory://public/'.length)}`

    await request.delete(`/api/admin/products/${product.id}/images/${image.id}`).set(bearer(token))
    const live = await request.get('/api/products/air-max-90')
    expect(live.body.images.map((i: { alt: string }) => i.alt)).toEqual(['Ảnh'])
    expect(storage.objects.has(key)).toBe(true)

    await setStatus(request, token, product.id, 'published')
    const republished = await request.get('/api/products/air-max-90')
    expect(republished.body.images.map((i: { alt: string }) => i.alt)).toEqual(['Ảnh mới'])
    expect(storage.objects.has(key)).toBe(false)
  })
})

function editVariant(request: Request, token: string, productId: string, id: string, body: Record<string, unknown>) {
  return request.put(`/api/admin/products/${productId}/variants/${id}`).set(bearer(token)).send(body)
}

describe('chi tiết sản phẩm cho khách', () => {
  it('trả về thông tin sản phẩm, nhãn thuộc tính theo schema, biến thể đang bán kèm giá và ảnh', async () => {
    const { request, token, product, white, image } = await readyToPublish()
    await request
      .put(`/api/admin/products/${product.id}/images/${image.id}`)
      .set(bearer(token))
      .send({ alt: 'Màu trắng', variantIds: [white.id] })
    await setStatus(request, token, product.id, 'published')

    const res = await request.get('/api/products/air-max-90')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      slug: 'air-max-90',
      name: 'Air Max 90',
      productType: 'footwear',
      brand: { slug: 'nike', name: 'Nike' },
      category: { slug: 'chay-bo', name: 'Chạy bộ' },
      modelCode: 'CN8490-002',
      usageCare: 'Lau bằng khăn ẩm.',
      sizeChart: { columns: ['EU', 'Chiều dài chân (cm)'], rows: [['40', '25']] },
      originStatement: 'Nhập khẩu từ Nike Mỹ.',
      attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
      variants: [
        { sku: 'AM90-DEN-40', attributes: { mau: 'Đen', size: '40' }, price: 3_500_000, compareAtPrice: null },
        { sku: 'AM90-TRANG-41', attributes: { mau: 'Trắng', size: '41' }, price: 3_200_000, compareAtPrice: null },
      ],
      images: [{ alt: 'Màu trắng', skus: ['AM90-TRANG-41'], sizes: expect.any(Array) }],
      policies: [],
    })
    expect(res.body.attributeSchema).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'gioi_tinh', label: expect.any(String) })]),
    )
  })

  it('sản phẩm nháp hoặc lưu trữ trả 404', async () => {
    const { request, token, product, brand, running } = await published()
    await post(request, token, '/api/admin/products', sneaker(brand.id, running.id, { slug: 'air-force-1' }))

    await setStatus(request, token, product.id, 'archived')

    expect((await request.get('/api/products/air-max-90')).status).toBe(404)
    expect((await request.get('/api/products/air-force-1')).status).toBe(404)
  })

  it('biến thể ngừng bán không được trả về', async () => {
    const { request, token, product, black } = await readyToPublish()
    await editVariant(request, token, product.id, black.id, { ...BLACK_40, status: 'discontinued' })
    await setStatus(request, token, product.id, 'published')

    const res = await request.get('/api/products/air-max-90')

    expect(res.body.variants.map((v: { sku: string }) => v.sku)).toEqual(['AM90-TRANG-41'])
  })

  it('khách chỉ thấy bản đã xuất bản; sửa bản đang soạn chỉ hiện sau khi xuất bản lại', async () => {
    const { request, token, product, black, brand, running } = await published()
    await request
      .put(`/api/admin/products/${product.id}`)
      .set(bearer(token))
      .send(sneaker(brand.id, running.id, { name: 'Air Max 90 SE', slug: 'air-max-90-se' }))
    await editVariant(request, token, product.id, black.id, { ...BLACK_40, price: 2_900_000 })

    const before = await request.get('/api/products/air-max-90')
    const detail = await request.get(`/api/admin/products/${product.id}`).set(bearer(token))
    expect(before.body.name).toBe('Air Max 90')
    expect(before.body.variants[0].price).toBe(3_500_000)
    expect((await request.get('/api/products/air-max-90-se')).status).toBe(404)
    expect(detail.body.hasUnpublishedChanges).toBe(true)

    await setStatus(request, token, product.id, 'published')

    expect((await request.get('/api/products/air-max-90')).status).toBe(404)
    const after = await request.get('/api/products/air-max-90-se')
    expect(after.body.name).toBe('Air Max 90 SE')
    expect(after.body.variants[0].price).toBe(2_900_000)
  })

  it('danh mục mà phiên bản đã xuất bản còn tham chiếu thì không xóa được', async () => {
    const { request, token, product, brand, sneakers, running } = await published()
    await request.put(`/api/admin/products/${product.id}`).set(bearer(token)).send(sneaker(brand.id, sneakers.id))

    const res = await request.delete(`/api/admin/categories/${running.id}`).set(bearer(token))

    expect(res.status).toBe(409)
  })

  it('slug đang dùng trên website bởi sản phẩm khác thì không xuất bản được', async () => {
    const { request, token, product, brand, running } = await published()
    await request
      .put(`/api/admin/products/${product.id}`)
      .set(bearer(token))
      .send(sneaker(brand.id, running.id, { slug: 'air-max-90-cu' }))
    const copy = await post(request, token, '/api/admin/products', sneaker(brand.id, running.id))
    await post(request, token, `/api/admin/products/${copy.id}/variants`, { ...BLACK_40, sku: 'COPY-1' })
    await uploadImage(request, token, copy.id)

    const res = await setStatus(request, token, copy.id, 'published')

    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([{ path: 'slug', message: expect.any(String) }])
  })
})

describe('chính sách áp dụng', () => {
  async function policyPage(request: Request, token: string, slug: string, kind = 'policy') {
    const page = await post(request, token, '/api/admin/pages', {
      slug,
      kind,
      title: `Trang ${slug}`,
      body: 'Nội dung',
    })
    return page
  }

  it('gắn trang chính sách vào sản phẩm; khách thấy các trang đã xuất bản, có ghi audit', async () => {
    const { request, token, product } = await readyToPublish()
    const returns = await policyPage(request, token, 'doi-tra')
    const warranty = await policyPage(request, token, 'bao-hanh')
    await request.post(`/api/admin/pages/${returns.id}/publish`).set(bearer(token))

    const res = await request
      .put(`/api/admin/products/${product.id}/policies`)
      .set(bearer(token))
      .send({ pageIds: [returns.id, warranty.id] })
    await setStatus(request, token, product.id, 'published')
    const live = await request.get('/api/products/air-max-90')

    expect(res.status).toBe(200)
    expect(res.body.policyPageIds).toEqual([returns.id, warranty.id].sort())
    expect(live.body.policies).toEqual([{ slug: 'doi-tra', title: 'Trang doi-tra' }])
    const audit = await request.get('/api/admin/audit').query({ entityType: 'product' }).set(bearer(token))
    expect(audit.body.items).toContainEqual(
      expect.objectContaining({ action: 'catalog.product.policies', after: { policyPageIds: res.body.policyPageIds } }),
    )
  })

  it('người soạn sản phẩm xem được danh sách trang chính sách để chọn, không cần quyền soạn nội dung', async () => {
    const { request, token } = await catalog()
    const returns = await policyPage(request, token, 'doi-tra')
    await policyPage(request, token, 'gioi-thieu', 'about')
    const sales = await createStaff(request, token, ['sales'])

    const res = await request.get('/api/admin/products/policy-pages').set(bearer(sales.accessToken))

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([{ id: returns.id, slug: 'doi-tra', title: 'Trang doi-tra', published: false }])
  })

  it('trang không phải loại chính sách thì không gắn được', async () => {
    const { request, token, product } = await catalog()
    const about = await policyPage(request, token, 'gioi-thieu', 'about')

    const res = await request
      .put(`/api/admin/products/${product.id}/policies`)
      .set(bearer(token))
      .send({ pageIds: [about.id] })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([{ path: 'pageIds.0', message: expect.any(String) }])
  })
})

describe('danh sách sản phẩm cho khách', () => {
  it('giá "từ X" là giá thấp nhất trong các biến thể đang bán, kèm giá hãng của chính biến thể đó', async () => {
    const { request, token, product, black, white } = await readyToPublish()
    await editVariant(request, token, product.id, black.id, {
      ...BLACK_40,
      price: 3_000_000,
      compareAtPrice: 4_000_000,
    })
    await editVariant(request, token, product.id, white.id, { ...WHITE_41, price: 2_000_000, status: 'discontinued' })
    await post(request, token, `/api/admin/products/${product.id}/variants`, {
      sku: 'AM90-DEN-42',
      attributes: { mau: 'Đen', size: '42' },
      price: 3_800_000,
    })
    await setStatus(request, token, product.id, 'published')

    const res = await request.get('/api/products').query({ brand: 'nike' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 1, page: 1 })
    expect(res.body.items).toEqual([
      {
        slug: 'air-max-90',
        name: 'Air Max 90',
        brand: { slug: 'nike', name: 'Nike' },
        fromPrice: 3_000_000,
        compareAtPrice: 4_000_000,
        image: expect.objectContaining({ alt: 'Ảnh', originalUrl: expect.any(String) }),
      },
    ])
  })

  it('lọc theo danh mục gồm cả danh mục con; sản phẩm nháp và lưu trữ không xuất hiện', async () => {
    const { request, token, brand, sneakers, product } = await published()
    await post(request, token, '/api/admin/products', sneaker(brand.id, sneakers.id, { slug: 'air-force-1' }))

    const parent = await request.get('/api/products').query({ category: 'sneaker' })
    const child = await request.get('/api/products').query({ category: 'chay-bo' })
    const otherBrand = await request.get('/api/products').query({ brand: 'adidas' })
    await setStatus(request, token, product.id, 'archived')
    const afterArchive = await request.get('/api/products').query({ category: 'sneaker' })

    expect(parent.body.items.map((p: { slug: string }) => p.slug)).toEqual(['air-max-90'])
    expect(child.body.items.map((p: { slug: string }) => p.slug)).toEqual(['air-max-90'])
    expect(otherBrand.body.items).toEqual([])
    expect(afterArchive.body.items).toEqual([])
  })
})
