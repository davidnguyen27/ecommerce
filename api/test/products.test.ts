import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

/** Owner đã đăng nhập, có sẵn thương hiệu Nike, danh mục Giày dép > Sneaker và Nước hoa > Nước hoa nam. */
async function catalog() {
  const app = await appWithOwner()
  const { accessToken: token } = await login(app.request, OWNER.email, OWNER.password)
  const brand = await post(app.request, token, '/api/admin/brands', { name: 'Nike', slug: 'nike' })
  const sneaker = await post(app.request, token, '/api/admin/categories', {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
  })
  const perfume = await post(app.request, token, '/api/admin/categories', {
    name: 'Nước hoa nam',
    slug: 'nuoc-hoa-nam',
    productType: 'fragrance',
  })
  return { ...app, token, brand, sneaker, perfume }
}

const SIZE_CHART = {
  columns: ['EU', 'Chiều dài chân (cm)'],
  rows: [
    ['40', '25'],
    ['41', '26'],
  ],
}

function sneakerProduct(brandId: string, categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    brandId,
    categoryId,
    name: 'Air Max 90',
    slug: 'air-max-90',
    modelCode: 'CN8490-002',
    description: 'Giày chạy bộ cổ thấp.',
    usageCare: 'Lau bằng khăn ẩm.',
    sizeChart: SIZE_CHART,
    originStatement: 'Nhập khẩu từ Nike Mỹ.',
    attributes: { gioi_tinh: 'Nam', he_size: 'EU', chat_lieu: 'Da' },
    groundShippingOnly: false,
    ...overrides,
  }
}

describe('tạo và sửa sản phẩm', () => {
  it('sản phẩm mới luôn ở trạng thái nháp, giữ đủ thông tin chung, bảng size và thuộc tính cấp sản phẩm', async () => {
    const { request, token, brand, sneaker } = await catalog()

    const res = await request
      .post('/api/admin/products')
      .set(bearer(token))
      .send({ ...sneakerProduct(brand.id, sneaker.id), status: 'published' })
    const detail = await request.get(`/api/admin/products/${res.body.id}`).set(bearer(token))

    expect(res.status).toBe(201)
    expect(detail.body).toEqual({
      id: res.body.id,
      productType: 'footwear',
      ...sneakerProduct(brand.id, sneaker.id),
      status: 'draft',
      updatedAt: expect.any(String),
      variants: [],
      policyPageIds: [],
      liveVersion: null,
      hasUnpublishedChanges: false,
    })
    expect(detail.body).not.toHaveProperty('warranty')
  })
})

function auditOf(request: Request, token: string, entityType: string) {
  return request
    .get('/api/admin/audit')
    .query({ entityType })
    .set(bearer(token))
    .then((res) => res.body.items as { action: string; entityId: string; before: unknown; after: unknown }[])
}

describe('kiểm sản phẩm', () => {
  it('thuộc tính cấp sản phẩm sai schema của nhóm hàng (lấy từ danh mục) thì lỗi theo từng trường', async () => {
    const { request, token, brand, sneaker } = await catalog()

    const res = await request
      .post('/api/admin/products')
      .set(bearer(token))
      .send(
        sneakerProduct(brand.id, sneaker.id, { attributes: { gioi_tinh: 'Trẻ em', size: '40', nong_do: 'Parfum' } }),
      )
    const list = await request.get('/api/admin/products').set(bearer(token))

    expect(res.status).toBe(400)
    expect(res.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual([
      'attributes.gioi_tinh',
      'attributes.he_size',
      'attributes.nong_do',
      'attributes.size',
    ])
    expect(list.body.items).toEqual([])
  })

  it('bảng size có hàng lệch số cột thì bị từ chối ở đúng hàng đó', async () => {
    const { request, token, brand, sneaker } = await catalog()

    const res = await request
      .post('/api/admin/products')
      .set(bearer(token))
      .send(
        sneakerProduct(brand.id, sneaker.id, { sizeChart: { columns: ['EU', 'cm'], rows: [['40', '25'], ['41']] } }),
      )

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([{ path: 'sizeChart.rows.1', message: expect.any(String) }])
  })

  it('slug trùng với sản phẩm khác thì 409', async () => {
    const { request, token, brand, sneaker } = await catalog()
    await post(request, token, '/api/admin/products', sneakerProduct(brand.id, sneaker.id))

    const res = await request.post('/api/admin/products').set(bearer(token)).send(sneakerProduct(brand.id, sneaker.id))

    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([{ path: 'slug', message: expect.any(String) }])
  })

  it('thương hiệu hoặc danh mục không tồn tại thì 400 ở đúng trường', async () => {
    const { request, token, brand, sneaker } = await catalog()
    const missing = '00000000-0000-4000-8000-000000000000'

    const noBrand = await request
      .post('/api/admin/products')
      .set(bearer(token))
      .send(sneakerProduct(missing, sneaker.id))
    const noCategory = await request
      .post('/api/admin/products')
      .set(bearer(token))
      .send(sneakerProduct(brand.id, missing))

    expect(noBrand.status).toBe(400)
    expect(noBrand.body.error.fields).toEqual([{ path: 'brandId', message: expect.any(String) }])
    expect(noCategory.status).toBe(400)
    expect(noCategory.body.error.fields).toEqual([{ path: 'categoryId', message: expect.any(String) }])
  })

  it('thương hiệu và danh mục đang ẩn vẫn gắn được cho sản phẩm', async () => {
    const { request, token, brand, sneaker } = await catalog()
    await request.post(`/api/admin/brands/${brand.id}/hide`).set(bearer(token))
    await request.post(`/api/admin/categories/${sneaker.id}/hide`).set(bearer(token))

    const res = await request.post('/api/admin/products').set(bearer(token)).send(sneakerProduct(brand.id, sneaker.id))

    expect(res.status).toBe(201)
  })
})

describe('sửa sản phẩm', () => {
  it('tạo và sửa đều ghi audit, bản sửa có nội dung trước và sau', async () => {
    const { request, token, brand, sneaker } = await catalog()
    const product = await post(request, token, '/api/admin/products', sneakerProduct(brand.id, sneaker.id))

    const res = await request
      .put(`/api/admin/products/${product.id}`)
      .set(bearer(token))
      .send(sneakerProduct(brand.id, sneaker.id, { name: 'Air Max 90 Essential', groundShippingOnly: true }))
    const audit = await auditOf(request, token, 'product')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: 'Air Max 90 Essential', groundShippingOnly: true, status: 'draft' })
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'catalog.product.update',
        entityId: product.id,
        before: expect.objectContaining({ name: 'Air Max 90', groundShippingOnly: false }),
        after: expect.objectContaining({ name: 'Air Max 90 Essential', groundShippingOnly: true }),
      }),
      expect.objectContaining({
        action: 'catalog.product.create',
        entityId: product.id,
        before: null,
        after: expect.objectContaining({ name: 'Air Max 90', modelCode: 'CN8490-002', status: 'draft' }),
      }),
    ])
  })

  it('lưu lại đúng nội dung hiện tại thì không ghi audit', async () => {
    const { request, token, brand, sneaker } = await catalog()
    const product = await post(request, token, '/api/admin/products', sneakerProduct(brand.id, sneaker.id))

    const res = await request
      .put(`/api/admin/products/${product.id}`)
      .set(bearer(token))
      .send(
        sneakerProduct(brand.id, sneaker.id, { attributes: { gioi_tinh: 'Nam', he_size: 'EU', chat_lieu: ' Da ' } }),
      )
    const audit = await auditOf(request, token, 'product')

    expect(res.status).toBe(200)
    expect(audit.map((a) => a.action)).toEqual(['catalog.product.create'])
  })

  it('chuyển sang danh mục khác nhóm hàng thì 409; cùng nhóm hàng thì được', async () => {
    const { request, token, brand, sneaker, perfume } = await catalog()
    const boots = await post(request, token, '/api/admin/categories', {
      name: 'Boot',
      slug: 'boot',
      productType: 'footwear',
    })
    const product = await post(request, token, '/api/admin/products', sneakerProduct(brand.id, sneaker.id))

    const toPerfume = await request
      .put(`/api/admin/products/${product.id}`)
      .set(bearer(token))
      .send(sneakerProduct(brand.id, perfume.id))
    const toBoots = await request
      .put(`/api/admin/products/${product.id}`)
      .set(bearer(token))
      .send(sneakerProduct(brand.id, boots.id))

    expect(toPerfume.status).toBe(409)
    expect(toPerfume.body.error.fields).toEqual([{ path: 'categoryId', message: expect.any(String) }])
    expect(toBoots.status).toBe(200)
    expect(toBoots.body.categoryId).toBe(boots.id)
  })
})

/** Catalog kèm một sản phẩm giày nháp. */
async function sneakerCatalog() {
  const app = await catalog()
  const product = await post(
    app.request,
    app.token,
    '/api/admin/products',
    sneakerProduct(app.brand.id, app.sneaker.id),
  )
  return { ...app, product }
}

function addVariant(request: Request, token: string, productId: string, variant: Record<string, unknown>) {
  return request.post(`/api/admin/products/${productId}/variants`).set(bearer(token)).send(variant)
}

function editVariant(request: Request, token: string, productId: string, id: string, variant: Record<string, unknown>) {
  return request.put(`/api/admin/products/${productId}/variants/${id}`).set(bearer(token)).send(variant)
}

const BLACK_40 = { sku: 'am90-den-40', attributes: { mau: 'Đen', size: '40' } }
const BLACK_41 = { sku: 'AM90-DEN-41', attributes: { mau: 'Đen', size: '41' } }

describe('biến thể', () => {
  it('tạo biến thể theo tổ hợp thuộc tính cấp biến thể, SKU lưu chữ hoa, mặc định đang bán và xếp cuối', async () => {
    const { request, token, product } = await sneakerCatalog()

    const first = await addVariant(request, token, product.id, BLACK_40)
    const second = await addVariant(request, token, product.id, { ...BLACK_41, attributes: { size: '41', mau: 'Đen' } })
    const detail = await request.get(`/api/admin/products/${product.id}`).set(bearer(token))

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(detail.body.variants).toEqual([
      {
        id: first.body.id,
        sku: 'AM90-DEN-40',
        attributes: { mau: 'Đen', size: '40' },
        price: null,
        compareAtPrice: null,
        status: 'active',
        sortOrder: 0,
        onHand: 0,
      },
      expect.objectContaining({ id: second.body.id, sku: 'AM90-DEN-41', sortOrder: 1 }),
    ])
  })

  it('thuộc tính biến thể sai schema thì lỗi theo từng trường', async () => {
    const { request, token, product } = await sneakerCatalog()

    const res = await addVariant(request, token, product.id, {
      sku: 'AM90-X',
      attributes: { size: 40, gioi_tinh: 'Nam' },
    })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual([
      'attributes.gioi_tinh',
      'attributes.mau',
      'attributes.size',
    ])
  })

  it('trùng tổ hợp thuộc tính trong cùng sản phẩm thì 409, kể cả khi sửa', async () => {
    const { request, token, product } = await sneakerCatalog()
    await addVariant(request, token, product.id, BLACK_40)
    const other = await addVariant(request, token, product.id, BLACK_41)

    const created = await addVariant(request, token, product.id, {
      sku: 'AM90-KHAC',
      attributes: { size: ' 40', mau: 'Đen' },
    })
    const edited = await editVariant(request, token, product.id, other.body.id, {
      ...BLACK_41,
      attributes: BLACK_40.attributes,
    })

    for (const res of [created, edited]) {
      expect(res.status).toBe(409)
      expect(res.body.error.fields).toEqual([{ path: 'attributes', message: expect.any(String) }])
    }
  })

  it('cùng tổ hợp ở hai sản phẩm khác nhau thì được', async () => {
    const { request, token, brand, sneaker, product } = await sneakerCatalog()
    const another = await post(
      request,
      token,
      '/api/admin/products',
      sneakerProduct(brand.id, sneaker.id, { name: 'Air Force 1', slug: 'air-force-1' }),
    )
    await addVariant(request, token, product.id, BLACK_40)

    const res = await addVariant(request, token, another.id, { ...BLACK_40, sku: 'AF1-DEN-40' })

    expect(res.status).toBe(201)
  })

  it('SKU trùng toàn hệ thống, không phân biệt hoa thường, thì 409', async () => {
    const { request, token, brand, sneaker, product } = await sneakerCatalog()
    const another = await post(
      request,
      token,
      '/api/admin/products',
      sneakerProduct(brand.id, sneaker.id, { name: 'Air Force 1', slug: 'air-force-1' }),
    )
    await addVariant(request, token, product.id, BLACK_40)
    const mine = await addVariant(request, token, another.id, { ...BLACK_41, sku: 'AF1-DEN-41' })

    const created = await addVariant(request, token, another.id, { ...BLACK_40, sku: 'AM90-DEN-40' })
    const edited = await editVariant(request, token, another.id, mine.body.id, { ...BLACK_41, sku: 'Am90-Den-40' })

    for (const res of [created, edited]) {
      expect(res.status).toBe(409)
      expect(res.body.error.fields).toEqual([{ path: 'sku', message: expect.any(String) }])
    }
  })

  it('tạo và sửa biến thể đều ghi audit; lưu lại không đổi gì thì không ghi', async () => {
    const { request, token, product } = await sneakerCatalog()
    const variant = await addVariant(request, token, product.id, BLACK_40)

    await editVariant(request, token, product.id, variant.body.id, { ...BLACK_40, status: 'discontinued' })
    await editVariant(request, token, product.id, variant.body.id, { ...BLACK_40, status: 'discontinued' })
    const audit = await auditOf(request, token, 'product_variant')

    expect(audit).toEqual([
      expect.objectContaining({
        action: 'catalog.variant.update',
        entityId: variant.body.id,
        before: expect.objectContaining({ productId: product.id, sku: 'AM90-DEN-40', status: 'active' }),
        after: expect.objectContaining({ sku: 'AM90-DEN-40', status: 'discontinued' }),
      }),
      expect.objectContaining({
        action: 'catalog.variant.create',
        entityId: variant.body.id,
        after: {
          productId: product.id,
          sku: 'AM90-DEN-40',
          attributes: BLACK_40.attributes,
          status: 'active',
          sortOrder: 0,
        },
      }),
    ])
  })

  it('biến thể của sản phẩm khác thì 404', async () => {
    const { request, token, brand, sneaker, product } = await sneakerCatalog()
    const another = await post(
      request,
      token,
      '/api/admin/products',
      sneakerProduct(brand.id, sneaker.id, { name: 'Air Force 1', slug: 'air-force-1' }),
    )
    const variant = await addVariant(request, token, product.id, BLACK_40)

    const res = await editVariant(request, token, another.id, variant.body.id, BLACK_40)

    expect(res.status).toBe(404)
  })
})

describe('ngừng bán biến thể', () => {
  async function publishedWithVariants() {
    const app = await sneakerCatalog()
    const first = await addVariant(app.request, app.token, app.product.id, { ...BLACK_40, price: 3_500_000 })
    const second = await addVariant(app.request, app.token, app.product.id, { ...BLACK_41, price: 3_500_000 })
    const photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .jpeg()
      .toBuffer()
    const image = await app.request
      .post(`/api/admin/products/${app.product.id}/images`)
      .set(bearer(app.token))
      .attach('file', photo, 'anh.jpg')
    expect(image.status).toBe(201)
    const published = await app.request
      .put(`/api/admin/products/${app.product.id}/status`)
      .set(bearer(app.token))
      .send({ status: 'published' })
    expect(published.status).toBe(200)
    return { ...app, first: first.body.id as string, second: second.body.id as string }
  }

  it('không ngừng bán được biến thể đang bán cuối cùng của sản phẩm đã xuất bản; lỗi gợi ý lưu trữ sản phẩm', async () => {
    const { request, token, product, first, second } = await publishedWithVariants()

    const ok = await editVariant(request, token, product.id, first, { ...BLACK_40, status: 'discontinued' })
    const last = await editVariant(request, token, product.id, second, { ...BLACK_41, status: 'discontinued' })
    const detail = await request.get(`/api/admin/products/${product.id}`).set(bearer(token))

    expect(ok.status).toBe(200)
    expect(last.status).toBe(409)
    expect(last.body.error.message).toMatch(/lưu trữ/)
    expect(last.body.error.fields).toEqual([{ path: 'status', message: expect.any(String) }])
    expect(detail.body.variants.map((v: { status: string }) => v.status)).toEqual(['discontinued', 'active'])
  })

  it('sản phẩm nháp thì ngừng bán được mọi biến thể', async () => {
    const { request, token, product } = await sneakerCatalog()
    const only = await addVariant(request, token, product.id, BLACK_40)

    const res = await editVariant(request, token, product.id, only.body.id, { ...BLACK_40, status: 'discontinued' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('discontinued')
  })
})

describe('giá', () => {
  it('giá bán và giá hãng là số nguyên VND; giá hãng thấp hơn giá bán thì bị từ chối', async () => {
    const { request, token, product } = await sneakerCatalog()

    const lower = await addVariant(request, token, product.id, {
      ...BLACK_40,
      price: 3_500_000,
      compareAtPrice: 3_000_000,
    })
    const zero = await addVariant(request, token, product.id, { ...BLACK_40, price: 0 })
    const fraction = await addVariant(request, token, product.id, { ...BLACK_40, price: 3_500_000.5 })
    const onlyCompare = await addVariant(request, token, product.id, { ...BLACK_40, compareAtPrice: 4_000_000 })
    const ok = await addVariant(request, token, product.id, {
      ...BLACK_40,
      price: 3_500_000,
      compareAtPrice: 4_200_000,
    })
    const equal = await addVariant(request, token, product.id, {
      ...BLACK_41,
      price: 3_500_000,
      compareAtPrice: 3_500_000,
    })

    expect(lower.status).toBe(400)
    expect(lower.body.error.fields).toEqual([{ path: 'compareAtPrice', message: expect.any(String) }])
    expect(onlyCompare.status).toBe(400)
    expect(onlyCompare.body.error.fields).toEqual([{ path: 'compareAtPrice', message: expect.any(String) }])
    for (const res of [zero, fraction]) {
      expect(res.status).toBe(400)
      expect(res.body.error.fields).toEqual([{ path: 'price', message: expect.any(String) }])
    }
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ price: 3_500_000, compareAtPrice: 4_200_000 })
    expect(equal.status).toBe(201)
  })

  it('giá hãng mới thấp hơn giá bán đang có thì bị từ chối', async () => {
    const { request, token, product } = await sneakerCatalog()
    const variant = await addVariant(request, token, product.id, { ...BLACK_40, price: 3_500_000 })

    const res = await editVariant(request, token, product.id, variant.body.id, {
      ...BLACK_40,
      compareAtPrice: 3_000_000,
    })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([{ path: 'compareAtPrice', message: expect.any(String) }])
  })

  it('người chỉ có catalog.edit mà gửi kèm thay đổi giá thì 403 và không gì bị đổi', async () => {
    const { request, token: ownerToken, product } = await sneakerCatalog()
    const variant = await addVariant(request, ownerToken, product.id, { ...BLACK_40, price: 3_500_000 })
    const { accessToken: token } = await createStaff(request, ownerToken, ['sales'])

    const created = await addVariant(request, token, product.id, { ...BLACK_41, price: 3_500_000 })
    const changed = await editVariant(request, token, product.id, variant.body.id, {
      ...BLACK_40,
      status: 'discontinued',
      price: 3_200_000,
    })
    const compareAt = await editVariant(request, token, product.id, variant.body.id, {
      ...BLACK_40,
      compareAtPrice: 4_000_000,
    })
    const detail = await request.get(`/api/admin/products/${product.id}`).set(bearer(ownerToken))

    for (const res of [created, changed, compareAt]) {
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    }
    expect(detail.body.variants).toEqual([
      expect.objectContaining({ sku: 'AM90-DEN-40', status: 'active', price: 3_500_000, compareAtPrice: null }),
    ])
  })

  it('người chỉ có catalog.edit vẫn sửa được biến thể khi gửi lại đúng giá hiện tại', async () => {
    const { request, token: ownerToken, product } = await sneakerCatalog()
    const variant = await addVariant(request, ownerToken, product.id, { ...BLACK_40, price: 3_500_000 })
    const { accessToken: token } = await createStaff(request, ownerToken, ['sales'])

    const res = await editVariant(request, token, product.id, variant.body.id, {
      ...BLACK_40,
      sku: 'AM90-BLACK-40',
      price: 3_500_000,
      compareAtPrice: null,
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ sku: 'AM90-BLACK-40', price: 3_500_000 })
  })

  it('kế toán có price.edit đổi được giá, mỗi lần ghi audit price.change có giá cũ và giá mới', async () => {
    const { request, token: ownerToken, product } = await sneakerCatalog()
    const variant = await addVariant(request, ownerToken, product.id, { ...BLACK_40, price: 3_500_000 })
    const { accessToken: token } = await createStaff(request, ownerToken, ['accountant'])

    const res = await editVariant(request, token, product.id, variant.body.id, {
      ...BLACK_40,
      price: 3_200_000,
      compareAtPrice: 4_000_000,
    })
    const audit = await auditOf(request, ownerToken, 'product_variant')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ price: 3_200_000, compareAtPrice: 4_000_000 })
    expect(audit.filter((a) => a.action === 'price.change')).toEqual([
      expect.objectContaining({
        entityId: variant.body.id,
        before: { productId: product.id, sku: 'AM90-DEN-40', price: 3_500_000, compareAtPrice: null },
        after: { productId: product.id, sku: 'AM90-DEN-40', price: 3_200_000, compareAtPrice: 4_000_000 },
      }),
      expect.objectContaining({
        entityId: variant.body.id,
        before: { productId: product.id, sku: 'AM90-DEN-40', price: null, compareAtPrice: null },
        after: { productId: product.id, sku: 'AM90-DEN-40', price: 3_500_000, compareAtPrice: null },
      }),
    ])
    expect(audit.filter((a) => a.action === 'catalog.variant.update')).toEqual([])
  })

  it('kế toán xem được sản phẩm nhưng không đổi được SKU, thuộc tính hay tạo sản phẩm, biến thể', async () => {
    const { request, token: ownerToken, brand, sneaker, product } = await sneakerCatalog()
    const variant = await addVariant(request, ownerToken, product.id, BLACK_40)
    const { accessToken: token } = await createStaff(request, ownerToken, ['accountant'])

    const list = await request.get('/api/admin/products').set(bearer(token))
    const attempts = await Promise.all([
      editVariant(request, token, product.id, variant.body.id, { ...BLACK_40, sku: 'KHAC', price: 3_000_000 }),
      addVariant(request, token, product.id, BLACK_41),
      request
        .post('/api/admin/products')
        .set(bearer(token))
        .send(sneakerProduct(brand.id, sneaker.id, { slug: 'moi' })),
      request.put(`/api/admin/products/${product.id}`).set(bearer(token)).send(sneakerProduct(brand.id, sneaker.id)),
    ])

    expect(list.status).toBe(200)
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: product.id, brand: { id: brand.id, name: 'Nike' }, variantCount: 1 }),
    ])
    for (const res of attempts) expect(res.status).toBe(403)
  })

  it('nhân viên không có catalog.edit lẫn price.edit thì 403 khi lưu biến thể, kể cả lưu lại không đổi gì', async () => {
    const { request, prisma, token: ownerToken, product } = await sneakerCatalog()
    const variant = await addVariant(request, ownerToken, product.id, { ...BLACK_40, price: 3_500_000 })
    const staff = await createStaff(request, ownerToken, ['sales'])
    // Mọi role hiện có đều có một trong hai quyền; dựng nhân viên không role để thử đúng cổng của route.
    await prisma.staff.update({ where: { id: staff.id }, data: { roles: [] } })

    const res = await editVariant(request, staff.accessToken, product.id, variant.body.id, {
      ...BLACK_40,
      price: 3_500_000,
    })

    expect(res.status).toBe(403)
  })

  it('chưa đăng nhập thì 401', async () => {
    const { request, product } = await sneakerCatalog()

    const res = await request.get(`/api/admin/products/${product.id}`)

    expect(res.status).toBe(401)
  })
})

describe('đổi schema và xóa danh mục khi đã có sản phẩm', () => {
  type Definition = { key: string; required: boolean; options?: string[] }

  async function footwearSchema(request: Request, token: string) {
    const res = await request.get('/api/admin/attribute-schemas/footwear').set(bearer(token))
    return res.body.attributes as Definition[]
  }

  function putFootwear(request: Request, token: string, attributes: unknown[]) {
    return request.put('/api/admin/attribute-schemas/footwear').set(bearer(token)).send({ attributes })
  }

  it('đổi schema làm sai sản phẩm hoặc biến thể đang có thì 409 kèm danh sách sản phẩm bị ảnh hưởng', async () => {
    const { request, token, brand, sneaker, product } = await sneakerCatalog()
    const fine = await post(
      request,
      token,
      '/api/admin/products',
      sneakerProduct(brand.id, sneaker.id, {
        name: 'Air Force 1',
        slug: 'air-force-1',
        attributes: { gioi_tinh: 'Nam', he_size: 'US' },
      }),
    )
    await addVariant(request, token, product.id, BLACK_40)
    const schema = await footwearSchema(request, token)

    // Bớt giá trị EU của hệ size: chỉ Air Max 90 đang dùng.
    const fewerOptions = await putFootwear(
      request,
      token,
      schema.map((a) => (a.key === 'he_size' ? { ...a, options: ['US', 'UK', 'VN'] } : a)),
    )
    // Bỏ thuộc tính màu: biến thể của Air Max 90 đang có màu.
    const removed = await putFootwear(
      request,
      token,
      schema.filter((a) => a.key !== 'mau'),
    )
    // Chất liệu thành bắt buộc: Air Force 1 chưa khai báo.
    const required = await putFootwear(
      request,
      token,
      schema.map((a) => (a.key === 'chat_lieu' ? { ...a, required: true } : a)),
    )

    for (const [res, id, name] of [
      [fewerOptions, product.id, 'Air Max 90'],
      [removed, product.id, 'Air Max 90'],
      [required, fine.id, 'Air Force 1'],
    ] as const) {
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('CONFLICT')
      expect(res.body.error.fields).toEqual([{ path: `products.${id}`, message: expect.stringContaining(name) }])
    }
    expect(await footwearSchema(request, token)).toEqual(schema)
  })

  it('đổi schema không làm sai sản phẩm nào thì lưu được', async () => {
    const { request, token, product } = await sneakerCatalog()
    await addVariant(request, token, product.id, BLACK_40)
    const schema = await footwearSchema(request, token)

    const res = await putFootwear(
      request,
      token,
      schema.map((a) => (a.key === 'he_size' ? { ...a, options: ['EU', 'US'] } : a)),
    )

    expect(res.status).toBe(200)
  })

  it('danh mục còn sản phẩm thì không xóa được', async () => {
    const { request, token, sneaker } = await sneakerCatalog()

    const res = await request.delete(`/api/admin/categories/${sneaker.id}`).set(bearer(token))
    const tree = await request.get('/api/categories/sneaker')

    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/sản phẩm/)
    expect(tree.status).toBe(200)
  })
})
