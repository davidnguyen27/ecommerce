import { expect } from 'vitest'
import { OWNER, appWithOwner, bearer, login, type Request } from './staff.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

/** Owner đã đăng nhập, có sản phẩm nháp Air Max 90 với hai biến thể AM90-40 và AM90-41, tồn đều bằng 0. */
export async function warehouse() {
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
  const variant = async (sku: string, size: string) =>
    post(app.request, token, `/api/admin/products/${product.id}/variants`, {
      sku,
      attributes: { mau: 'Đen', size },
    })
  const v40 = await variant('AM90-40', '40')
  const v41 = await variant('AM90-41', '41')
  return { ...app, token, brand, product, v40, v41 }
}

export function adjust(request: Request, token: string, body: Record<string, unknown>) {
  return request.post('/api/admin/stock/adjustments').set(bearer(token)).send(body)
}

export async function onHandOf(request: Request, token: string, sku: string) {
  const res = await request.get('/api/admin/stock').query({ q: sku }).set(bearer(token))
  expect(res.status).toBe(200)
  return (res.body.items as { sku: string; onHand: number }[]).find((i) => i.sku === sku)?.onHand
}

export const movementsOf = (request: Request, token: string, query: Record<string, string> = {}) =>
  request.get('/api/admin/stock/movements').query(query).set(bearer(token))
