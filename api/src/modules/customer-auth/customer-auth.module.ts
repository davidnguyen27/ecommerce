import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { createSessions, sessionRouter, type ISessions } from '../auth/index.ts'
import { CustomerAuthController } from './customer-auth.controller.ts'
import { CustomerAccountRepository } from './customer-auth.repository.ts'
import { CustomerAuthRoute } from './customer-auth.route.ts'
import { CustomerAuthService } from './customer-auth.service.ts'

const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Wires customer sessions (refresh token at `/api/auth/refresh`) and sign-up → controller → route. The account module
 * opens sessions through `sessions`.
 */
export class CustomerAuthModule extends BaseModule {
  readonly routes: readonly IRoute[]
  readonly sessions: ISessions

  constructor(deps: Pick<AppDeps, 'prisma' | 'jwtSecret' | 'emails' | 'siteUrl'>) {
    super()
    const { prisma } = deps
    const repo = new CustomerAccountRepository()
    const sessions = createSessions({
      prisma,
      secret: new TextEncoder().encode(deps.jwtSecret),
      audience: 'customer',
      sessionTtlMs: CUSTOMER_SESSION_TTL_MS,
      refreshPath: '/api/auth/refresh',
      accounts: {
        findCredentials: (email) => repo.findCredentials(prisma, email),
        isActive: (id) => repo.isActive(prisma, id),
      },
    })
    const service = new CustomerAuthService(prisma, repo, { emails: deps.emails, siteUrl: deps.siteUrl })
    this.routes = [new CustomerAuthRoute(new CustomerAuthController(service, sessions), sessionRouter(sessions))]
    this.sessions = sessions
  }
}
