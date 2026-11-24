import type { StaffRole } from '@ecommerce/shared'
import { expect } from 'vitest'
import { seedOwner } from '../../src/auth/staff.ts'
import { createTestApp } from './test-app.ts'

export const OWNER = { email: 'chu@example.com', password: 'mat-khau-dai-du-manh', name: 'Chủ Cửa Hàng' }

/** Password of staff created with `createStaff`. */
export const STAFF_PASSWORD = 'mat-khau-nhan-vien-123'

export type Request = Awaited<ReturnType<typeof createTestApp>>['request']

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

/** An app on a clean DB, with the owner created by the seed command. */
export async function appWithOwner(options?: Parameters<typeof createTestApp>[0]) {
  const app = await createTestApp(options)
  await seedOwner(app.prisma, OWNER)
  return app
}

/** Signs in on the mobile channel to get both tokens in the body. */
export async function login(request: Request, email: string, password: string) {
  const res = await request.post('/api/admin/auth/login').set('X-Client', 'mobile').send({ email, password })
  expect(res.status).toBe(200)
  return res.body as { accessToken: string; refreshToken: string }
}

/** The owner creates a staff member via the API, then signs in with that account. */
export async function createStaff(request: Request, ownerToken: string, roles: StaffRole[], email = 'nv@example.com') {
  const res = await request
    .post('/api/admin/staff')
    .set(bearer(ownerToken))
    .send({ email, name: 'Nhân Viên', password: STAFF_PASSWORD, roles })
  expect(res.status).toBe(201)
  return { id: res.body.id as string, ...(await login(request, email, STAFF_PASSWORD)) }
}
