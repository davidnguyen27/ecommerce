import { describe, expect, it } from 'vitest'
import type { InMemoryMailer } from '../src/adapters/mailer.ts'
import { CUSTOMER, appReadyForSignUp, customerLogin, register, tokenFromMail } from './support/customer.ts'
import { bearer, type Request } from './support/staff.ts'

const NEW_PASSWORD = 'mat-khau-moi-cua-khach'

function forgotPassword(request: Request, email: string) {
  return request.post('/api/auth/forgot-password').send({ email })
}

function resetPassword(request: Request, token: string, password = NEW_PASSWORD) {
  return request.post('/api/auth/reset-password').send({ token, password })
}

function resetToken(mailer: InMemoryMailer, nth = 0) {
  return tokenFromMail(mailer, '/dat-lai-mat-khau', CUSTOMER.email, nth)
}

describe('khách quên mật khẩu', () => {
  it('khách nhận thư có link đặt lại, đặt mật khẩu mới thì đăng nhập bằng mật khẩu mới được, mật khẩu cũ thì không', async () => {
    const { request, mailer } = await appReadyForSignUp()
    await register(request)

    const forgot = await forgotPassword(request, 'KHACH@example.com')
    const reset = await resetPassword(request, await resetToken(mailer))

    expect(forgot.status).toBe(202)
    expect(reset.status).toBe(204)
    expect((await customerLogin(request, CUSTOMER.email, NEW_PASSWORD)).status).toBe(200)
    expect((await customerLogin(request, CUSTOMER.email, CUSTOMER.password)).status).toBe(401)
  })

  it('email không có tài khoản nhận cùng phản hồi, và không có thư nào được gửi', async () => {
    const { request, mailer } = await appReadyForSignUp()
    await register(request)

    const known = await forgotPassword(request, CUSTOMER.email)
    const unknown = await forgotPassword(request, 'ai-do@example.com')

    expect(unknown.status).toBe(known.status)
    expect(unknown.body).toEqual(known.body)
    await resetToken(mailer)
    expect(mailer.sent.filter((m) => m.to === 'ai-do@example.com')).toEqual([])
  })

  it('link đặt lại chỉ dùng được một lần', async () => {
    const { request, mailer } = await appReadyForSignUp()
    await register(request)
    await forgotPassword(request, CUSTOMER.email)
    const token = await resetToken(mailer)
    await resetPassword(request, token)

    const again = await resetPassword(request, token, 'mat-khau-cua-ke-gian')

    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('VALIDATION_ERROR')
    expect((await customerLogin(request, CUSTOMER.email, NEW_PASSWORD)).status).toBe(200)
  })

  it('link đặt lại hết hạn, sai, hoặc là link xác minh email thì bị từ chối', async () => {
    const { request, mailer, prisma } = await appReadyForSignUp()
    await register(request)
    const verification = await tokenFromMail(mailer, '/xac-minh-email')
    await forgotPassword(request, CUSTOMER.email)
    const token = await resetToken(mailer)
    await prisma.customerToken.updateMany({ where: { purpose: 'password_reset' }, data: { expiresAt: new Date(0) } })

    const expired = await resetPassword(request, token)
    const wrong = await resetPassword(request, 'khong-phai-token')
    const otherPurpose = await resetPassword(request, verification)

    expect([expired.status, wrong.status, otherPurpose.status]).toEqual([400, 400, 400])
    expect((await customerLogin(request, CUSTOMER.email, CUSTOMER.password)).status).toBe(200)
  })

  it('đặt lại mật khẩu thì mọi refresh token cũ của khách bị từ chối, và link đặt lại cũ hơn cũng hết hiệu lực', async () => {
    const { request, mailer } = await appReadyForSignUp()
    const phone = (await register(request)).body
    const laptop = (await customerLogin(request, CUSTOMER.email, CUSTOMER.password)).body
    await forgotPassword(request, CUSTOMER.email)
    await forgotPassword(request, CUSTOMER.email)
    const older = await resetToken(mailer, 0)
    const newer = await resetToken(mailer, 1)

    expect((await resetPassword(request, newer)).status).toBe(204)

    for (const { refreshToken } of [phone, laptop]) {
      const refreshed = await request.post('/api/auth/refresh').set('X-Client', 'mobile').send({ refreshToken })
      expect(refreshed.status).toBe(401)
    }
    expect((await resetPassword(request, older, 'mat-khau-khac-nua')).status).toBe(400)
  })
})

function changePassword(request: Request, accessToken: string, currentPassword: string) {
  return request
    .post('/api/account/password')
    .set(bearer(accessToken))
    .set('X-Client', 'mobile')
    .send({ currentPassword, newPassword: NEW_PASSWORD })
}

function refreshMobile(request: Request, refreshToken: string) {
  return request.post('/api/auth/refresh').set('X-Client', 'mobile').send({ refreshToken })
}

describe('khách đổi mật khẩu trong trang tài khoản', () => {
  it('đổi mật khẩu thì thiết bị khác bị đăng xuất, thiết bị đang dùng nhận phiên mới', async () => {
    const { request } = await appReadyForSignUp()
    const other = (await register(request)).body
    const current = (await customerLogin(request, CUSTOMER.email, CUSTOMER.password)).body

    const changed = await changePassword(request, current.accessToken, CUSTOMER.password)

    expect(changed.status).toBe(200)
    expect(changed.body).toEqual({ accessToken: expect.any(String), refreshToken: expect.any(String) })
    expect((await refreshMobile(request, other.refreshToken)).status).toBe(401)
    expect((await refreshMobile(request, current.refreshToken)).status).toBe(401)
    expect((await refreshMobile(request, changed.body.refreshToken)).status).toBe(200)
    expect((await customerLogin(request, CUSTOMER.email, NEW_PASSWORD)).status).toBe(200)
  })

  it('sai mật khẩu hiện tại thì không đổi gì và phiên vẫn còn', async () => {
    const { request } = await appReadyForSignUp()
    const session = (await register(request)).body

    const res = await changePassword(request, session.accessToken, 'khong-phai-mat-khau')

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([expect.objectContaining({ path: 'currentPassword' })])
    expect((await refreshMobile(request, session.refreshToken)).status).toBe(200)
    expect((await customerLogin(request, CUSTOMER.email, CUSTOMER.password)).status).toBe(200)
  })

  it('chưa đăng nhập thì không đổi được mật khẩu', async () => {
    const { request } = await appReadyForSignUp()

    const res = await request
      .post('/api/account/password')
      .set('X-Client', 'mobile')
      .send({ currentPassword: CUSTOMER.password, newPassword: NEW_PASSWORD })

    expect(res.status).toBe(401)
  })
})
