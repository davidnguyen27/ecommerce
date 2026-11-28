import type { Request, RequestHandler } from 'express'
import { ErrorCode } from '@ecommerce/shared'
import type { AuthAudience } from '../../generated/prisma/client.ts'
import { AppError } from '../errors.ts'
import { verifyAccessToken } from '../../auth/access-token.ts'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set after `requireAuth`. */
      auth?: { audience: AuthAudience; subjectId: string }
    }
  }
}

/** Only lets through requests with an unexpired access token for the right audience. */
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
 * Optional sign-in: no `Authorization` header passes as a guest; with one, the token must be valid for the audience
 * (else 401, so the browser refreshes and retries instead of being treated as a guest). Routes read
 * `req.auth?.subjectId`.
 */
export function optionalAuth(secret: Uint8Array, audience: AuthAudience): RequestHandler {
  const required = requireAuth(secret, audience)
  return (req, res, next) => (req.headers.authorization === undefined ? next() : required(req, res, next))
}

/** The authenticated subject; call only after `requireAuth`. */
export function authSubject(req: Request): string {
  if (!req.auth) throw new Error('Route chưa đi qua requireAuth')
  return req.auth.subjectId
}
