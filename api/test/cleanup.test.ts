import { describe, expect, it } from 'vitest'
import { deleteExpiredRecords } from '../src/jobs/cleanup.ts'
import { CUSTOMER, appReadyForSignUp, register, tokenFromMail } from './support/customer.ts'
import { OWNER, login } from './support/staff.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// Job dọn không có endpoint; test gọi thẳng hàm job chạy, rồi kiểm hệ quả qua HTTP.
describe('dọn token và bộ đếm hết hạn', () => {
  it('token và bộ đếm còn hạn thì giữ nguyên: refresh và xác minh email vẫn dùng được', async () => {
    const { request, prisma, mailer } = await appReadyForSignUp()
    const owner = await login(request, OWNER.email, OWNER.password)
    expect((await register(request)).status).toBe(201)
    const verifyToken = await tokenFromMail(mailer, '/xac-minh-email')

    await deleteExpiredRecords(prisma)

    const refreshed = await request
      .post('/api/admin/auth/refresh')
      .set('X-Client', 'mobile')
      .send({ refreshToken: owner.refreshToken })
    expect(refreshed.status).toBe(200)
    expect((await request.post('/api/auth/verify-email').send({ token: verifyToken })).status).toBe(204)
  })

  it('token đã hết hạn thì bị xóa, dùng lại vẫn bị từ chối như trước', async () => {
    const { request, prisma, mailer } = await appReadyForSignUp()
    const owner = await login(request, OWNER.email, OWNER.password)
    expect((await register(request)).status).toBe(201)
    const verifyToken = await tokenFromMail(mailer, '/xac-minh-email')

    const deleted = await deleteExpiredRecords(prisma, new Date(Date.now() + 365 * DAY))
    expect(deleted.refreshTokens).toBeGreaterThan(0)
    expect(deleted.customerTokens).toBeGreaterThan(0)

    const refreshed = await request
      .post('/api/admin/auth/refresh')
      .set('X-Client', 'mobile')
      .send({ refreshToken: owner.refreshToken })
    expect(refreshed.status).toBe(401)
    expect((await request.post('/api/auth/verify-email').send({ token: verifyToken })).status).toBe(400)
  })

  it('bộ đếm đã qua cửa sổ dài nhất thì bị xóa, nên lần thử mới không còn bị chặn', async () => {
    const { request, prisma } = await appReadyForSignUp()
    const tryLogin = () =>
      request.post('/api/auth/login').set('X-Client', 'mobile').send({ email: CUSTOMER.email, password: 'sai' })
    for (let i = 0; i < 10; i++) await tryLogin()
    expect((await tryLogin()).status).toBe(429)

    await deleteExpiredRecords(prisma, new Date(Date.now() + 2 * HOUR))

    expect((await tryLogin()).status).toBe(401)
  })
})
