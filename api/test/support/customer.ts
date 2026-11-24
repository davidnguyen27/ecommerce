import { PRIVACY_POLICY_SLUG } from '@ecommerce/shared'
import { expect, vi } from 'vitest'
import type { InMemoryMailer } from '../../src/adapters/mailer.ts'
import { OWNER, appWithOwner, bearer, login, type Request } from './staff.ts'

export const CUSTOMER = { email: 'khach@example.com', password: 'mat-khau-cua-khach' }

/** The owner creates and publishes the privacy policy; returns the published version number. */
export async function publishPrivacyPolicy(request: Request, body = 'Chúng tôi chỉ dùng email để giao dịch.') {
  const owner = await login(request, OWNER.email, OWNER.password)
  const pages = await request.get('/api/admin/pages').set(bearer(owner.accessToken))
  let page = (pages.body.items as { id: string; slug: string }[]).find((p) => p.slug === PRIVACY_POLICY_SLUG)
  if (!page) {
    const created = await request
      .post('/api/admin/pages')
      .set(bearer(owner.accessToken))
      .send({ slug: PRIVACY_POLICY_SLUG, kind: 'policy', title: 'Chính sách bảo mật', body })
    expect(created.status).toBe(201)
    page = created.body as { id: string; slug: string }
  } else {
    await request
      .put(`/api/admin/pages/${page.id}`)
      .set(bearer(owner.accessToken))
      .send({ title: 'Chính sách bảo mật', body })
  }
  const published = await request.post(`/api/admin/pages/${page.id}/publish`).set(bearer(owner.accessToken))
  expect(published.status).toBe(200)
  return published.body.version as number
}

/** A clean app with an owner and privacy policy version 1. */
export async function appReadyForSignUp() {
  const app = await appWithOwner()
  await publishPrivacyPolicy(app.request)
  return app
}

export function register(request: Request, body: Record<string, unknown> = {}) {
  return request
    .post('/api/auth/register')
    .set('X-Client', 'mobile')
    .send({ ...CUSTOMER, acceptPrivacyPolicy: true, ...body })
}

/** Customer sign-in on the mobile channel; returns the response so tests check the status. */
export function customerLogin(request: Request, email: string, password: string) {
  return request.post('/api/auth/login').set('X-Client', 'mobile').send({ email, password })
}

/**
 * Waits for the `nth` email to `to` with a link to website page `path` (via the job queue), then takes the token from
 * the link.
 */
export async function tokenFromMail(mailer: InMemoryMailer, path: string, to = CUSTOMER.email, nth = 0) {
  const pattern = new RegExp(`https://shop\\.test${path}\\?token=([\\w-]+)`)
  const mail = await vi.waitFor(
    () => {
      const mails = mailer.sent.filter((m) => m.to === to && pattern.test(m.text))
      if (mails.length <= nth) throw new Error('Chưa có thư')
      return mails[nth]!
    },
    { timeout: 10_000, interval: 100 },
  )
  return pattern.exec(mail.text)![1]!
}
