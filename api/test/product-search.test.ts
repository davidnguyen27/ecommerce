import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, login, type Request } from './support/staff.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

const photo = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: '#a33' } })
    .jpeg()
    .toBuffer()

type Variant = { sku: string; attributes: Record<string, unknown>; price: number }
type ProductSpec = {
  name: string
  slug: string
  category: string
  brand?: string
  modelCode?: string
  attributes: Record<string, unknown>
  variants: Variant[]
  status?: 'published' | 'draft' | 'archived'
}

/** Owner đã đăng nhập; thương hiệu Nike, Chanel; danh mục Sneaker > Chạy bộ (giày dép) và Nước hoa nữ (nước hoa). */
async function shop() {
  const app = await appWithOwner()
  const { accessToken: token } = await login(app.request, OWNER.email, OWNER.password)
  const brands = {
    nike: (await post(app.request, token, '/api/admin/brands', { name: 'Nike', slug: 'nike' })).id,
    chanel: (await post(app.request, token, '/api/admin/brands', { name: 'Chanel', slug: 'chanel' })).id,
  }
  const sneaker = await post(app.request, token, '/api/admin/categories', {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
  })
  const categories: Record<string, string> = {
    sneaker: sneaker.id,
    'chay-bo': (
      await post(app.request, token, '/api/admin/categories', {
        name: 'Chạy bộ',
        slug: 'chay-bo',
        productType: 'footwear',
        parentId: sneaker.id,
      })
    ).id,
    'nuoc-hoa-nu': (
      await post(app.request, token, '/api/admin/categories', {
        name: 'Nước hoa nữ',
        slug: 'nuoc-hoa-nu',
        productType: 'fragrance',
      })
    ).id,
  }

  /** Tạo sản phẩm qua API admin, đủ biến thể và ảnh, rồi đưa về trạng thái cần (mặc định xuất bản). */
  async function add(spec: ProductSpec) {
    const product = await post(app.request, token, '/api/admin/products', {
      brandId: brands[(spec.brand ?? 'nike') as keyof typeof brands],
      categoryId: categories[spec.category],
      name: spec.name,
      slug: spec.slug,
      modelCode: spec.modelCode ?? '',
      attributes: spec.attributes,
    })
    for (const variant of spec.variants) {
      await post(app.request, token, `/api/admin/products/${product.id}/variants`, variant)
    }
    const image = await app.request
      .post(`/api/admin/products/${product.id}/images`)
      .set(bearer(token))
      .field('alt', spec.name)
      .attach('file', await photo(), 'anh.jpg')
    expect(image.status).toBe(201)
    const status = spec.status ?? 'published'
    if (status !== 'draft') {
      const res = await app.request
        .put(`/api/admin/products/${product.id}/status`)
        .set(bearer(token))
        .send({ status: status === 'archived' ? 'archived' : 'published' })
      expect(res.status).toBe(200)
    }
    return product
  }

  return { ...app, token, add }
}

const shoe = (overrides: Partial<ProductSpec> & Pick<ProductSpec, 'name' | 'slug'>): ProductSpec => ({
  category: 'chay-bo',
  attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
  variants: [{ sku: `${overrides.slug.toUpperCase()}-40`, attributes: { mau: 'Đen', size: '40' }, price: 2_000_000 }],
  ...overrides,
})

const slugs = (res: { body: { items: { slug: string }[] } }) => res.body.items.map((p) => p.slug)

describe('tìm từ khóa', () => {
  it('gõ không dấu "giay" vẫn tìm ra sản phẩm tên "Giày"', async () => {
    const { request, add } = await shop()
    await add(shoe({ name: 'Giày da Oxford', slug: 'giay-da-oxford' }))
    await add(shoe({ name: 'Dép quai ngang', slug: 'dep-quai-ngang' }))

    const res = await request.get('/api/products').query({ q: 'giay da' })

    expect(res.status).toBe(200)
    expect(slugs(res)).toEqual(['giay-da-oxford'])
  })

  it('gõ một phần tên, sai chính tả nhẹ, tên thương hiệu hoặc mã mẫu đều ra sản phẩm', async () => {
    const { request, add } = await shop()
    await add(shoe({ name: 'Ultraboost Light', slug: 'ultraboost-light', modelCode: 'HQ6351' }))
    await add(shoe({ name: 'Sandal đi biển', slug: 'sandal-di-bien', brand: 'chanel' }))

    for (const q of ['ultra', 'ultrabost', 'Ultrbooost light', 'hq6351', 'nike']) {
      const res = await request.get('/api/products').query({ q })
      expect(slugs(res), q).toEqual(['ultraboost-light'])
    }
  })

  it('SKU khớp chính xác lên đầu, rồi tới SKU khớp tiền tố, rồi các sản phẩm khớp tên', async () => {
    const { request, add } = await shop()
    await add(shoe({ name: 'Giày AB12 cổ điển', slug: 'co-dien' }))
    await add(
      shoe({
        name: 'Giày chạy',
        slug: 'giay-chay',
        variants: [{ sku: 'AB12-40', attributes: { mau: 'Đen', size: '40' }, price: 1 }],
      }),
    )
    await add(
      shoe({
        name: 'Giày đi bộ',
        slug: 'giay-di-bo',
        variants: [{ sku: 'AB12', attributes: { mau: 'Đen', size: '40' }, price: 1 }],
      }),
    )

    const res = await request.get('/api/products').query({ q: 'ab12', sort: 'newest' })

    expect(slugs(res)).toEqual(['giay-di-bo', 'giay-chay', 'co-dien'])
  })

  it('dữ liệu tìm kiếm đổi theo lần xuất bản mới và theo tên thương hiệu hiện tại', async () => {
    const { request, token, add } = await shop()
    const product = await add(shoe({ name: 'Air Max 90', slug: 'air-max-90' }))
    const draft = await request.get(`/api/admin/products/${product.id}`).set(bearer(token))
    const edited = await request
      .put(`/api/admin/products/${product.id}`)
      .set(bearer(token))
      .send({ ...draft.body, name: 'Air Zoom' })
    expect(edited.status).toBe(200)
    const beforeRepublish = await request.get('/api/products').query({ q: 'zoom' })
    await request.put(`/api/admin/products/${product.id}/status`).set(bearer(token)).send({ status: 'published' })
    const afterRepublish = await request.get('/api/products').query({ q: 'zoom' })
    const brands = await request.get('/api/admin/brands').set(bearer(token))
    const nike = brands.body.items.find((b: { slug: string }) => b.slug === 'nike')
    const renamed = await request
      .put(`/api/admin/brands/${nike.id}`)
      .set(bearer(token))
      .send({ ...nike, name: 'Nike Việt' })
    expect(renamed.status).toBe(200)
    const byNewBrandName = await request.get('/api/products').query({ q: 'nike viet' })

    expect(slugs(beforeRepublish)).toEqual([])
    expect(slugs(afterRepublish)).toEqual(['air-max-90'])
    expect(slugs(byNewBrandName)).toEqual(['air-max-90'])
  })
})

describe('bộ lọc', () => {
  it('khoảng giá so trên giá của các biến thể đang bán, không chỉ giá "từ"', async () => {
    const { request, add } = await shop()
    await add(
      shoe({
        name: 'Hai giá',
        slug: 'hai-gia',
        variants: [
          { sku: 'HG-40', attributes: { mau: 'Đen', size: '40' }, price: 1_000_000 },
          { sku: 'HG-41', attributes: { mau: 'Đen', size: '41' }, price: 3_000_000 },
        ],
      }),
    )
    await add(
      shoe({
        name: 'Rẻ',
        slug: 're',
        variants: [{ sku: 'RE-40', attributes: { mau: 'Đen', size: '40' }, price: 500_000 }],
      }),
    )

    const between = await request.get('/api/products').query({ minPrice: 2_500_000, maxPrice: 3_500_000 })
    const cheap = await request.get('/api/products').query({ maxPrice: 1_000_000, sort: 'price_asc' })

    expect(slugs(between)).toEqual(['hai-gia'])
    expect(between.body.items[0].fromPrice).toBe(1_000_000)
    expect(slugs(cheap)).toEqual(['re', 'hai-gia'])
    expect(between.body.facets.price).toEqual({ min: 500_000, max: 3_000_000 })
  })

  it('thuộc tính cấp biến thể và giá phải khớp trên cùng một biến thể', async () => {
    const { request, add } = await shop()
    await add(
      shoe({
        name: 'Hai size',
        slug: 'hai-size',
        variants: [
          { sku: 'HS-40', attributes: { mau: 'Đen', size: '40' }, price: 1_000_000 },
          { sku: 'HS-41', attributes: { mau: 'Đen', size: '41' }, price: 3_000_000 },
        ],
      }),
    )

    const size41 = await request.get('/api/products').query({ category: 'sneaker', 'attr.size': '41' })
    const size41Cheap = await request
      .get('/api/products')
      .query({ category: 'sneaker', 'attr.size': '41', maxPrice: 2_000_000 })

    expect(slugs(size41)).toEqual(['hai-size'])
    expect(slugs(size41Cheap)).toEqual([])
  })

  it('facets theo nhóm hàng đang xem: chỉ thuộc tính filterable của nhóm đó, đếm theo các bộ lọc khác', async () => {
    const { request, add } = await shop()
    await add(
      shoe({
        name: 'Da đen',
        slug: 'da-den',
        attributes: { gioi_tinh: 'Nam', he_size: 'EU', chat_lieu: 'Da' },
        variants: [
          { sku: 'DD-40', attributes: { mau: 'Đen', size: '40' }, price: 1_000_000 },
          { sku: 'DD-41', attributes: { mau: 'Đen', size: '41' }, price: 1_000_000 },
        ],
      }),
    )
    await add(
      shoe({
        name: 'Vải trắng',
        slug: 'vai-trang',
        attributes: { gioi_tinh: 'Unisex', he_size: 'EU', chat_lieu: 'Vải' },
        variants: [{ sku: 'VT-41', attributes: { mau: 'Trắng', size: '41' }, price: 2_000_000 }],
      }),
    )
    await add({
      name: 'No 5',
      slug: 'no-5',
      brand: 'chanel',
      category: 'nuoc-hoa-nu',
      attributes: { gioi_tinh: 'Nữ', nong_do: 'Eau de Parfum', nhom_huong: ['Hương hoa'] },
      variants: [{ sku: 'NO5-100', attributes: { dung_tich: 100 }, price: 4_000_000 }],
    })

    const res = await request.get('/api/products').query({ category: 'sneaker', 'attr.chat_lieu': 'Da' })
    const perfume = await request.get('/api/products').query({ type: 'fragrance' })

    expect(slugs(res)).toEqual(['da-den'])
    expect(res.body.productType).toBe('footwear')
    expect(res.body.facets.attributes).toEqual([
      { key: 'gioi_tinh', label: 'Giới tính', type: 'enum', unit: null, values: [{ value: 'Nam', count: 1 }] },
      {
        key: 'size',
        label: 'Size',
        type: 'text',
        unit: null,
        values: [
          { value: '40', count: 1 },
          { value: '41', count: 1 },
        ],
      },
      { key: 'mau', label: 'Màu', type: 'text', unit: null, values: [{ value: 'Đen', count: 1 }] },
      {
        key: 'chat_lieu',
        label: 'Chất liệu',
        type: 'text',
        unit: null,
        values: [
          { value: 'Da', count: 1 },
          { value: 'Vải', count: 1 },
        ],
      },
    ])
    expect(res.body.facets.price).toEqual({ min: 1_000_000, max: 1_000_000 })
    expect(perfume.body.facets.attributes.map((f: { key: string }) => f.key)).toEqual([
      'gioi_tinh',
      'dung_tich',
      'nong_do',
      'nhom_huong',
      'dang_dong_goi',
    ])
    expect(perfume.body.facets.attributes[1]).toEqual({
      key: 'dung_tich',
      label: 'Dung tích',
      type: 'number',
      unit: 'ml',
      values: [{ value: '100', count: 1 }],
    })
  })

  it('lọc giới tính Nam ra cả sản phẩm Unisex, không ra sản phẩm Nữ; facets vẫn đếm riêng từng giá trị', async () => {
    const { request, add } = await shop()
    await add(shoe({ name: 'Giày nam', slug: 'giay-nam', attributes: { gioi_tinh: 'Nam', he_size: 'EU' } }))
    await add(shoe({ name: 'Giày nữ', slug: 'giay-nu', attributes: { gioi_tinh: 'Nữ', he_size: 'EU' } }))
    await add(shoe({ name: 'Giày unisex', slug: 'giay-unisex', attributes: { gioi_tinh: 'Unisex', he_size: 'EU' } }))

    const men = await request.get('/api/products').query({ 'attr.gioi_tinh': 'Nam', sort: 'price_asc' })
    const unisexOnly = await request.get('/api/products').query({ 'attr.gioi_tinh': 'Unisex' })

    expect(slugs(men).sort()).toEqual(['giay-nam', 'giay-unisex'])
    expect(men.body.productType).toBeNull()
    expect(men.body.facets.attributes).toEqual([
      {
        key: 'gioi_tinh',
        label: 'Giới tính',
        type: 'enum',
        unit: null,
        values: [
          { value: 'Nam', count: 1 },
          { value: 'Nữ', count: 1 },
          { value: 'Unisex', count: 1 },
        ],
      },
    ])
    expect(men.body.facets.productTypes).toEqual([{ productType: 'footwear', count: 2 }])
    expect(slugs(unisexOnly)).toEqual(['giay-unisex'])
  })

  it('bộ lọc thuộc tính không có trong nhóm hàng đang xem thì bị bỏ qua', async () => {
    const { request, add } = await shop()
    await add(shoe({ name: 'Giày', slug: 'giay' }))

    const res = await request.get('/api/products').query({ category: 'sneaker', 'attr.nong_do': 'Parfum' })

    expect(slugs(res)).toEqual(['giay'])
  })
})

describe('kết quả', () => {
  it('sản phẩm nháp hoặc lưu trữ không xuất hiện trong tìm kiếm và facets', async () => {
    const { request, add } = await shop()
    await add(shoe({ name: 'Giày nháp', slug: 'giay-nhap', status: 'draft' }))
    await add(shoe({ name: 'Giày lưu trữ', slug: 'giay-luu-tru', status: 'archived' }))
    await add(shoe({ name: 'Giày đang bán', slug: 'giay-dang-ban' }))

    const res = await request.get('/api/products').query({ q: 'giay', category: 'sneaker' })

    expect(slugs(res)).toEqual(['giay-dang-ban'])
    expect(res.body.total).toBe(1)
    expect(res.body.facets.attributes[0].values).toEqual([{ value: 'Nam', count: 1 }])
  })

  it('sắp xếp theo mới nhất, giá tăng, giá giảm; tham số sai thì lỗi theo trường', async () => {
    const { request, add } = await shop()
    for (const [slug, price] of [
      ['vua', 2_000_000],
      ['re', 1_000_000],
      ['dat', 3_000_000],
    ] as const) {
      await add(
        shoe({ name: slug, slug, variants: [{ sku: `${slug}-1`, attributes: { mau: 'Đen', size: '40' }, price }] }),
      )
    }

    const newest = await request.get('/api/products').query({ sort: 'newest' })
    const asc = await request.get('/api/products').query({ sort: 'price_asc' })
    const desc = await request.get('/api/products').query({ sort: 'price_desc' })
    const invalid = await request.get('/api/products').query({ sort: 'popular', minPrice: 'abc' })

    expect(slugs(newest)).toEqual(['dat', 're', 'vua'])
    expect(slugs(asc)).toEqual(['re', 'vua', 'dat'])
    expect(slugs(desc)).toEqual(['dat', 'vua', 're'])
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual(['minPrice', 'sort'])
  })

  it('phân trang 24 sản phẩm một trang, giữ thứ tự sắp xếp qua các trang', async () => {
    const { request, add } = await shop()
    for (let i = 1; i <= 25; i++) {
      const slug = `giay-${String(i).padStart(2, '0')}`
      await add(
        shoe({
          name: slug,
          slug,
          variants: [{ sku: `G-${i}`, attributes: { mau: 'Đen', size: '40' }, price: i * 100_000 }],
        }),
      )
    }

    const first = await request.get('/api/products').query({ sort: 'price_desc' })
    const second = await request.get('/api/products').query({ sort: 'price_desc', page: 2 })

    expect(first.body).toMatchObject({ page: 1, pageSize: 24, total: 25 })
    expect(slugs(first)[0]).toBe('giay-25')
    expect(slugs(first)).toHaveLength(24)
    expect(second.body).toMatchObject({ page: 2, total: 25 })
    expect(slugs(second)).toEqual(['giay-01'])
  }, 120_000)
})
