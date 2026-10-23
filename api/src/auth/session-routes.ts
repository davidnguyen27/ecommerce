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
  revokeAllRefreshTokens,
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
  /** Chỉ trả tài khoản được phép đăng nhập; tài khoản bị khóa trả `null`. */
  findCredentials(email: string): Promise<{ id: string; passwordHash: string } | null>
  /** Kiểm lại lúc refresh, phòng khi tài khoản bị khóa giữa chừng một lần rotation. */
  isActive(subjectId: string): Promise<boolean>
}

const ClientHeader = z.object({ 'x-client': AuthClient })

// Email không tồn tại vẫn chạy verify một lần, để thời gian phản hồi không lộ email nào có thật.
// Băm sẵn lúc nạp module, để cả request đầu tiên cũng chỉ tốn đúng một lần verify.
const dummyHash = hashPassword('khong-co-tai-khoan')

function clientOf(req: Request): AuthClient {
  return parse(ClientHeader, req.headers)['x-client']
}

/**
 * Phiên đăng nhập của một miền xác thực. `routes` gồm `POST /login`, `POST /refresh` và
 * `DELETE /refresh` (đăng xuất); `start` mở phiên cho route khác, ví dụ ngay sau khi đăng ký.
 * Header `X-Client` chọn kênh: `web` giữ refresh token trong cookie, `mobile` gửi qua body.
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

  /** Mở một phiên mới cho `subjectId` và trả token theo kênh của request. */
  async function start(req: Request, res: Response, subjectId: string, status = 200) {
    const client = clientOf(req)
    await sendTokens(res, client, await issueRefreshToken(prisma, audience, subjectId, options.sessionTtlMs), status)
  }

  const routes = Router()
    .use(cookieParser())
    .post('/login', async (req, res) => {
      // Kiểm header kênh trước khi tốn một lần verify mật khẩu.
      clientOf(req)
      const { email, password } = parse(LoginRequest, req.body)
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
