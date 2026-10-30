import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, login, type Request } from './support/staff.ts'
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

type Variant = { sku: string; size: string; price: number }

/** Owner đã đăng nhập; `add` tạo sản phẩm giày đã xuất bản và trả id các biến thể theo SKU. */
async function shop() {
  const app = await appWithOwner()
  const { accessToken: token } = await login(app.request, OWNER.email, OWNER.password)
  const brand = await post(app.request, token, '/api/admin/brands', { name: 'Nike', slug: 'nike' })
  const category = await post(app.request, token, '/api/admin/categories', {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
  })

  async function add(slug: string, variants: Variant[]) {
    const product = await post(app.request, token, '/api/admin/products', {
      brandId: brand.id,
      categoryId: category.id,
      name: slug,
      slug,
      attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
    })
    const ids: Record<string, string> = {}
    for (const v of variants) {
      ids[v.sku] = (
        await post(app.request, token, `/api/admin/products/${product.id}/variants`, {
          sku: v.sku,
          attributes: { mau: 'Đen', size: v.size },
          price: v.price,
        })
      ).id
    }
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
    return { id: product.id, variants: ids }
  }

  const stock = (variantId: string, countedQuantity: number, expectedOnHand = 0) =>
    adjust(app.request, token, { variantId, reason: 'stocktake', countedQuantity, expectedOnHand })

  return { ...app, token, add, stock }
}

const shoe = (prefix: string, price = 2_000_000): Variant[] => [
  { sku: `${prefix}-40`, size: '40', price },
  { sku: `${prefix}-41`, size: '41', price },
]

describe('trang sản phẩm', () => {
  it('mỗi biến thể có inStock theo tồn hiện tại; khách không thấy số tồn', async () => {
    const { request, add, stock } = await shop()
    const product = await add('air-max', shoe('AM'))
    await stock(product.variants['AM-41']!, 3)

    const res = await request.get('/api/products/air-max')

    expect(res.body.variants.map((v: { sku: string; inStock: boolean }) => [v.sku, v.inStock])).toEqual([
      ['AM-40', false],
      ['AM-41', true],
    ])
    expect(JSON.stringify(res.body)).not.toMatch(/onHand|on_hand|"3"/)
  })

  it('đổi tồn không tạo phiên bản xuất bản mới', async () => {
    const { request, token, add, stock } = await shop()
    const product = await add('air-max', shoe('AM'))
    const before = await request.get(`/api/admin/products/${product.id}`).set(bearer(token))

    await stock(product.variants['AM-40']!, 5)
    const after = await request.get(`/api/admin/products/${product.id}`).set(bearer(token))

    expect(after.body.liveVersion.version).toBe(before.body.liveVersion.version)
    expect(after.body.hasUnpublishedChanges).toBe(false)
  })
})

describe('thẻ sản phẩm và thứ tự trong danh sách', () => {
  it('sản phẩm hết hàng vẫn có trong danh sách, có inStock false và đứng sau sản phẩm còn hàng, kể cả khi sắp theo giá', async () => {
    const { request, add, stock } = await shop()
    await add('re-het-hang', shoe('RE', 1_000_000))
    const pricey = await add('dat-con-hang', shoe('DAT', 5_000_000))
    await stock(pricey.variants['DAT-40']!, 1)

    const byPrice = await request.get('/api/products').query({ sort: 'price_asc' })
    const newest = await request.get('/api/products')

    for (const res of [byPrice, newest]) {
      expect(res.body.items.map((c: { slug: string; inStock: boolean }) => [c.slug, c.inStock])).toEqual([
        ['dat-con-hang', true],
        ['re-het-hang', false],
      ])
    }
    expect(byPrice.body.total).toBe(2)
  })

  it('SKU khớp vẫn lên đầu dù hết hàng', async () => {
    const { request, add, stock } = await shop()
    await add('pegasus', shoe('PG'))
    const other = await add('pg-con-hang', shoe('XX'))
    await stock(other.variants['XX-40']!, 2)

    const res = await request.get('/api/products').query({ q: 'PG-40' })

    expect(res.body.items[0]).toMatchObject({ slug: 'pegasus', inStock: false })
  })

  it('biến thể đã ngừng bán (không còn trong phiên bản đang xuất bản) còn hàng thì sản phẩm vẫn là hết hàng', async () => {
    const { request, token, add, stock } = await shop()
    const product = await add('air-max', shoe('AM'))
    const discontinued = product.variants['AM-41']!
    const edit = await request
      .put(`/api/admin/products/${product.id}/variants/${discontinued}`)
      .set(bearer(token))
      .send({ sku: 'AM-41', attributes: { mau: 'Đen', size: '41' }, price: 2_000_000, status: 'discontinued' })
    expect(edit.status).toBe(200)
    const republish = await request
      .put(`/api/admin/products/${product.id}/status`)
      .set(bearer(token))
      .send({ status: 'published' })
    expect(republish.status).toBe(200)
    await stock(discontinued, 7)

    const list = await request.get('/api/products')
    const page = await request.get('/api/products/air-max')

    expect(list.body.items[0]).toMatchObject({ slug: 'air-max', inStock: false })
    expect(page.body.variants).toEqual([expect.objectContaining({ sku: 'AM-40', inStock: false })])
  })

  it('biến thể chưa có trong phiên bản đang xuất bản còn hàng thì sản phẩm vẫn là hết hàng', async () => {
    const { request, token, add, stock } = await shop()
    const product = await add('air-max', shoe('AM'))
    const added = await post(request, token, `/api/admin/products/${product.id}/variants`, {
      sku: 'AM-42',
      attributes: { mau: 'Đen', size: '42' },
      price: 2_000_000,
    })
    await stock(added.id, 10)

    const list = await request.get('/api/products')
    const page = await request.get('/api/products/air-max')

    expect(list.body.items[0]).toMatchObject({ slug: 'air-max', inStock: false })
    expect(page.body.variants.map((v: { sku: string }) => v.sku)).toEqual(['AM-40', 'AM-41'])
  })
})
