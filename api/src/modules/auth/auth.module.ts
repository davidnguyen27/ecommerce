import type { AppDeps } from '../../app.ts'
import type { Db } from '../../core/db.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { AuthAudience } from '../../generated/prisma/client.ts'
import { SessionController } from './auth.controller.ts'
import type { SessionAccounts } from './auth.interface.ts'
import { StaffAccountRepository } from './auth.repository.ts'
import { StaffSessionRoute } from './auth.route.ts'
import { SessionService } from './auth.service.ts'

const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000

export type SessionOptions = {
  prisma: Db
  secret: Uint8Array
  audience: AuthAudience
  sessionTtlMs: number
  /** Full path of the refresh endpoint; the refresh cookie is only sent there. */
  refreshPath: string
  accounts: SessionAccounts
}

/** Sessions for one auth domain: the controller has the handlers and `start` for other routes. */
export function createSessions(o: SessionOptions) {
  return new SessionController(
    new SessionService(o.prisma, o.secret, o.audience, o.sessionTtlMs, o.accounts),
    o.refreshPath,
  )
}

/** Staff sessions. Customer sessions live in `customer-auth`, which builds them with `createSessions`. */
export class AuthModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma' | 'jwtSecret'>) {
    super()
    const { prisma } = deps
    const repo = new StaffAccountRepository()
    const sessions = createSessions({
      prisma,
      secret: new TextEncoder().encode(deps.jwtSecret),
      audience: 'staff',
      sessionTtlMs: STAFF_SESSION_TTL_MS,
      refreshPath: '/api/admin/auth/refresh',
      accounts: {
        findCredentials: (email) => repo.findCredentials(prisma, email),
        isActive: (id) => repo.isActive(prisma, id),
      },
    })
    this.routes = [new StaffSessionRoute(sessions)]
  }
}
