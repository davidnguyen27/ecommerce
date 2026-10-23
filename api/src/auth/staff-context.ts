import type { Request, RequestHandler } from 'express'
import { ErrorCode, type Permission, type StaffProfile } from '@ecommerce/shared'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { permissionsOf } from './permissions.ts'
import { authSubject } from './require-auth.ts'

export type CurrentStaff = StaffProfile

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Có sau khi qua `loadStaff`. */
      staff?: CurrentStaff
    }
  }
}

/**
 * Đọc nhân viên và role hiện tại từ DB ở mỗi request, để đổi role hay khóa tài khoản
 * có hiệu lực ngay cả khi access token còn hạn. Chạy sau `requireAuth` audience staff.
 */
export function loadStaff(prisma: Db): RequestHandler {
  return async (req, _res, next) => {
    const staff = await prisma.staff.findUnique({ where: { id: authSubject(req) } })
    if (!staff || staff.lockedAt) throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Cần đăng nhập')

    const { id, email, name, roles } = staff
    req.staff = { id, email, name, roles, permissions: permissionsOf(roles) }
    next()
  }
}

/**
 * Khai báo permission endpoint cần, có ít nhất một trong các quyền được liệt kê;
 * quyền tính từ role đọc trong DB ở request này.
 */
export function requirePermission(...anyOf: [Permission, ...Permission[]]): RequestHandler {
  return (req, _res, next) => {
    for (const permission of anyOf) {
      if (hasPermission(req, permission)) return next()
    }
    throw forbidden()
  }
}

export const forbidden = () => new AppError(403, ErrorCode.FORBIDDEN, 'Bạn không có quyền thực hiện thao tác này')

export function hasPermission(req: Request, permission: Permission): boolean {
  return currentStaff(req).permissions.includes(permission)
}

/** Nhân viên của request; chỉ gọi sau `loadStaff`. */
export function currentStaff(req: Request): CurrentStaff {
  if (!req.staff) throw new Error('Route chưa đi qua loadStaff')
  return req.staff
}
