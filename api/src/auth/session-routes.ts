import cookieParser from 'cookie-parser'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { AuthClient, ErrorCode, LoginRequest, RefreshRequest, type AuthTokens } from '@ecommerce/shared'
import type { Db } from '../db.ts'
import type { AuthAudience } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import { signAccessToken } from './access-token.ts'
import { hashPassword, verifyPassword } from './password.ts'
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  type IssuedRefreshToken,
} from './refresh-tokens.ts'

export type SessionOptions = {
  prisma: Db
  secret: Uint8Array
  audience: AuthAudience
  /** Hạn tuyệt đối của phiên tính từ lúc đăng nhập; refresh không kéo dài thêm. */
  sessionTtlMs: number
  /** Đường dẫn đầy đủ của endpoint refresh; cookie chỉ được gửi tới đây. */
  refreshPath: string
  findCredentials(email: string): Promise<{ id: string; passwordHash: string } | null>
}

const ClientHeader = z.object({ 'x-client': AuthClient })

// Email không tồn tại vẫn chạy verify một lần, để thời gian phản hồi không lộ email nào có thật.
// Băm sẵn lúc nạp module, để cả request đầu tiên cũng chỉ tốn đúng một lần verify.
const dummyHash = hashPassword('khong-co-tai-khoan')

/**
 * `POST /login`, `POST /refresh` và `DELETE /refresh` (đăng xuất) cho một miền xác thực.
 * Header `X-Client` chọn kênh: `web` giữ refresh token trong cookie, `mobile` gửi qua body.
 */
export function sessionRoutes(options: SessionOptions) {
  const { prisma, secret, audience } = options
  const cookieName = `${audience}_refresh`

  function clientOf(req: Request): AuthClient {
    return parse(ClientHeader, req.headers)['x-client']
  }

  function readRefreshToken(req: Request, client: AuthClient): string | undefined {
    if (client === 'mobile') return parse(RefreshRequest, req.body).refreshToken
    const cookie: unknown = req.cookies?.[cookieName]
    return typeof cookie === 'string' ? cookie : undefined
  }

  async function sendTokens(res: Response, client: AuthClient, issued: IssuedRefreshToken) {
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
    res.json(body)
  }

  return Router()
    .use(cookieParser())
    .post('/login', async (req, res) => {
      const client = clientOf(req)
      const { email, password } = parse(LoginRequest, req.body)
      const account = await options.findCredentials(email)
      if (!account) await verifyPassword(await dummyHash, password)
      if (!account || !(await verifyPassword(account.passwordHash, password))) {
        throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Email hoặc mật khẩu không đúng')
      }

      await sendTokens(res, client, await issueRefreshToken(prisma, audience, account.id, options.sessionTtlMs))
    })
    .post('/refresh', async (req, res) => {
      const client = clientOf(req)
      const token = readRefreshToken(req, client)
      const issued = token && (await rotateRefreshToken(prisma, audience, token))
      if (!issued) throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Phiên đăng nhập đã hết hạn')

      await sendTokens(res, client, issued)
    })
    .delete('/refresh', async (req, res) => {
      const client = clientOf(req)
      const token = readRefreshToken(req, client)
      if (token) await revokeRefreshToken(prisma, audience, token)
      if (client === 'web') res.clearCookie(cookieName, { path: options.refreshPath })
      res.status(204).end()
    })
}
