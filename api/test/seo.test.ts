import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, login, type Request } from './support/staff.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown> = {}) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBeLessThan(300)
  return res.body as { id: string }
}

const photo = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: '#a33' } })
    .jpeg()
    .toBuffer()

/** Owner đã đăng nhập; thương hiệu Nike, danh mục Sneaker; `add` tạo sản phẩm giày có ảnh và biến thể. */
async function shop() {
  const app = await appWithOwner()
  const { accessToken: token } = await login(app.request, OWNER.email, OWNER.password)
  const brand = await post(app.request, token, '/api/admin/brands', { name: 'Nike', slug: 'nike' })
  const category = await post(app.request, token, '/api/admin/categories', {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
  })
  const fields = (name: string, slug: string) => ({
    brandId: brand.id,
    categoryId: category.id,
    name,
    slug,
    attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
  })

  let skuCount = 0
  async function add(name: string, slug: string, status: 'draft' | 'published' | 'archived' = 'published') {
    const product = await post(app.request, token, '/api/admin/products', fields(name, slug))
    await post(app.request, token, `/api/admin/products/${product.id}/variants`, {
      sku: `SKU-${++skuCount}`,
      attributes: { mau: 'Đen', size: '40' },
      price: 2_000_000,
    })
    const image = await app.request
      .post(`/api/admin/products/${product.id}/images`)
      .set(bearer(token))
      .attach('file', await photo(), 'anh.jpg')
    expect(image.status).toBe(201)
    if (status !== 'draft') await setStatus(product.id, 'published')
    if (status === 'archived') await setStatus(product.id, 'archived')
    return product
  }

  async function setStatus(id: string, status: 'published' | 'archived') {
    const res = await app.request.put(`/api/admin/products/${id}/status`).set(bearer(token)).send({ status })
    expect(res.status).toBe(200)
  }

  async function rename(id: string, name: string, slug: string) {
    const res = await app.request.put(`/api/admin/products/${id}`).set(bearer(token)).send(fields(name, slug))
    expect(res.status).toBe(200)
  }

  return { ...app, token, brand, category, add, setStatus, rename }
}

const paths = (res: { body: { entries: { path: string }[] } }) => res.body.entries.map((e) => e.path)

describe('sitemap', () => {
  it('chỉ chứa sản phẩm, danh mục, thương hiệu và trang nội dung đã xuất bản hoặc đang hiển thị', async () => {
    const { request, token, add } = await shop()
    await add('Air Max 90', 'air-max-90')
    await add('Air Force 1', 'air-force-1', 'draft')
    await add('Cortez', 'cortez', 'archived')
    const hiddenBrand = await post(request, token, '/api/admin/brands', { name: 'Hãng Ẩn', slug: 'hang-an' })
    await post(request, token, `/api/admin/brands/${hiddenBrand.id}/hide`)
    const hiddenCategory = await post(request, token, '/api/admin/categories', {
      name: 'Đồng hồ cơ',
      slug: 'dong-ho-co',
      productType: 'watch',
    })
    await post(request, token, `/api/admin/categories/${hiddenCategory.id}/hide`)
    const policy = await post(request, token, '/api/admin/pages', {
      slug: 'chinh-sach-doi-tra',
      kind: 'policy',
      title: 'Chính sách đổi trả',
      body: 'Đổi trong 7 ngày.',
    })
    await post(request, token, `/api/admin/pages/${policy.id}/publish`)
    await post(request, token, '/api/admin/pages', { slug: 'trang-nhap', kind: 'about', title: 'Nháp', body: 'x' })

    const res = await request.get('/api/sitemap')

    expect(res.status).toBe(200)
    expect(paths(res).sort()).toEqual(
      ['/danh-muc/sneaker', '/san-pham/air-max-90', '/thuong-hieu/nike', '/trang/chinh-sach-doi-tra'].sort(),
    )
    for (const entry of res.body.entries) expect(Number.isNaN(Date.parse(entry.lastModified))).toBe(false)
  })

  it('cập nhật khi xuất bản lại hoặc lưu trữ: slug theo phiên bản đang xuất bản, không theo bản đang soạn', async () => {
    const { request, add, rename, setStatus } = await shop()
    const product = await add('Air Max 90', 'air-max-90')

    await rename(product.id, 'Air Max 90 SE', 'air-max-90-se')
    expect(paths(await request.get('/api/sitemap'))).toContain('/san-pham/air-max-90')

    await setStatus(product.id, 'published')
    const republished = paths(await request.get('/api/sitemap'))
    expect(republished).toContain('/san-pham/air-max-90-se')
    expect(republished).not.toContain('/san-pham/air-max-90')

    await setStatus(product.id, 'archived')
    expect(paths(await request.get('/api/sitemap')).filter((p) => p.startsWith('/san-pham/'))).toEqual([])
  })
})

describe('slug cũ của sản phẩm', () => {
  it('mở slug cũ sau khi đổi slug và xuất bản lại thì nhận sản phẩm với slug hiện tại, để website chuyển hướng', async () => {
    const { request, add, rename, setStatus } = await shop()
    const product = await add('Air Max 90', 'air-max-90')
    await rename(product.id, 'Air Max 90 SE', 'air-max-90-se')
    await setStatus(product.id, 'published')

    const res = await request.get('/api/products/air-max-90')

    expect(res.status).toBe(200)
    expect(res.body.slug).toBe('air-max-90-se')
    expect(res.body.name).toBe('Air Max 90 SE')
  })

  it('slug cũ của sản phẩm đã lưu trữ vẫn 404', async () => {
    const { request, add, rename, setStatus } = await shop()
    const product = await add('Air Max 90', 'air-max-90')
    await rename(product.id, 'Air Max 90 SE', 'air-max-90-se')
    await setStatus(product.id, 'published')
    await setStatus(product.id, 'archived')

    expect((await request.get('/api/products/air-max-90')).status).toBe(404)
    expect((await request.get('/api/products/air-max-90-se')).status).toBe(404)
  })

  it('slug đang dùng bởi một sản phẩm khác thì trả sản phẩm đó, không chuyển hướng', async () => {
    const { request, add, rename, setStatus } = await shop()
    const first = await add('Air Max 90', 'air-max-90')
    await rename(first.id, 'Air Max 90 SE', 'air-max-90-se')
    await setStatus(first.id, 'published')
    await add('Air Max 90 Mới', 'air-max-90')

    const res = await request.get('/api/products/air-max-90')

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Air Max 90 Mới')
  })
})
