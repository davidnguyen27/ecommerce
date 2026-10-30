import { describe, expect, it } from 'vitest'
import { OWNER, STAFF_PASSWORD, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

function refresh(request: Request, refreshToken: string) {
  return request.post('/api/admin/auth/refresh').set('X-Client', 'mobile').send({ refreshToken })
}

describe('phân quyền', () => {
  it('thiếu permission thì 403 với mã lỗi thống nhất', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const warehouse = await createStaff(request, owner.accessToken, ['warehouse'])

    const res = await request.get('/api/admin/staff').set(bearer(warehouse.accessToken))

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('/me trả role và permission tính từ role, để menu chỉ hiện mục được phép', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const warehouse = await createStaff(request, owner.accessToken, ['warehouse'])

    const me = await request.get('/api/admin/me').set(bearer(warehouse.accessToken))

    expect(me.body.roles).toEqual(['warehouse'])
    expect(me.body.permissions.sort()).toEqual(['catalog.edit', 'document.view', 'media.upload', 'stock.adjust'])
  })
})

describe('đổi role', () => {
  it('có hiệu lực ngay ở request kế tiếp với access token cũ còn hạn', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['warehouse'])
    expect((await request.get('/api/admin/staff').set(bearer(staff.accessToken))).status).toBe(403)

    const change = await request
      .put(`/api/admin/staff/${staff.id}/roles`)
      .set(bearer(owner.accessToken))
      .send({ roles: ['sales', 'owner'] })

    expect(change.status).toBe(200)
    expect(change.body.roles.sort()).toEqual(['owner', 'sales'])
    expect((await request.get('/api/admin/staff').set(bearer(staff.accessToken))).status).toBe(200)
  })

  it('thu hồi mọi refresh token của người đó', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['warehouse'])

    await request
      .put(`/api/admin/staff/${staff.id}/roles`)
      .set(bearer(owner.accessToken))
      .send({ roles: ['sales'] })

    expect((await refresh(request, staff.refreshToken)).status).toBe(401)
  })
})

describe('khóa tài khoản', () => {
  it('khóa thì refresh, đăng nhập và cả access token còn hạn đều bị từ chối', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['sales'])

    const lock = await request.post(`/api/admin/staff/${staff.id}/lock`).set(bearer(owner.accessToken))

    expect(lock.status).toBe(200)
    expect(lock.body.locked).toBe(true)
    expect((await refresh(request, staff.refreshToken)).status).toBe(401)
    expect((await request.get('/api/admin/me').set(bearer(staff.accessToken))).status).toBe(401)
    const relogin = await request
      .post('/api/admin/auth/login')
      .set('X-Client', 'mobile')
      .send({ email: 'nv@example.com', password: STAFF_PASSWORD })
    expect(relogin.status).toBe(401)
  })

  it('mở khóa thì đăng nhập lại được', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['sales'])
    await request.post(`/api/admin/staff/${staff.id}/lock`).set(bearer(owner.accessToken))

    const unlock = await request.post(`/api/admin/staff/${staff.id}/unlock`).set(bearer(owner.accessToken))

    expect(unlock.status).toBe(200)
    expect(unlock.body.locked).toBe(false)
    await login(request, 'nv@example.com', STAFF_PASSWORD)
  })
})

describe('sửa tên, email nhân viên', () => {
  function edit(request: Request, token: string, id: string, body: { name: string; email: string }) {
    return request.put(`/api/admin/staff/${id}`).set(bearer(token)).send(body)
  }

  function readAudit(request: Request, token: string) {
    return request.get('/api/admin/audit').set(bearer(token))
  }

  it('sửa thành công thì trả nhân viên mới và ghi audit staff.update có trước/sau', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['sales'])

    const res = await edit(request, owner.accessToken, staff.id, { name: 'Tên Mới', email: 'nv@example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: staff.id, name: 'Tên Mới', email: 'nv@example.com' })
    const audit = await readAudit(request, owner.accessToken)
    expect(audit.body.items[0]).toMatchObject({
      action: 'staff.update',
      entityId: staff.id,
      before: { name: 'Nhân Viên', email: 'nv@example.com' },
      after: { name: 'Tên Mới', email: 'nv@example.com' },
    })
  })

  it('email trùng nhân viên khác thì 409 kèm lỗi trường email và không để lại audit', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['sales'])
    const auditBefore = (await readAudit(request, owner.accessToken)).body.total

    const res = await edit(request, owner.accessToken, staff.id, { name: 'Tên Mới', email: 'CHU@Example.com' })

    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([expect.objectContaining({ path: 'email' })])
    expect((await readAudit(request, owner.accessToken)).body.total).toBe(auditBefore)
  })

  it('đổi email thì email được chuẩn hóa, refresh token cũ bị từ chối và đăng nhập bằng email mới', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['sales'])

    const res = await edit(request, owner.accessToken, staff.id, { name: 'Nhân Viên', email: 'Moi@Example.COM' })

    expect(res.body.email).toBe('moi@example.com')
    expect((await refresh(request, staff.refreshToken)).status).toBe(401)
    await login(request, 'moi@example.com', STAFF_PASSWORD)
  })

  it('chỉ đổi tên thì giữ phiên; gửi lại y nguyên thì không ghi audit', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['sales'])

    await edit(request, owner.accessToken, staff.id, { name: 'Tên Mới', email: 'nv@example.com' })
    const auditAfterRename = (await readAudit(request, owner.accessToken)).body.total
    const same = await edit(request, owner.accessToken, staff.id, { name: ' Tên Mới ', email: 'NV@example.com' })

    expect(same.status).toBe(200)
    expect((await readAudit(request, owner.accessToken)).body.total).toBe(auditAfterRename)
    expect((await refresh(request, staff.refreshToken)).status).toBe(200)
  })

  it('thiếu staff.manage thì 403', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['accountant'])

    const res = await edit(request, staff.accessToken, staff.id, { name: 'Tự Sửa', email: 'nv@example.com' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('không có endpoint xóa nhân viên', async () => {
    const { request } = await appWithOwner()
    const owner = await login(request, OWNER.email, OWNER.password)
    const staff = await createStaff(request, owner.accessToken, ['sales'])

    const res = await request.delete(`/api/admin/staff/${staff.id}`).set(bearer(owner.accessToken))

    expect(res.status).toBe(404)
    expect((await request.get('/api/admin/staff').set(bearer(owner.accessToken))).body.items).toHaveLength(2)
  })
})
