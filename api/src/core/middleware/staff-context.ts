import type { Request, RequestHandler } from 'express'
import { ErrorCode, type Permission, type StaffProfile } from '@ecommerce/shared'
import type { Db } from '../db.ts'
import { AppError } from '../errors.ts'
import { permissionsOf } from '../auth/permissions.ts'
import { authSubject } from './require-auth.ts'

export type CurrentStaff = StaffProfile

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set after `loadStaff`. */
      staff?: CurrentStaff
    }
  }
}

/**
 * Reads the staff member and role from the DB on each request, so role changes and locks apply even while the access
 * token is valid. Runs after `requireAuth` for the staff audience.
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
 * Declares the permissions an endpoint needs (any one of them); computed from the role read in this request.
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

/** The request's staff member; call only after `loadStaff`. */
export function currentStaff(req: Request): CurrentStaff {
  if (!req.staff) throw new Error('Route chưa đi qua loadStaff')
  return req.staff
}
