import { SignJWT, decodeJwt } from 'jose'
import type { Response } from 'supertest'
import { describe, expect, it } from 'vitest'
import { seedOwner } from '../src/auth/staff.ts'
import { createTestApp } from './support/test-app.ts'

const OWNER = { email: 'chu@example.com', password: 'mat-khau-dai-du-manh', name: 'Chủ Cửa Hàng' }
const REFRESH_COOKIE = 'staff_refresh'

async function appWithOwner() {
  const app = await createTestApp()
  await seedOwner(app.prisma, OWNER)
  return app
}

type Request = Awaited<ReturnType<typeof createTestApp>>['request']

function loginWeb(request: Request, credentials: Partial<typeof OWNER> = {}) {
  return request
    .post('/api/admin/auth/login')
    .set('X-Client', 'web')
    .send({ email: OWNER.email, password: OWNER.password, ...credentials })
}

function loginMobile(request: Request) {
  return request
    .post('/api/admin/auth/login')
    .set('X-Client', 'mobile')
    .send({ email: OWNER.email, password: OWNER.password })
}

function refreshWeb(request: Request, cookie: string) {
  return request.post('/api/admin/auth/refresh').set('X-Client', 'web').set('Cookie', cookie)
}

function refreshMobile(request: Request, refreshToken: string) {
  return request.post('/api/admin/auth/refresh').set('X-Client', 'mobile').send({ refreshToken })
}

/** Set-Cookie của refresh token, ví dụ `staff_refresh=abc; Path=...; HttpOnly`. */
function refreshSetCookie(res: Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined
  return header?.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))
}

/** Giá trị gửi lại trong header `Cookie`, như trình duyệt làm. */
function refreshCookie(res: Response): string {
  const cookie = refreshSetCookie(res)
  if (!cookie) throw new Error('Response không đặt cookie refresh token')
  return cookie.split(';')[0]!
}

describe('nhân viên đăng nhập', () => {
  it('kênh web: nhận access token trong body, refresh token trong cookie, rồi vào được trang quản trị', async () => {
    const { request } = await appWithOwner()

    const login = await loginWeb(request)

    expect(login.status).toBe(200)
    expect(login.body).toEqual({ accessToken: expect.any(String) })

    const me = await request.get('/api/admin/me').set('Authorization', `Bearer ${login.body.accessToken}`)

    expect(me.status).toBe(200)
    expect(me.body).toEqual({ id: expect.any(String), email: OWNER.email, name: OWNER.name })
  })

  it('kênh web: cookie refresh là httpOnly, Secure, SameSite=Strict, chỉ gửi tới endpoint refresh', async () => {
    const { request } = await appWithOwner()

    const login = await loginWeb(request)

    const attributes = refreshSetCookie(login)!.split(';').slice(1).map((part) => part.trim().toLowerCase())
    expect(attributes).toEqual(
      expect.arrayContaining(['path=/api/admin/auth/refresh', 'httponly', 'secure', 'samesite=strict']),
    )
  })
})

describe('refresh token', () => {
  it('kênh web: refresh bằng cookie cấp access token và cookie mới, cookie cũ hết hiệu lực', async () => {
    const { request } = await appWithOwner()
    const login = await loginWeb(request)

    const refreshed = await refreshWeb(request, refreshCookie(login))

    expect(refreshed.status).toBe(200)
    expect(refreshed.body).toEqual({ accessToken: expect.any(String) })
    expect(refreshCookie(refreshed)).not.toBe(refreshCookie(login))
    const me = await request.get('/api/admin/me').set('Authorization', `Bearer ${refreshed.body.accessToken}`)
    expect(me.status).toBe(200)

    const again = await refreshWeb(request, refreshCookie(login))

    expect(again.status).toBe(401)
    expect(again.body.error.code).toBe('UNAUTHORIZED')
  })

  it('kênh mobile: đăng nhập và refresh gửi refresh token qua body, không dùng cookie', async () => {
    const { request } = await appWithOwner()

    const login = await loginMobile(request)

    expect(login.status).toBe(200)
    expect(login.body).toEqual({ accessToken: expect.any(String), refreshToken: expect.any(String) })
    expect(refreshSetCookie(login)).toBeUndefined()

    const refreshed = await refreshMobile(request, login.body.refreshToken)

    expect(refreshed.status).toBe(200)
    expect(refreshed.body).toEqual({ accessToken: expect.any(String), refreshToken: expect.any(String) })
    expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken)
    expect(refreshSetCookie(refreshed)).toBeUndefined()

    expect((await refreshMobile(request, login.body.refreshToken)).status).toBe(401)
  })
})

describe('dùng lại refresh token đã dùng', () => {
  it('thu hồi cả family: token mới nhất của phiên đó cũng bị từ chối', async () => {
    const { request } = await appWithOwner()
    const login = await loginMobile(request)
    const first = await refreshMobile(request, login.body.refreshToken)
    const second = await refreshMobile(request, first.body.refreshToken)
    expect(second.status).toBe(200)

    const reuse = await refreshMobile(request, login.body.refreshToken)

    expect(reuse.status).toBe(401)
    expect((await refreshMobile(request, second.body.refreshToken)).status).toBe(401)
  })

  it('không ảnh hưởng phiên đăng nhập khác của cùng nhân viên', async () => {
    const { request } = await appWithOwner()
    const stolen = await loginMobile(request)
    const other = await loginMobile(request)
    await refreshMobile(request, stolen.body.refreshToken)

    await refreshMobile(request, stolen.body.refreshToken)

    expect((await refreshMobile(request, other.body.refreshToken)).status).toBe(200)
  })
})

describe('đăng xuất', () => {
  it('kênh web: thu hồi refresh token trong cookie và xóa cookie', async () => {
    const { request } = await appWithOwner()
    const login = await loginWeb(request)

    const logout = await request
      .delete('/api/admin/auth/refresh')
      .set('X-Client', 'web')
      .set('Cookie', refreshCookie(login))

    expect(logout.status).toBe(204)
    expect(refreshSetCookie(logout)).toMatch(new RegExp(`^${REFRESH_COOKIE}=;`))
    expect((await refreshWeb(request, refreshCookie(login))).status).toBe(401)
  })

  it('kênh mobile: thu hồi refresh token gửi trong body', async () => {
    const { request } = await appWithOwner()
    const login = await loginMobile(request)

    const logout = await request
      .delete('/api/admin/auth/refresh')
      .set('X-Client', 'mobile')
      .send({ refreshToken: login.body.refreshToken })

    expect(logout.status).toBe(204)
    expect((await refreshMobile(request, login.body.refreshToken)).status).toBe(401)
  })
})

describe('đăng nhập thất bại', () => {
  it('sai email và sai mật khẩu trả cùng một lỗi', async () => {
    const { request } = await appWithOwner()

    const wrongEmail = await loginWeb(request, { email: 'khong-co@example.com' })
    const wrongPassword = await loginWeb(request, { password: 'sai-mat-khau' })

    expect(wrongEmail.status).toBe(401)
    expect(wrongPassword.status).toBe(401)
    expect(wrongEmail.body.error.code).toBe('UNAUTHORIZED')
    expect(wrongEmail.body.error.message).toBe(wrongPassword.body.error.message)
    expect(refreshSetCookie(wrongPassword)).toBeUndefined()
  })

  it('email không phân biệt hoa thường', async () => {
    const { request } = await appWithOwner()

    const login = await loginWeb(request, { email: 'Chu@Example.COM' })

    expect(login.status).toBe(200)
  })

  it('sai X-Client trả 400 kèm lỗi theo trường', async () => {
    const { request } = await appWithOwner()

    const res = await request
      .post('/api/admin/auth/login')
      .set('X-Client', 'desktop')
      .send({ email: OWNER.email, password: OWNER.password })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.map((f: { path: string }) => f.path)).toEqual(['x-client'])
  })
})

describe('middleware của /api/admin/*', () => {
  async function ownerId(request: Request) {
    const login = await loginWeb(request)
    const me = await request.get('/api/admin/me').set('Authorization', `Bearer ${login.body.accessToken}`)
    return me.body.id as string
  }

  it('không có access token thì 401', async () => {
    const { request } = await appWithOwner()

    const res = await request.get('/api/admin/me')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('token audience khác staff thì 401, dù ký đúng khóa và đúng id', async () => {
    const { request, jwtSecret } = await appWithOwner()
    const token = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(await ownerId(request))
      .setAudience('customer')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(jwtSecret))

    const res = await request.get('/api/admin/me').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
  })

  it('token đã hết hạn thì 401', async () => {
    const { request, jwtSecret } = await appWithOwner()
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(await ownerId(request))
      .setAudience('staff')
      .setIssuedAt(now - 16 * 60)
      .setExpirationTime(now - 60)
      .sign(new TextEncoder().encode(jwtSecret))

    const res = await request.get('/api/admin/me').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
  })

  it('refresh token không dùng thay access token được', async () => {
    const { request } = await appWithOwner()
    const login = await loginMobile(request)

    const res = await request.get('/api/admin/me').set('Authorization', `Bearer ${login.body.refreshToken}`)

    expect(res.status).toBe(401)
  })

  it('access token sống 15 phút, audience staff, không chứa permission', async () => {
    const { request } = await appWithOwner()
    const login = await loginWeb(request)

    const claims = decodeJwt(login.body.accessToken)

    expect(claims.exp! - claims.iat!).toBe(15 * 60)
    expect(claims.aud).toBe('staff')
    expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'sub'])
  })
})
