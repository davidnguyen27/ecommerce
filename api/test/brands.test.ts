import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { InMemoryStorage } from '../src/adapters/storage.ts'
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
    expect(page.body).toEqual({ ...BRAND, logo: null })
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

const logoFile = () =>
  sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer()

function uploadLogo(request: Request, token: string, brandId: string, file: Buffer, filename = 'logo.png') {
  return request.put(`/api/admin/brands/${brandId}/logo`).set(bearer(token)).attach('file', file, filename)
}

function brandAudit(request: Request, token: string) {
  return request
    .get('/api/admin/audit')
    .query({ entityType: 'brand' })
    .set(bearer(token))
    .then((res) => res.body.items as { action: string; before: unknown; after: unknown }[])
}

/** File mà URL công khai trỏ tới, đọc từ storage giả. */
const publicObject = (storage: InMemoryStorage, url: string) =>
  storage.objects.get(`public/${url.replace('memory://public/', '')}`)

type Logo = { originalUrl: string; width: number; height: number; sizes: { width: number; url: string }[] }

describe('logo thương hiệu', () => {
  it('tải logo lưu bản gốc và các cỡ webp; đổi logo thì xóa file logo cũ; mỗi lần đổi đều ghi audit', async () => {
    const { request, storage } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const brand = await createBrand(request, owner.accessToken)

    const first = await uploadLogo(request, owner.accessToken, brand.id, await logoFile())
    const second = await uploadLogo(request, owner.accessToken, brand.id, await logoFile())
    const list = await request.get('/api/admin/brands').set(bearer(owner.accessToken))
    const audit = await brandAudit(request, owner.accessToken)

    expect(first.status).toBe(200)
    const old = first.body.logo as Logo
    const current = second.body.logo as Logo
    expect(old).toMatchObject({ width: 600, height: 300 })
    expect(old.sizes.map((s) => s.width)).toEqual([160, 320])
    expect(list.body.items[0].logo).toEqual(current)
    for (const url of [old.originalUrl, ...old.sizes.map((s) => s.url)]) {
      expect(publicObject(storage, url)).toBeUndefined()
    }
    expect(publicObject(storage, current.originalUrl)).toMatchObject({ contentType: 'image/png' })
    expect(publicObject(storage, current.sizes[0]!.url)).toMatchObject({ contentType: 'image/webp' })
    expect(audit.slice(0, 2).map((e) => e.action)).toEqual(['media.brand_logo.upload', 'media.brand_logo.upload'])
    expect(audit[1]).toMatchObject({ before: { logo: null }, after: { logo: { contentType: 'image/png' } } })
  })

  it('gỡ logo thì xóa file trên storage; gỡ khi chưa có logo thì không ghi gì', async () => {
    const { request, storage } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const brand = await createBrand(request, owner.accessToken)
    await uploadLogo(request, owner.accessToken, brand.id, await logoFile())

    const removed = await request.delete(`/api/admin/brands/${brand.id}/logo`).set(bearer(owner.accessToken))
    const again = await request.delete(`/api/admin/brands/${brand.id}/logo`).set(bearer(owner.accessToken))
    const audit = await brandAudit(request, owner.accessToken)

    expect([removed.status, again.status]).toEqual([200, 200])
    expect(removed.body.logo).toBeNull()
    expect(storage.objects.size).toBe(0)
    expect(audit[0]).toMatchObject({ action: 'media.brand_logo.delete', after: { logo: null } })
    expect(audit.filter((e) => e.action === 'media.brand_logo.delete')).toHaveLength(1)
  })

  it('logo giả mạo đuôi bị từ chối; thiếu media.upload thì 403', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const brand = await createBrand(request, owner.accessToken)
    const accountant = await createStaff(request, owner.accessToken, ['accountant'])

    const fake = await uploadLogo(request, owner.accessToken, brand.id, Buffer.from('%PDF-1.7'), 'logo.png')
    const upload = await uploadLogo(request, accountant.accessToken, brand.id, await logoFile())
    const remove = await request.delete(`/api/admin/brands/${brand.id}/logo`).set(bearer(accountant.accessToken))

    expect(fake.status).toBe(400)
    expect(fake.body.error.fields[0].path).toBe('file')
    expect([upload.status, remove.status]).toEqual([403, 403])
  })
})
