import type { Response } from 'supertest'
import { describe, expect, it } from 'vitest'
import { CUSTOMER, appReadyForSignUp, register } from './support/customer.ts'
import { OWNER, appWithOwner, bearer, type Request } from './support/staff.ts'

const LOGIN_PER_EMAIL = 10
const LOGIN_PER_IP = 50
const FORGOT_PER_EMAIL = 3
const FORGOT_PER_IP = 20
const RESEND_PER_CUSTOMER = 3

type Audience = 'customer' | 'staff'
const LOGIN_PATH: Record<Audience, string> = { customer: '/api/auth/login', staff: '/api/admin/auth/login' }

function loginFrom(request: Request, audience: Audience, ip: string, email: string, password: string) {
  return request
    .post(LOGIN_PATH[audience])
    .set('X-Client', 'mobile')
    .set('X-Forwarded-For', ip)
    .send({ email, password })
}

function forgotFrom(request: Request, ip: string, email: string) {
  return request.post('/api/auth/forgot-password').set('X-Forwarded-For', ip).send({ email })
}

function expectRateLimited(res: Response) {
  expect(res.status).toBe(429)
  expect(res.body.error.code).toBe('RATE_LIMITED')
  const retryAfter = Number(res.headers['retry-after'])
  expect(retryAfter).toBeGreaterThan(0)
  expect(retryAfter).toBeLessThanOrEqual(60 * 60)
}

describe('giới hạn tần suất đăng nhập', () => {
  it.each([
    ['khách', 'customer', CUSTOMER],
    ['nhân viên', 'staff', OWNER],
  ] as const)(
    'đăng nhập của %s: quá số lần thử cho một email thì 429, kể cả đúng mật khẩu và đổi IP; email khác vẫn thử được',
    async (_label, audience, account) => {
      // Dựng chính sách bảo mật cũng đăng nhập owner một lần, nên app cho nhân viên chỉ có owner.
      const { request } = audience === 'customer' ? await appReadyForSignUp() : await appWithOwner()
      if (audience === 'customer') await register(request)
      for (let i = 0; i < LOGIN_PER_EMAIL; i++) {
        const res = await loginFrom(request, audience, '203.0.113.1', account.email, 'doan-mat-khau')
        expect(res.status).toBe(401)
      }

      const blocked = await loginFrom(request, audience, '203.0.113.2', account.email.toUpperCase(), account.password)
      const otherEmail = await loginFrom(request, audience, '203.0.113.1', 'nguoi-khac@example.com', 'doan-mat-khau')

      expectRateLimited(blocked)
      expect(otherEmail.status).toBe(401)
    },
  )

  it('quá số lần thử từ một IP thì 429 với mọi email; IP khác vẫn đăng nhập được', async () => {
    const { request } = await appReadyForSignUp()
    await register(request)
    for (let i = 0; i < LOGIN_PER_IP; i++) {
      const res = await loginFrom(request, 'customer', '203.0.113.9', `do-${i}@example.com`, 'doan-mat-khau')
      expect(res.status).toBe(401)
    }

    const blocked = await loginFrom(request, 'customer', '203.0.113.9', CUSTOMER.email, CUSTOMER.password)
    const otherIp = await loginFrom(request, 'customer', '203.0.113.10', CUSTOMER.email, CUSTOMER.password)

    expectRateLimited(blocked)
    expect(otherIp.status).toBe(200)
  })

  it('giới hạn của khách và của nhân viên tính riêng', async () => {
    const { request } = await appWithOwner()
    for (let i = 0; i < LOGIN_PER_EMAIL; i++) {
      await loginFrom(request, 'customer', '203.0.113.1', OWNER.email, 'doan-mat-khau')
    }

    const staff = await loginFrom(request, 'staff', '203.0.113.1', OWNER.email, OWNER.password)

    expect(staff.status).toBe(200)
  })
})

describe('giới hạn tần suất quên mật khẩu', () => {
  it('quá số lần yêu cầu cho một email thì 429, dù email đó có tài khoản hay không', async () => {
    const { request } = await appReadyForSignUp()
    await register(request)
    for (const email of [CUSTOMER.email, 'ai-do@example.com']) {
      for (let i = 0; i < FORGOT_PER_EMAIL; i++) {
        expect((await forgotFrom(request, `203.0.113.${i + 1}`, email)).status).toBe(202)
      }
      expectRateLimited(await forgotFrom(request, '203.0.113.50', email))
    }
  })

  it('quá số lần yêu cầu từ một IP thì 429', async () => {
    const { request } = await appReadyForSignUp()
    for (let i = 0; i < FORGOT_PER_IP; i++) {
      expect((await forgotFrom(request, '203.0.113.7', `do-${i}@example.com`)).status).toBe(202)
    }

    expectRateLimited(await forgotFrom(request, '203.0.113.7', CUSTOMER.email))
    expect((await forgotFrom(request, '203.0.113.8', CUSTOMER.email)).status).toBe(202)
  })
})

describe('giới hạn tần suất gửi lại thư xác minh', () => {
  it('khách xin gửi lại quá số lần cho phép thì 429', async () => {
    const { request } = await appReadyForSignUp()
    const { accessToken } = (await register(request)).body
    const resend = () => request.post('/api/account/email-verification').set(bearer(accessToken))
    for (let i = 0; i < RESEND_PER_CUSTOMER; i++) expect((await resend()).status).toBe(202)

    expectRateLimited(await resend())
  })
})
