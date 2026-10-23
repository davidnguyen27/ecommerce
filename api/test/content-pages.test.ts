import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

const PAGE = { slug: 'chinh-sach-doi-tra', kind: 'policy', title: 'Chính sách đổi trả', body: 'Đổi trong **7 ngày**.' }

async function createPage(request: Request, token: string, page: Record<string, unknown> = PAGE) {
  const res = await request.post('/api/admin/pages').set(bearer(token)).send(page)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

function editPage(request: Request, token: string, id: string, changes: Record<string, unknown>) {
  return request
    .put(`/api/admin/pages/${id}`)
    .set(bearer(token))
    .send({ title: PAGE.title, body: PAGE.body, ...changes })
}

function publish(request: Request, token: string, id: string) {
  return request.post(`/api/admin/pages/${id}/publish`).set(bearer(token))
}

describe('xuất bản trang nội dung', () => {
  it('mỗi lần xuất bản tạo một phiên bản mới, phiên bản cũ vẫn đọc được', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const page = await createPage(request, owner.accessToken)

    const first = await publish(request, owner.accessToken, page.id)
    await editPage(request, owner.accessToken, page.id, { body: 'Đổi trong **30 ngày**.' })
    const second = await publish(request, owner.accessToken, page.id)

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ version: 1, publishedAt: expect.any(String) })
    expect(second.body).toMatchObject({ version: 2, body: 'Đổi trong **30 ngày**.' })

    const history = await request.get(`/api/admin/pages/${page.id}/versions`).set(bearer(owner.accessToken))
    expect(history.status).toBe(200)
    expect(history.body.items.map((v: { version: number }) => v.version)).toEqual([2, 1])
    expect(history.body.items[1]).toMatchObject({ publishedBy: { name: OWNER.name } })

    const old = await request.get(`/api/admin/pages/${page.id}/versions/1`).set(bearer(owner.accessToken))
    expect(old.status).toBe(200)
    expect(old.body).toMatchObject({ version: 1, title: PAGE.title, body: 'Đổi trong **7 ngày**.' })
  })
})

describe('API công khai', () => {
  it('trang nháp không xuất hiện, kể cả khi đoán đúng slug', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    await createPage(request, owner.accessToken)

    const bySlug = await request.get(`/api/pages/${PAGE.slug}`)
    const list = await request.get('/api/pages')

    expect(bySlug.status).toBe(404)
    expect(bySlug.body.error.code).toBe('NOT_FOUND')
    expect(list.status).toBe(200)
    expect(list.body.items).toEqual([])
  })

  it('trả phiên bản đang xuất bản, không phải bản đang soạn dở', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const page = await createPage(request, owner.accessToken)
    await publish(request, owner.accessToken, page.id)
    await editPage(request, owner.accessToken, page.id, { title: 'Bản nháp chưa duyệt', body: 'Chưa duyệt' })

    const bySlug = await request.get(`/api/pages/${PAGE.slug}`)
    const list = await request.get('/api/pages')

    expect(bySlug.status).toBe(200)
    expect(bySlug.body).toMatchObject({
      slug: PAGE.slug,
      kind: 'policy',
      title: PAGE.title,
      body: PAGE.body,
      version: 1,
      versionId: expect.any(String),
    })
    expect(list.body.items).toEqual([{ slug: PAGE.slug, kind: 'policy', title: PAGE.title }])
  })

  it('chính sách bảo mật hiện hành có id phiên bản để module khác tham chiếu', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const page = await createPage(request, owner.accessToken, { ...PAGE, slug: 'chinh-sach-bao-mat', title: 'Bảo mật' })
    await publish(request, owner.accessToken, page.id)
    await editPage(request, owner.accessToken, page.id, { title: 'Bảo mật', body: 'Bản mới' })
    const second = await publish(request, owner.accessToken, page.id)

    const current = await request.get('/api/pages/chinh-sach-bao-mat')

    expect(current.body).toMatchObject({ version: 2, versionId: second.body.id })
  })
})

describe('quyền và audit', () => {
  it('thiếu content.edit thì không tạo, sửa, xuất bản hay xem được trang trong quản trị', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const page = await createPage(request, owner.accessToken)
    const warehouse = await createStaff(request, owner.accessToken, ['warehouse'])
    const token = warehouse.accessToken

    const attempts = [
      request
        .post('/api/admin/pages')
        .set(bearer(token))
        .send({ ...PAGE, slug: 'khac' }),
      editPage(request, token, page.id, { body: 'Sửa trộm' }),
      publish(request, token, page.id),
      request.get('/api/admin/pages').set(bearer(token)),
      request.get(`/api/admin/pages/${page.id}/versions`).set(bearer(token)),
    ]

    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    }
    expect((await request.get(`/api/pages/${PAGE.slug}`)).status).toBe(404)
  })

  it('nhân viên bán hàng có content.edit thì soạn và xuất bản được', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const sales = await createStaff(request, owner.accessToken, ['sales'])

    const page = await createPage(request, sales.accessToken)

    expect((await publish(request, sales.accessToken, page.id)).status).toBe(200)
  })

  it('tạo, sửa và xuất bản đều ghi audit kèm trước/sau', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const page = await createPage(request, owner.accessToken)
    await editPage(request, owner.accessToken, page.id, { body: 'Đổi trong 30 ngày.' })
    const published = await publish(request, owner.accessToken, page.id)

    const audit = await request
      .get('/api/admin/audit')
      .query({ entityType: 'content_page' })
      .set(bearer(owner.accessToken))

    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual([
      'content.page.publish',
      'content.page.update',
      'content.page.create',
    ])
    expect(audit.body.items[0]).toMatchObject({
      entityId: page.id,
      after: { version: 1, versionId: published.body.id },
    })
    expect(audit.body.items[1]).toMatchObject({
      before: { body: PAGE.body },
      after: { body: 'Đổi trong 30 ngày.' },
    })
  })

  it('lưu hay xuất bản khi không có gì thay đổi thì không ghi audit và không tạo phiên bản trùng', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const page = await createPage(request, owner.accessToken)
    await publish(request, owner.accessToken, page.id)

    const save = await editPage(request, owner.accessToken, page.id, {})
    const again = await publish(request, owner.accessToken, page.id)

    expect(save.status).toBe(200)
    expect(save.body).toMatchObject({ status: 'published', currentVersion: 1, hasUnpublishedChanges: false })
    expect(again.body.version).toBe(1)
    const audit = await request.get('/api/admin/audit').set(bearer(owner.accessToken))
    expect(audit.body.total).toBe(2)
  })
})

describe('soạn trang', () => {
  it('trang mới là nháp; sửa sau khi xuất bản thì báo có thay đổi chưa xuất bản', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const page = await createPage(request, owner.accessToken)
    const draft = await request.get(`/api/admin/pages/${page.id}`).set(bearer(owner.accessToken))
    await publish(request, owner.accessToken, page.id)

    const edited = await editPage(request, owner.accessToken, page.id, { title: 'Đổi trả hàng' })

    expect(draft.body).toMatchObject({ status: 'draft', currentVersion: null, body: PAGE.body })
    expect(edited.body).toMatchObject({ status: 'published', currentVersion: 1, hasUnpublishedChanges: true })
  })

  it('loại trang cố định từ lúc tạo: sửa chỉ đổi tiêu đề và nội dung', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const page = await createPage(request, owner.accessToken)
    await publish(request, owner.accessToken, page.id)

    const edited = await editPage(request, owner.accessToken, page.id, { kind: 'about' })

    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ kind: 'policy', hasUnpublishedChanges: false })
    expect((await request.get(`/api/pages/${PAGE.slug}`)).body.kind).toBe('policy')
  })

  it('slug trùng thì 409, slug sai định dạng thì 400', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    await createPage(request, owner.accessToken)

    const duplicate = await request.post('/api/admin/pages').set(bearer(owner.accessToken)).send(PAGE)
    const invalid = await request
      .post('/api/admin/pages')
      .set(bearer(owner.accessToken))
      .send({ ...PAGE, slug: 'Chính sách' })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.fields).toEqual([{ path: 'slug', message: expect.any(String) }])
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.fields.map((f: { path: string }) => f.path)).toEqual(['slug'])
  })
})
