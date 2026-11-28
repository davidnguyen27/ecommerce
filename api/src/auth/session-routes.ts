import cookieParser from 'cookie-parser'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { AuthClient, ErrorCode, LoginRequest, RefreshRequest, type AuthTokens } from '@ecommerce/shared'
import type { Db } from '../core/db.ts'
import type { AuthAudience } from '../generated/prisma/client.ts'
import { AppError } from '../core/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../core/middleware/rate-limit.ts'
import { parse } from '../core/middleware/validation.ts'
import { signAccessToken } from './access-token.ts'
import { hashPassword, verifyPassword } from './password.ts'
import {
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  type IssuedRefreshToken,
} from './refresh-tokens.ts'
import { normalizeEmail } from './staff.ts'

export type SessionOptions = {
  prisma: Db
  secret: Uint8Array
  audience: AuthAudience
  /** Absolute session lifetime from sign-in; refresh does not extend it. */
  sessionTtlMs: number
  /** Full path of the refresh endpoint; the cookie is only sent there. */
  refreshPath: string
  /** Returns only accounts allowed to sign in; locked accounts give `null`. */
  findCredentials(email: string): Promise<{ id: string; passwordHash: string } | null>
  /** Rechecked on refresh, in case the account was locked mid-rotation. */
  isActive(subjectId: string): Promise<boolean>
}

const ClientHeader = z.object({ 'x-client': AuthClient })

// Unknown emails still run one verify, so response time does not reveal which emails exist.
// Hashed at module load, so even the first request costs exactly one verify.
const dummyHash = hashPassword('khong-co-tai-khoan')

/** Request channel from the `X-Client` header; missing or invalid gives 400. */
export function clientOf(req: Request): AuthClient {
  return parse(ClientHeader, req.headers)['x-client']
}

/**
 * Sessions for one auth domain. `routes` has `POST /login`, `POST /refresh` and `DELETE /refresh` (sign-out);
 * `start` opens a session for other routes, e.g. right after sign-up. `X-Client` picks the channel: `web` keeps the
 * refresh token in a cookie, `mobile` in the body.
 */
export function createSessions(options: SessionOptions) {
  const { prisma, secret, audience } = options
  const cookieName = `${audience}_refresh`

  function readRefreshToken(req: Request, client: AuthClient): string | undefined {
    if (client === 'mobile') return parse(RefreshRequest, req.body).refreshToken
    const cookie: unknown = req.cookies?.[cookieName]
    return typeof cookie === 'string' ? cookie : undefined
  }

  async function sendTokens(res: Response, client: AuthClient, issued: IssuedRefreshToken, status = 200) {
    const body: AuthTokens = { accessToken: await signAccessToken(secret, audience, issued.subjectId) }
    if (client === 'mobile') {
      body.refreshToken = issued.refreshToken
    } else {
      res.cookie(cookieName, issued.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: options.refreshPath,
        expires: issued.expiresAt,
      })
    }
    res.status(status).json(body)
  }

  /** Opens a new session for `subjectId` and returns tokens for the request's channel. */
  async function start(req: Request, res: Response, subjectId: string, status = 200) {
    const client = clientOf(req)
    await sendTokens(res, client, await issueRefreshToken(prisma, audience, subjectId, options.sessionTtlMs), status)
  }

  const routes = Router()
    .use(cookieParser())
    .post('/login', async (req, res) => {
      // Check the channel header before spending a password verify.
      clientOf(req)
      const { email, password } = parse(LoginRequest, req.body)
      // Count successful sign-ins too, and count before verifying so password guessers cannot burn our CPU.
      await enforceRateLimits(prisma, [
        { limit: RATE_LIMITS.loginPerEmail, subject: `${audience}:${normalizeEmail(email)}` },
        { limit: RATE_LIMITS.loginPerIp, subject: `${audience}:${String(req.ip)}` },
      ])
      const account = await options.findCredentials(email)
      if (!account) await verifyPassword(await dummyHash, password)
      if (!account || !(await verifyPassword(account.passwordHash, password))) {
        throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Email hoặc mật khẩu không đúng')
      }

      await start(req, res, account.id)
    })
    .post('/refresh', async (req, res) => {
      const client = clientOf(req)
      const token = readRefreshToken(req, client)
      const issued = token && (await rotateRefreshToken(prisma, audience, token))
      const expired = new AppError(401, ErrorCode.UNAUTHORIZED, 'Phiên đăng nhập đã hết hạn')
      if (!issued) throw expired
      if (!(await options.isActive(issued.subjectId))) {
        await revokeAllRefreshTokens(prisma, audience, issued.subjectId)
        throw expired
      }

      await sendTokens(res, client, issued)
    })
    .delete('/refresh', async (req, res) => {
      const client = clientOf(req)
      const token = readRefreshToken(req, client)
      if (token) await revokeRefreshToken(prisma, audience, token)
      if (client === 'web') res.clearCookie(cookieName, { path: options.refreshPath })
      res.status(204).end()
    })

  return { routes, start }
}
