import { describe, expect, it } from 'vitest'
import { OWNER, STAFF_PASSWORD, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

function readAudit(request: Request, token: string, query: Record<string, string | number> = {}) {
  return request.get('/api/admin/audit').query(query).set(bearer(token))
}

describe('ghi audit khi thao tác trên nhân viên', () => {
  it('tạo, đổi role và khóa đều được ghi kèm người làm, trước/sau, IP, user agent và thời điểm', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['warehouse'])
    await request
      .put(`/api/admin/staff/${staff.id}/roles`)
      .set(bearer(owner.accessToken))
      .set('User-Agent', 'trinh-duyet-test')
      .send({ roles: ['sales'] })
    await request.post(`/api/admin/staff/${staff.id}/lock`).set(bearer(owner.accessToken))

    const res = await readAudit(request, owner.accessToken)

    expect(res.status).toBe(200)
    expect(res.body.items.map((e: { action: string }) => e.action)).toEqual([
      'staff.lock',
      'staff.roles.change',
      'staff.create',
    ])
    const roleChange = res.body.items[1]
    expect(roleChange).toMatchObject({
      actor: { name: OWNER.name, email: OWNER.email },
      entityType: 'staff',
      entityId: staff.id,
      before: { roles: ['warehouse'] },
      after: { roles: ['sales'] },
      ip: expect.any(String),
      userAgent: 'trinh-duyet-test',
      createdAt: expect.any(String),
    })
  })

  it('thao tác không làm thay đổi gì thì không ghi audit và không thu hồi phiên', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['sales', 'warehouse'])

    const same = await request
      .put(`/api/admin/staff/${staff.id}/roles`)
      .set(bearer(owner.accessToken))
      .send({ roles: ['warehouse', 'sales'] })
    const unlock = await request.post(`/api/admin/staff/${staff.id}/unlock`).set(bearer(owner.accessToken))

    expect(same.status).toBe(200)
    expect(unlock.status).toBe(200)
    expect((await readAudit(request, owner.accessToken)).body.total).toBe(1)
    const refreshed = await request
      .post('/api/admin/auth/refresh')
      .set('X-Client', 'mobile')
      .send({ refreshToken: staff.refreshToken })
    expect(refreshed.status).toBe(200)
  })

  it('dữ liệu audit không chứa mật khẩu hay hash mật khẩu', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    await createStaff(request, owner.accessToken, ['sales'])

    const res = await readAudit(request, owner.accessToken)

    expect(JSON.stringify(res.body)).not.toMatch(/password|argon2/i)
  })
})

describe('rollback', () => {
  it('thao tác bị từ chối sau khi đã ghi thay đổi thì không để lại thay đổi lẫn bản ghi audit', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const me = await request.get('/api/admin/me').set(bearer(owner.accessToken))

    const demote = await request
      .put(`/api/admin/staff/${me.body.id}/roles`)
      .set(bearer(owner.accessToken))
      .send({ roles: ['sales'] })
    const lock = await request.post(`/api/admin/staff/${me.body.id}/lock`).set(bearer(owner.accessToken))

    expect(demote.status).toBe(409)
    expect(lock.status).toBe(409)
    expect(demote.body.error.code).toBe('CONFLICT')
    const after = await request.get('/api/admin/me').set(bearer(owner.accessToken))
    expect(after.body.roles).toEqual(['owner'])
    expect((await readAudit(request, owner.accessToken)).body.items).toEqual([])
  })

  it('tạo nhân viên trùng email bị từ chối và không để lại bản ghi audit', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    await createStaff(request, owner.accessToken, ['sales'])

    const duplicate = await request
      .post('/api/admin/staff')
      .set(bearer(owner.accessToken))
      .send({ email: 'NV@example.com', name: 'Người Khác', password: STAFF_PASSWORD, roles: ['warehouse'] })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('CONFLICT')
    const audit = await readAudit(request, owner.accessToken)
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(['staff.create'])
  })

  it('vẫn gỡ được role owner khi còn owner khác đang hoạt động', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const second = await createStaff(request, owner.accessToken, ['owner'])

    const demote = await request
      .put(`/api/admin/staff/${second.id}/roles`)
      .set(bearer(owner.accessToken))
      .send({ roles: ['sales'] })

    expect(demote.status).toBe(200)
  })
})

describe('đọc audit log', () => {
  it('cần permission audit.view', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const warehouse = await createStaff(request, owner.accessToken, ['warehouse'], 'kho@example.com')
    const accountant = await createStaff(request, owner.accessToken, ['accountant'], 'ketoan@example.com')

    expect((await readAudit(request, warehouse.accessToken)).status).toBe(403)
    expect((await readAudit(request, accountant.accessToken)).status).toBe(200)
  })

  it('lọc theo người thực hiện và loại đối tượng', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const manager = await createStaff(request, owner.accessToken, ['owner'], 'quanly@example.com')
    await createStaff(request, manager.accessToken, ['sales'], 'banhang@example.com')

    const byManager = await readAudit(request, owner.accessToken, { actorId: manager.id })
    const byOtherType = await readAudit(request, owner.accessToken, { entityType: 'product' })

    expect(byManager.body.items).toHaveLength(1)
    expect(byManager.body.items[0].after.email).toBe('banhang@example.com')
    expect(byOtherType.body.items).toEqual([])
    expect((await readAudit(request, owner.accessToken, { entityType: 'staff' })).body.total).toBe(2)
  })

  it('lọc theo khoảng thời gian', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    await createStaff(request, owner.accessToken, ['sales'])
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const now = await readAudit(request, owner.accessToken, { from: hourAgo, to: inAnHour })
    const future = await readAudit(request, owner.accessToken, { from: inAnHour })
    const past = await readAudit(request, owner.accessToken, { to: hourAgo })

    expect(now.body.total).toBe(1)
    expect(future.body.total).toBe(0)
    expect(past.body.total).toBe(0)
  })

  it('phân trang, mới nhất trước', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    for (const name of ['a', 'b', 'c']) {
      await createStaff(request, owner.accessToken, ['sales'], `${name}@example.com`)
    }

    const first = await readAudit(request, owner.accessToken, { pageSize: 2 })
    const second = await readAudit(request, owner.accessToken, { pageSize: 2, page: 2 })

    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 2 })
    expect(first.body.items.map((e: { after: { email: string } }) => e.after.email)).toEqual([
      'c@example.com',
      'b@example.com',
    ])
    expect(second.body.items.map((e: { after: { email: string } }) => e.after.email)).toEqual(['a@example.com'])
  })

  it('liệt kê những người đã có thao tác, để chọn khi lọc', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const accountant = await createStaff(request, owner.accessToken, ['accountant'], 'ketoan@example.com')

    const res = await request.get('/api/admin/audit/actors').set(bearer(accountant.accessToken))

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([{ id: expect.any(String), name: OWNER.name, email: OWNER.email }])
  })

  it('tham số lọc sai trả 400 kèm lỗi theo trường', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)

    const res = await readAudit(request, owner.accessToken, { actorId: 'khong-phai-uuid', pageSize: 1000 })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual(['actorId', 'pageSize'])
  })
})

describe('audit log không sửa hay xóa được', () => {
  it('không có endpoint sửa hay xóa, kể cả với owner', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    await createStaff(request, owner.accessToken, ['sales'])
    const [entry] = (await readAudit(request, owner.accessToken)).body.items

    for (const method of ['put', 'patch', 'delete'] as const) {
      const res = await request[method](`/api/admin/audit/${entry.id}`).set(bearer(owner.accessToken)).send({})
      expect(res.status).toBe(404)
    }
    expect((await request.delete('/api/admin/audit').set(bearer(owner.accessToken))).status).toBe(404)
    expect((await readAudit(request, owner.accessToken)).body.items).toEqual([entry])
  })
})
