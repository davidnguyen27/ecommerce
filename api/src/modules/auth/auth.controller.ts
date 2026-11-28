import type { Request, Response } from 'express'
import { z } from 'zod'
import { AuthClient, LoginRequest, RefreshRequest, type AuthTokens } from '@ecommerce/shared'
import { parse } from '../../core/middleware/validation.ts'
import type { ISessions } from './auth.interface.ts'
import type { SessionService } from './auth.service.ts'
import type { IssuedRefreshToken } from './refresh-token.ts'

const ClientHeader = z.object({ 'x-client': AuthClient })

/** Request channel from the `X-Client` header; missing or invalid gives 400. */
export function clientOf(req: Request): AuthClient {
  return parse(ClientHeader, req.headers)['x-client']
}

/**
 * Session handlers of one auth domain. `X-Client` picks the channel: `web` keeps the refresh token in an httpOnly cookie
 * sent only to the refresh path, `mobile` in the body.
 */
export class SessionController implements ISessions {
  private readonly cookieName: string

  constructor(
    private readonly service: SessionService,
    /** Full path of the refresh endpoint; the cookie is only sent there. */
    private readonly refreshPath: string,
  ) {
    this.cookieName = `${service.audience}_refresh`
  }

  private readRefreshToken(req: Request, client: AuthClient): string | undefined {
    if (client === 'mobile') return parse(RefreshRequest, req.body).refreshToken
    const cookie: unknown = req.cookies?.[this.cookieName]
    return typeof cookie === 'string' ? cookie : undefined
  }

  private async sendTokens(res: Response, client: AuthClient, issued: IssuedRefreshToken, status = 200) {
    const body: AuthTokens = { accessToken: await this.service.accessToken(issued.subjectId) }
    if (client === 'mobile') {
      body.refreshToken = issued.refreshToken
    } else {
      res.cookie(this.cookieName, issued.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: this.refreshPath,
        expires: issued.expiresAt,
      })
    }
    res.status(status).json(body)
  }

  start = async (req: Request, res: Response, subjectId: string, status = 200) => {
    const client = clientOf(req)
    await this.sendTokens(res, client, await this.service.open(subjectId), status)
  }

  login = async (req: Request, res: Response) => {
    // Check the channel header before spending a password verify.
    const client = clientOf(req)
    const { email, password } = parse(LoginRequest, req.body)
    const issued = await this.service.login(email, password, String(req.ip))
    await this.sendTokens(res, client, issued)
  }

  refresh = async (req: Request, res: Response) => {
    const client = clientOf(req)
    await this.sendTokens(res, client, await this.service.refresh(this.readRefreshToken(req, client)))
  }

  logout = async (req: Request, res: Response) => {
    const client = clientOf(req)
    await this.service.logout(this.readRefreshToken(req, client))
    if (client === 'web') res.clearCookie(this.cookieName, { path: this.refreshPath })
    res.status(204).end()
  }
}
