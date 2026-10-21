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
    expect(me.body.permissions.sort()).toEqual(['catalog.edit', 'document.view', 'media.upload'])
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
