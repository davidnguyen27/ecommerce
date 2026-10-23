import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

async function createCategory(request: Request, token: string, category: Record<string, unknown>) {
  const res = await request.post('/api/admin/categories').set(bearer(token)).send(category)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

function editCategory(request: Request, token: string, id: string, changes: Record<string, unknown>) {
  return request.put(`/api/admin/categories/${id}`).set(bearer(token)).send(changes)
}

/** Owner đã đăng nhập, có sẵn Giày dép > Sneaker và Nước hoa > Nước hoa nam. */
async function appWithCategories() {
  const { request } = await appWithOwner()
  const { accessToken: token } = await login(request, OWNER.email, OWNER.password)
  const sneaker = await createCategory(request, token, { name: 'Sneaker', slug: 'sneaker', productType: 'footwear' })
  const perfume = await createCategory(request, token, {
    name: 'Nước hoa nam',
    slug: 'nuoc-hoa-nam',
    productType: 'fragrance',
  })
  return { request, token, sneaker, perfume }
}

describe('ràng buộc của cây', () => {
  it('danh mục con khác nhóm hàng với cha thì bị từ chối', async () => {
    const { request, token, sneaker } = await appWithCategories()

    const res = await request
      .post('/api/admin/categories')
      .set(bearer(token))
      .send({ name: 'Nước hoa', slug: 'nuoc-hoa-sneaker', productType: 'fragrance', parentId: sneaker.id })

    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([{ path: 'parentId', message: expect.any(String) }])
    expect((await request.get('/api/categories/nuoc-hoa-sneaker')).status).toBe(404)
  })

  it('không đưa được danh mục vào dưới chính nó hay dưới nhánh con của nó', async () => {
    const { request, token, sneaker } = await appWithCategories()
    const low = await createCategory(request, token, {
      name: 'Cổ thấp',
      slug: 'co-thap',
      productType: 'footwear',
      parentId: sneaker.id,
    })
    const white = await createCategory(request, token, {
      name: 'Trắng',
      slug: 'trang',
      productType: 'footwear',
      parentId: low.id,
    })

    const underSelf = await editCategory(request, token, sneaker.id, {
      name: 'Sneaker',
      slug: 'sneaker',
      parentId: sneaker.id,
    })
    const underGrandchild = await editCategory(request, token, sneaker.id, {
      name: 'Sneaker',
      slug: 'sneaker',
      parentId: white.id,
    })

    for (const res of [underSelf, underGrandchild]) {
      expect(res.status).toBe(409)
      expect(res.body.error.fields).toEqual([{ path: 'parentId', message: expect.any(String) }])
    }
    expect((await request.get('/api/categories/trang')).body.ancestors.map((a: { slug: string }) => a.slug)).toEqual([
      'sneaker',
      'co-thap',
    ])
  })

  it('đổi cha trong cùng nhóm hàng thì được; sang nhóm hàng khác thì bị từ chối', async () => {
    const { request, token, sneaker, perfume } = await appWithCategories()
    const boots = await createCategory(request, token, { name: 'Boot', slug: 'boot', productType: 'footwear' })

    const moved = await editCategory(request, token, boots.id, { name: 'Boot', slug: 'boot', parentId: sneaker.id })
    const crossType = await editCategory(request, token, boots.id, {
      name: 'Boot',
      slug: 'boot',
      parentId: perfume.id,
    })

    expect(moved.status).toBe(200)
    expect(moved.body).toMatchObject({ parentId: sneaker.id, productType: 'footwear' })
    expect(crossType.status).toBe(409)
    expect((await request.get('/api/categories/boot')).body.ancestors).toEqual([{ slug: 'sneaker', name: 'Sneaker' }])
  })

  it('nhóm hàng cố định từ lúc tạo: sửa chỉ đổi tên, slug và cha', async () => {
    const { request, token, sneaker } = await appWithCategories()

    const edited = await editCategory(request, token, sneaker.id, {
      name: 'Giày thể thao',
      slug: 'giay-the-thao',
      parentId: null,
      productType: 'fragrance',
    })

    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ name: 'Giày thể thao', slug: 'giay-the-thao', productType: 'footwear' })
  })

  it('slug trùng thì 409 khi tạo lẫn khi sửa', async () => {
    const { request, token, sneaker } = await appWithCategories()

    const duplicate = await request
      .post('/api/admin/categories')
      .set(bearer(token))
      .send({ name: 'Nước hoa nam 2', slug: 'nuoc-hoa-nam', productType: 'fragrance' })
    const renamed = await editCategory(request, token, sneaker.id, {
      name: 'Sneaker',
      slug: 'nuoc-hoa-nam',
      parentId: null,
    })

    for (const res of [duplicate, renamed]) {
      expect(res.status).toBe(409)
      expect(res.body.error.fields).toEqual([{ path: 'slug', message: expect.any(String) }])
    }
  })

  it('danh mục cha không tồn tại thì 400', async () => {
    const { request, token } = await appWithCategories()

    const res = await request.post('/api/admin/categories').set(bearer(token)).send({
      name: 'Sneaker',
      slug: 'mo-coi',
      productType: 'footwear',
      parentId: '00000000-0000-4000-8000-000000000000',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([{ path: 'parentId', message: expect.any(String) }])
  })
})

describe('ẩn và xóa', () => {
  it('ẩn danh mục thì nó và cả nhánh con biến khỏi cây và trang riêng; bỏ ẩn thì hiện lại', async () => {
    const { request, token, sneaker } = await appWithCategories()
    await createCategory(request, token, {
      name: 'Cổ thấp',
      slug: 'co-thap',
      productType: 'footwear',
      parentId: sneaker.id,
    })

    const hide = await request.post(`/api/admin/categories/${sneaker.id}/hide`).set(bearer(token))
    const tree = await request.get('/api/categories')
    const pages = await Promise.all([request.get('/api/categories/sneaker'), request.get('/api/categories/co-thap')])
    const admin = await request.get('/api/admin/categories').set(bearer(token))
    await request.post(`/api/admin/categories/${sneaker.id}/unhide`).set(bearer(token))

    expect(hide.status).toBe(200)
    expect(hide.body).toMatchObject({ slug: 'sneaker', hidden: true })
    expect(tree.body.items[0]).toEqual({ productType: 'footwear', children: [] })
    expect(pages.map((res) => res.status)).toEqual([404, 404])
    expect(admin.body.items.map((c: { slug: string }) => c.slug)).toEqual(['co-thap', 'nuoc-hoa-nam', 'sneaker'])
    expect((await request.get('/api/categories/co-thap')).status).toBe(200)
  })

  it('không xóa được danh mục còn danh mục con; danh mục lá thì xóa được', async () => {
    const { request, token, sneaker } = await appWithCategories()
    const low = await createCategory(request, token, {
      name: 'Cổ thấp',
      slug: 'co-thap',
      productType: 'footwear',
      parentId: sneaker.id,
    })

    const parent = await request.delete(`/api/admin/categories/${sneaker.id}`).set(bearer(token))
    const leaf = await request.delete(`/api/admin/categories/${low.id}`).set(bearer(token))

    expect(parent.status).toBe(409)
    expect(parent.body.error.code).toBe('CONFLICT')
    expect(leaf.status).toBe(204)
    expect((await request.get('/api/categories/co-thap')).status).toBe(404)
    expect((await request.get('/api/categories/sneaker')).body.children).toEqual([])
  })
})

describe('API công khai', () => {
  it('cây danh mục có đủ năm nhóm hàng làm gốc, danh mục con nằm dưới cha', async () => {
    const { request, token, sneaker } = await appWithCategories()
    await createCategory(request, token, {
      name: 'Sneaker cổ thấp',
      slug: 'sneaker-co-thap',
      productType: 'footwear',
      parentId: sneaker.id,
    })

    const tree = await request.get('/api/categories')

    expect(tree.status).toBe(200)
    expect(tree.body.items).toEqual([
      {
        productType: 'footwear',
        children: [
          {
            slug: 'sneaker',
            name: 'Sneaker',
            children: [{ slug: 'sneaker-co-thap', name: 'Sneaker cổ thấp', children: [] }],
          },
        ],
      },
      { productType: 'apparel', children: [] },
      { productType: 'watch', children: [] },
      { productType: 'bag', children: [] },
      { productType: 'fragrance', children: [{ slug: 'nuoc-hoa-nam', name: 'Nước hoa nam', children: [] }] },
    ])
  })

  it('trang danh mục có nhóm hàng, đường dẫn từ gốc và danh mục con', async () => {
    const { request, token, sneaker } = await appWithCategories()
    const low = await createCategory(request, token, {
      name: 'Sneaker cổ thấp',
      slug: 'sneaker-co-thap',
      productType: 'footwear',
      parentId: sneaker.id,
    })
    await createCategory(request, token, {
      name: 'Trắng',
      slug: 'sneaker-trang',
      productType: 'footwear',
      parentId: low.id,
    })

    const page = await request.get('/api/categories/sneaker-co-thap')

    expect(page.status).toBe(200)
    expect(page.body).toEqual({
      slug: 'sneaker-co-thap',
      name: 'Sneaker cổ thấp',
      productType: 'footwear',
      ancestors: [{ slug: 'sneaker', name: 'Sneaker' }],
      children: [{ slug: 'sneaker-trang', name: 'Trắng' }],
    })
    expect((await request.get('/api/categories/khong-co')).status).toBe(404)
  })
})

describe('quyền và audit', () => {
  it('thiếu catalog.edit thì không xem, tạo, sửa, ẩn hay xóa được danh mục', async () => {
    const { request, token: ownerToken, sneaker } = await appWithCategories()
    const { accessToken: token } = await createStaff(request, ownerToken, ['accountant'])

    const attempts = await Promise.all([
      request.get('/api/admin/categories').set(bearer(token)),
      request
        .post('/api/admin/categories')
        .set(bearer(token))
        .send({ name: 'Boot', slug: 'boot', productType: 'footwear' }),
      editCategory(request, token, sneaker.id, { name: 'Sửa trộm', slug: 'sneaker', parentId: null }),
      request.post(`/api/admin/categories/${sneaker.id}/hide`).set(bearer(token)),
      request.delete(`/api/admin/categories/${sneaker.id}`).set(bearer(token)),
    ])

    for (const res of attempts) {
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    }
    expect((await request.get('/api/categories/sneaker')).body.name).toBe('Sneaker')
  })

  it('tạo, sửa, ẩn, xóa đều ghi audit; thao tác không đổi gì thì không ghi', async () => {
    const { request, token, sneaker } = await appWithCategories()
    const boot = await createCategory(request, token, { name: 'Boot', slug: 'boot', productType: 'footwear' })
    await editCategory(request, token, boot.id, { name: 'Boot', slug: 'boot', parentId: sneaker.id })
    await editCategory(request, token, boot.id, { name: 'Boot', slug: 'boot', parentId: sneaker.id })
    await request.post(`/api/admin/categories/${boot.id}/hide`).set(bearer(token))
    await request.post(`/api/admin/categories/${boot.id}/hide`).set(bearer(token))
    await request.delete(`/api/admin/categories/${boot.id}`).set(bearer(token))

    const audit = await request.get('/api/admin/audit').query({ entityType: 'category' }).set(bearer(token))

    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual([
      'catalog.category.delete',
      'catalog.category.hide',
      'catalog.category.update',
      'catalog.category.create',
      'catalog.category.create',
      'catalog.category.create',
    ])
    expect(audit.body.items[2]).toMatchObject({
      entityId: boot.id,
      before: { parentId: null },
      after: { parentId: sneaker.id },
    })
    expect(audit.body.items[0]).toMatchObject({ before: { slug: 'boot', hidden: true }, after: null })
  })
})
