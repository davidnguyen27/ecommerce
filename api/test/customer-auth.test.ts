import type { Response } from 'supertest'
import { describe, expect, it } from 'vitest'
import type { InMemoryMailer } from '../src/adapters/mailer.ts'
import { CUSTOMER, appReadyForSignUp, publishPrivacyPolicy, register, tokenFromMail } from './support/customer.ts'
import { OWNER, appWithOwner, bearer, login, type Request } from './support/staff.ts'

describe('khách đăng ký', () => {
  it('đăng ký có tick đồng ý thì được đăng nhập luôn, và lưu lời đồng ý với phiên bản chính sách hiện hành', async () => {
    const { request } = await appWithOwner()
    await publishPrivacyPolicy(request, 'Bản 1')
    await publishPrivacyPolicy(request, 'Bản 2')

    const res = await register(request)

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ accessToken: expect.any(String), refreshToken: expect.any(String) })
    const me = await request.get('/api/account/me').set(bearer(res.body.accessToken))
    expect(me.status).toBe(200)
    expect(me.body).toEqual({
      id: expect.any(String),
      email: CUSTOMER.email,
      emailVerified: false,
      privacyConsent: { policyVersion: 2, consentedAt: expect.any(String) },
    })
    expect(Date.now() - Date.parse(me.body.privacyConsent.consentedAt)).toBeLessThan(60_000)
  })

  it('thiếu tick đồng ý thì bị từ chối và không tạo tài khoản', async () => {
    const { request } = await appReadyForSignUp()

    const missing = await register(request, { acceptPrivacyPolicy: undefined })
    const refused = await register(request, { acceptPrivacyPolicy: false })

    expect(missing.status).toBe(400)
    expect(missing.body.error.fields).toEqual([expect.objectContaining({ path: 'acceptPrivacyPolicy' })])
    expect(refused.status).toBe(400)
    const login = await request.post('/api/auth/login').set('X-Client', 'mobile').send(CUSTOMER)
    expect(login.status).toBe(401)
  })

  it('email đã có tài khoản (kể cả khác hoa thường) thì chỉ báo trùng, không lộ gì thêm về tài khoản đó', async () => {
    const { request } = await appReadyForSignUp()
    await register(request)

    const res = await register(request, { email: 'KHACH@example.com', password: 'mat-khau-khac-han' })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'Email này đã được đăng ký', requestId: expect.any(String) },
    })
  })

  it('email trùng với một nhân viên vẫn đăng ký được, vì khách và nhân viên là hai miền riêng', async () => {
    const { request } = await appReadyForSignUp()

    const res = await register(request, { email: OWNER.email })

    expect(res.status).toBe(201)
  })

  it('chưa có chính sách bảo mật đã xuất bản thì chưa cho đăng ký', async () => {
    const { request } = await appWithOwner()

    const res = await register(request)

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE')
  })
})

/** Chờ thư xác minh gửi tới `to` qua hàng đợi job, rồi lấy token từ link trong thư. */
function verificationToken(mailer: InMemoryMailer, to = CUSTOMER.email, nth = 0) {
  return tokenFromMail(mailer, '/xac-minh-email', to, nth)
}

function verify(request: Request, token: string) {
  return request.post('/api/auth/verify-email').send({ token })
}

describe('xác minh email', () => {
  it('sau khi đăng ký khách nhận thư có link xác minh; mở link thì tài khoản được đánh dấu đã xác minh', async () => {
    const { request, mailer } = await appReadyForSignUp()
    const { accessToken } = (await register(request)).body

    const token = await verificationToken(mailer)
    const verified = await verify(request, token)

    expect(verified.status).toBe(204)
    const me = await request.get('/api/account/me').set(bearer(accessToken))
    expect(me.body.emailVerified).toBe(true)
  })

  it('link xác minh chỉ dùng được một lần', async () => {
    const { request, mailer } = await appReadyForSignUp()
    await register(request)
    const token = await verificationToken(mailer)
    await verify(request, token)

    const again = await verify(request, token)

    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('link xác minh hết hạn hoặc sai thì bị từ chối', async () => {
    const { request, mailer, prisma } = await appReadyForSignUp()
    const { accessToken } = (await register(request)).body
    const token = await verificationToken(mailer)
    await prisma.customerToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })

    const expired = await verify(request, token)
    const wrong = await verify(request, 'khong-phai-token')

    expect(expired.status).toBe(400)
    expect(wrong.status).toBe(400)
    const me = await request.get('/api/account/me').set(bearer(accessToken))
    expect(me.body.emailVerified).toBe(false)
  })

  it('khách chưa xác minh vẫn đăng nhập và dùng tài khoản bình thường', async () => {
    const { request } = await appReadyForSignUp()
    await register(request)

    const login = await request.post('/api/auth/login').set('X-Client', 'mobile').send(CUSTOMER)
    const me = await request.get('/api/account/me').set(bearer(login.body.accessToken))

    expect(login.status).toBe(200)
    expect(me.status).toBe(200)
    expect(me.body.emailVerified).toBe(false)
  })

  it('khách xin gửi lại thư thì nhận link mới dùng được', async () => {
    const { request, mailer } = await appReadyForSignUp()
    const { accessToken } = (await register(request)).body
    await verificationToken(mailer)

    const resend = await request.post('/api/account/email-verification').set(bearer(accessToken))
    const token = await verificationToken(mailer, CUSTOMER.email, 1)

    expect(resend.status).toBe(202)
    expect((await verify(request, token)).status).toBe(204)
  })
})

const REFRESH_COOKIE = 'customer_refresh'

/** Set-Cookie của refresh token khách. */
function refreshSetCookie(res: Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = header?.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))
  if (!cookie) throw new Error('Response không đặt cookie refresh token')
  return cookie
}

/** Giá trị gửi lại trong header `Cookie`, như trình duyệt làm. */
const refreshCookie = (res: Response) => refreshSetCookie(res).split(';')[0]!

function refreshMobile(request: Request, refreshToken: string) {
  return request.post('/api/auth/refresh').set('X-Client', 'mobile').send({ refreshToken })
}

describe('khách đăng nhập, refresh và đăng xuất', () => {
  it('kênh mobile: refresh cấp cặp token mới, token cũ hết hiệu lực; đăng xuất thì refresh bị từ chối', async () => {
    const { request } = await appReadyForSignUp()
    await register(request)
    const login = await request.post('/api/auth/login').set('X-Client', 'mobile').send(CUSTOMER)
    expect(login.status).toBe(200)

    const refreshed = await refreshMobile(request, login.body.refreshToken)
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken)
    const me = await request.get('/api/account/me').set(bearer(refreshed.body.accessToken))
    expect(me.body.email).toBe(CUSTOMER.email)

    const logout = await request
      .delete('/api/auth/refresh')
      .set('X-Client', 'mobile')
      .send({ refreshToken: refreshed.body.refreshToken })
    expect(logout.status).toBe(204)
    expect((await refreshMobile(request, refreshed.body.refreshToken)).status).toBe(401)
  })

  it('dùng lại refresh token đã dùng thì cả family bị thu hồi', async () => {
    const { request } = await appReadyForSignUp()
    const { refreshToken } = (await register(request)).body
    const next = await refreshMobile(request, refreshToken)

    const reused = await refreshMobile(request, refreshToken)
    const afterReuse = await refreshMobile(request, next.body.refreshToken)

    expect(reused.status).toBe(401)
    expect(afterReuse.status).toBe(401)
  })

  it('kênh web: refresh token nằm trong cookie httpOnly chỉ gửi tới endpoint refresh của khách, sống 30 ngày', async () => {
    const { request } = await appReadyForSignUp()
    await register(request)

    const login = await request.post('/api/auth/login').set('X-Client', 'web').send(CUSTOMER)

    expect(login.body).toEqual({ accessToken: expect.any(String) })
    const attributes = refreshSetCookie(login)
      .split(';')
      .map((part) => part.trim().toLowerCase())
    expect(attributes).toEqual(
      expect.arrayContaining(['path=/api/auth/refresh', 'httponly', 'secure', 'samesite=strict']),
    )
    const expires = Date.parse(attributes.find((a) => a.startsWith('expires='))!.slice('expires='.length))
    const days = (expires - Date.now()) / (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThanOrEqual(30)

    const refreshed = await request.post('/api/auth/refresh').set('X-Client', 'web').set('Cookie', refreshCookie(login))
    expect(refreshed.status).toBe(200)
    const logout = await request
      .delete('/api/auth/refresh')
      .set('X-Client', 'web')
      .set('Cookie', refreshCookie(refreshed))
    expect(logout.status).toBe(204)
    const afterLogout = await request
      .post('/api/auth/refresh')
      .set('X-Client', 'web')
      .set('Cookie', refreshCookie(refreshed))
    expect(afterLogout.status).toBe(401)
  })

  it('sai mật khẩu và email không tồn tại trả cùng một thông báo', async () => {
    const { request } = await appReadyForSignUp()
    await register(request)

    const wrongPassword = await request
      .post('/api/auth/login')
      .set('X-Client', 'mobile')
      .send({ email: CUSTOMER.email, password: 'sai-mat-khau-roi' })
    const unknown = await request
      .post('/api/auth/login')
      .set('X-Client', 'mobile')
      .send({ email: 'ai-do@example.com', password: CUSTOMER.password })

    expect(wrongPassword.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrongPassword.body.error.message).toBe(unknown.body.error.message)
  })
})

describe('tách miền khách và nhân viên', () => {
  it('token khách không gọi được API quản trị, kể cả khi email và mật khẩu trùng với một nhân viên', async () => {
    const { request } = await appReadyForSignUp()
    const { accessToken } = (await register(request, { email: OWNER.email, password: OWNER.password })).body

    const me = await request.get('/api/admin/me').set(bearer(accessToken))
    const pages = await request.get('/api/admin/pages').set(bearer(accessToken))

    expect(me.status).toBe(401)
    expect(pages.status).toBe(401)
  })

  it('refresh token khách không đổi được lấy phiên nhân viên, và ngược lại', async () => {
    const { request } = await appReadyForSignUp()
    const customer = (await register(request, { email: OWNER.email, password: OWNER.password })).body
    const owner = await login(request, OWNER.email, OWNER.password)

    const customerAtAdmin = await request
      .post('/api/admin/auth/refresh')
      .set('X-Client', 'mobile')
      .send({ refreshToken: customer.refreshToken })
    const staffAtCustomer = await refreshMobile(request, owner.refreshToken)

    expect(customerAtAdmin.status).toBe(401)
    expect(staffAtCustomer.status).toBe(401)
  })

  it('token nhân viên không vào được tài khoản khách', async () => {
    const { request } = await appReadyForSignUp()
    const owner = await login(request, OWNER.email, OWNER.password)

    const me = await request.get('/api/account/me').set(bearer(owner.accessToken))

    expect(me.status).toBe(401)
  })
})
