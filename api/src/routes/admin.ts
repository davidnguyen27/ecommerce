import { Router } from 'express'
import { ErrorCode, type StaffProfile } from '@ecommerce/shared'
import { authSubject } from '../auth/require-auth.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'

/** Các route quản trị; đã đi qua `requireAuth` audience staff. */
export function adminRoutes(prisma: Db) {
  return Router().get('/me', async (req, res) => {
    const staff = await prisma.staff.findUnique({ where: { id: authSubject(req) } })
    if (!staff) throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Cần đăng nhập')

    const body: StaffProfile = { id: staff.id, email: staff.email, name: staff.name }
    res.json(body)
  })
}
