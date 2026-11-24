import sharp from 'sharp'
import { expect } from 'vitest'
import { OWNER, appWithOwner, bearer, login, type Request } from './staff.ts'
import { publishPrivacyPolicy } from './customer.ts'
import { adjust } from './stock.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

const photo = () =>
  sharp({ create: { width: 32, height: 32, channels: 3, background: '#333' } })
    .jpeg()
    .toBuffer()

export const HA_NOI = '01'
/** Phường Ba Đình, Hà Nội. */
export const BA_DINH = '00004'

/** Valid shipping info in Hà Nội. */
export const ADDRESS = {
  recipientName: 'Nguyễn Văn An',
  phone: '0912345678',
  email: 'An@Example.com',
  provinceCode: HA_NOI,
  wardCode: BA_DINH,
  streetAddress: '12 Phố Huế',
}

/**
 * A shop ready for orders: signed-in owner, 30,000 default shipping, Air Max shoes published with a published returns
 * policy page, privacy policy version 1. AM-40 at 2,000,000 with 3 pairs, AM-41 at 2,100,000 out of stock.
 */
export async function shop(options?: Parameters<typeof appWithOwner>[0]) {
  const app = await appWithOwner(options)
  const { request } = app
  const { accessToken: token } = await login(request, OWNER.email, OWNER.password)
  const brand = await post(request, token, '/api/admin/brands', { name: 'Nike', slug: 'nike' })
  const category = await post(request, token, '/api/admin/categories', {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
  })
  const product = await post(request, token, '/api/admin/products', {
    brandId: brand.id,
    categoryId: category.id,
    name: 'Air Max',
    slug: 'air-max',
    attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
  })
  const variant = (sku: string, size: string, price: number) =>
    post(request, token, `/api/admin/products/${product.id}/variants`, { sku, attributes: { mau: 'Đen', size }, price })
  const v40 = await variant('AM-40', '40', 2_000_000)
  const v41 = await variant('AM-41', '41', 2_100_000)
  const image = await request
    .post(`/api/admin/products/${product.id}/images`)
    .set(bearer(token))
    .attach('file', await photo(), 'anh.jpg')
  expect(image.status).toBe(201)

  const policy = await post(request, token, '/api/admin/pages', {
    slug: 'doi-tra',
    kind: 'policy',
    title: 'Đổi trả',
    body: 'Đổi trong 7 ngày',
  })
  expect((await request.post(`/api/admin/pages/${policy.id}/publish`).set(bearer(token))).status).toBe(200)
  const policies = await request
    .put(`/api/admin/products/${product.id}/policies`)
    .set(bearer(token))
    .send({ pageIds: [policy.id] })
  expect(policies.status).toBe(200)

  const publish = await request
    .put(`/api/admin/products/${product.id}/status`)
    .set(bearer(token))
    .send({ status: 'published' })
  expect(publish.status).toBe(200)
  await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 3, expectedOnHand: 0 })
  const fees = await request
    .put('/api/admin/shipping-fees')
    .set(bearer(token))
    .send({ defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] })
  expect(fees.status).toBe(200)
  await publishPrivacyPolicy(request)

  /** A guest checks out AM-40 at the current price as seen, with consent; `body` overrides parts. */
  const checkout = (body: Record<string, unknown> = {}) =>
    request.post('/api/checkout').send({
      lines: [{ variantId: v40.id, quantity: 1, price: 2_000_000 }],
      address: ADDRESS,
      acceptPrivacyPolicy: true,
      ...body,
    })

  /** Changes a variant's price (live for customers at once) or status. */
  const editVariant = (v: { id: string }, sku: string, size: string, change: Record<string, unknown>) =>
    request
      .put(`/api/admin/products/${product.id}/variants/${v.id}`)
      .set(bearer(token))
      .send({ sku, attributes: { mau: 'Đen', size }, price: sku === 'AM-40' ? 2_000_000 : 2_100_000, ...change })

  return { ...app, token, brand, category, product, policy, v40, v41, checkout, editVariant }
}
