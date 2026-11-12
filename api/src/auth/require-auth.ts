import type { Request, RequestHandler } from 'express'
import { ErrorCode } from '@ecommerce/shared'
import type { AuthAudience } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { verifyAccessToken } from './access-token.ts'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Có sau khi qua `requireAuth`. */
      auth?: { audience: AuthAudience; subjectId: string }
    }
  }
}

/** Chỉ cho qua request mang access token còn hạn của đúng audience. */
export function requireAuth(secret: Uint8Array, audience: AuthAudience): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    const subjectId = token && (await verifyAccessToken(secret, audience, token))
    if (!subjectId) throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Cần đăng nhập')

    req.auth = { audience, subjectId }
    next()
  }
}

/**
 * Đăng nhập không bắt buộc: không có header `Authorization` thì cho qua như khách vãng lai, có thì token phải còn
 * hạn và đúng audience (sai thì 401, để trình duyệt refresh rồi gửi lại thay vì bị coi là khách vãng lai).
 * Route đọc `req.auth?.subjectId`.
 */
export function optionalAuth(secret: Uint8Array, audience: AuthAudience): RequestHandler {
  const required = requireAuth(secret, audience)
  return (req, res, next) => (req.headers.authorization === undefined ? next() : required(req, res, next))
}

/** Lấy subject đã xác thực; chỉ gọi sau `requireAuth`. */
export function authSubject(req: Request): string {
  if (!req.auth) throw new Error('Route chưa đi qua requireAuth')
  return req.auth.subjectId
}
