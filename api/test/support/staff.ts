import type { StaffRole } from '@ecommerce/shared'
import { expect } from 'vitest'
import { seedOwner } from '../../src/auth/staff.ts'
import { createTestApp } from './test-app.ts'

export const OWNER = { email: 'chu@example.com', password: 'mat-khau-dai-du-manh', name: 'Chủ Cửa Hàng' }

/** Mật khẩu của nhân viên tạo bằng `createStaff`. */
export const STAFF_PASSWORD = 'mat-khau-nhan-vien-123'

export type Request = Awaited<ReturnType<typeof createTestApp>>['request']

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

/** App trên DB sạch, đã có owner tạo bằng lệnh seed. */
export async function appWithOwner(options?: Parameters<typeof createTestApp>[0]) {
  const app = await createTestApp(options)
  await seedOwner(app.prisma, OWNER)
  return app
}

/** Đăng nhập kênh mobile để nhận cả hai token qua body. */
export async function login(request: Request, email: string, password: string) {
  const res = await request.post('/api/admin/auth/login').set('X-Client', 'mobile').send({ email, password })
  expect(res.status).toBe(200)
  return res.body as { accessToken: string; refreshToken: string }
}

/** Owner tạo một nhân viên qua API rồi đăng nhập bằng tài khoản đó. */
export async function createStaff(request: Request, ownerToken: string, roles: StaffRole[], email = 'nv@example.com') {
  const res = await request
    .post('/api/admin/staff')
    .set(bearer(ownerToken))
    .send({ email, name: 'Nhân Viên', password: STAFF_PASSWORD, roles })
  expect(res.status).toBe(201)
  return { id: res.body.id as string, ...(await login(request, email, STAFF_PASSWORD)) }
}
