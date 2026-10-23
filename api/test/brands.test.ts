import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

const BRAND = { name: 'Seiko', slug: 'seiko', description: 'Đồng hồ Nhật Bản' }

async function createBrand(request: Request, token: string, brand: Record<string, unknown> = BRAND) {
  const res = await request.post('/api/admin/brands').set(bearer(token)).send(brand)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

describe('quản lý thương hiệu', () => {
  it('sửa tên, slug và mô tả; danh sách quản trị có cả thương hiệu đang ẩn', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const brand = await createBrand(request, owner.accessToken)
    await request.post(`/api/admin/brands/${brand.id}/hide`).set(bearer(owner.accessToken))

    const edited = await request
      .put(`/api/admin/brands/${brand.id}`)
      .set(bearer(owner.accessToken))
      .send({ name: 'Seiko Watch', slug: 'seiko-watch', description: '' })
    const list = await request.get('/api/admin/brands').set(bearer(owner.accessToken))

    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ name: 'Seiko Watch', slug: 'seiko-watch', description: '', hidden: true })
    expect(list.body.items).toEqual([edited.body])
  })

  it('slug trùng thì 409 khi tạo lẫn khi sửa', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    await createBrand(request, owner.accessToken)
    const casio = await createBrand(request, owner.accessToken, { name: 'Casio', slug: 'casio' })

    const duplicate = await request
      .post('/api/admin/brands')
      .set(bearer(owner.accessToken))
      .send({ name: 'Seiko 2', slug: 'seiko' })
    const renamed = await request
      .put(`/api/admin/brands/${casio.id}`)
      .set(bearer(owner.accessToken))
      .send({ name: 'Casio', slug: 'seiko' })

    for (const res of [duplicate, renamed]) {
      expect(res.status).toBe(409)
      expect(res.body.error.fields).toEqual([{ path: 'slug', message: expect.any(String) }])
    }
  })
})

describe('quyền và audit', () => {
  it('thiếu catalog.edit thì không xem, tạo, sửa hay ẩn được thương hiệu', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const brand = await createBrand(request, owner.accessToken)
    const { accessToken: token } = await createStaff(request, owner.accessToken, ['accountant'])

    const attempts = await Promise.all([
      request.get('/api/admin/brands').set(bearer(token)),
      request.post('/api/admin/brands').set(bearer(token)).send({ name: 'Casio', slug: 'casio' }),
      request.put(`/api/admin/brands/${brand.id}`).set(bearer(token)).send({ name: 'Sửa trộm', slug: 'seiko' }),
      request.post(`/api/admin/brands/${brand.id}/hide`).set(bearer(token)),
    ])

    for (const res of attempts) {
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    }
    expect((await request.get('/api/brands/seiko')).body.name).toBe('Seiko')
  })

  it('nhân viên kho có catalog.edit thì tạo được thương hiệu', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const warehouse = await createStaff(request, owner.accessToken, ['warehouse'])

    await createBrand(request, warehouse.accessToken)
  })

  it('tạo, sửa, ẩn ghi audit kèm trước/sau; thao tác không đổi gì thì không ghi', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const token = owner.accessToken
    const brand = await createBrand(request, token)
    await request
      .put(`/api/admin/brands/${brand.id}`)
      .set(bearer(token))
      .send({ ...BRAND, name: 'Seiko Watch' })
    await request
      .put(`/api/admin/brands/${brand.id}`)
      .set(bearer(token))
      .send({ ...BRAND, name: 'Seiko Watch' })
    await request.post(`/api/admin/brands/${brand.id}/hide`).set(bearer(token))
    await request.post(`/api/admin/brands/${brand.id}/hide`).set(bearer(token))
    await request.post(`/api/admin/brands/${brand.id}/unhide`).set(bearer(token))

    const audit = await request.get('/api/admin/audit').query({ entityType: 'brand' }).set(bearer(token))

    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual([
      'catalog.brand.unhide',
      'catalog.brand.hide',
      'catalog.brand.update',
      'catalog.brand.create',
    ])
    expect(audit.body.items[2]).toMatchObject({
      entityId: brand.id,
      before: { name: 'Seiko' },
      after: { name: 'Seiko Watch' },
    })
    expect(audit.body.items[1]).toMatchObject({ before: { hidden: false }, after: { hidden: true } })
  })
})

describe('API công khai', () => {
  it('thương hiệu mới tạo xuất hiện trong danh sách và có trang riêng', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    await createBrand(request, owner.accessToken)

    const list = await request.get('/api/brands')
    const page = await request.get('/api/brands/seiko')

    expect(list.status).toBe(200)
    expect(list.body.items).toEqual([{ slug: 'seiko', name: 'Seiko' }])
    expect(page.status).toBe(200)
    expect(page.body).toEqual(BRAND)
  })

  it('thương hiệu bị ẩn không có trong danh sách và trang riêng trả 404; bỏ ẩn thì hiện lại', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const brand = await createBrand(request, owner.accessToken)
    await createBrand(request, owner.accessToken, { name: 'Casio', slug: 'casio' })

    const hide = await request.post(`/api/admin/brands/${brand.id}/hide`).set(bearer(owner.accessToken))
    const hiddenList = await request.get('/api/brands')
    const hiddenPage = await request.get('/api/brands/seiko')
    await request.post(`/api/admin/brands/${brand.id}/unhide`).set(bearer(owner.accessToken))

    expect(hide.status).toBe(200)
    expect(hide.body).toMatchObject({ slug: 'seiko', hidden: true })
    expect(hiddenList.body.items).toEqual([{ slug: 'casio', name: 'Casio' }])
    expect(hiddenPage.status).toBe(404)
    expect((await request.get('/api/brands')).body.items.map((b: { slug: string }) => b.slug)).toEqual([
      'casio',
      'seiko',
    ])
  })
})
