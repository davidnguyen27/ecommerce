import type { AppDeps } from '../../app.ts'
import { authSubject } from '../../core/middleware/require-auth.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { IOrderQuery } from '../order/index.ts'
import { SupportCustomerController } from './support-customer.controller.ts'
import { SupportCustomerService } from './support-customer.service.ts'
import { SupportController } from './support.controller.ts'
import { SupportRepository } from './support.repository.ts'
import { SupportAdminRoute, SupportCustomerRoute } from './support.route.ts'
import { SupportService } from './support.service.ts'

const tokenOf = (query: unknown) => {
  const token = (query as Record<string, unknown>).token
  return typeof token === 'string' ? token : undefined
}

/** Wires repository → services → controllers → routes: one admin route, three customer viewers. */
export class SupportModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma' | 'storage' | 'emails' | 'siteUrl'>, orders: IOrderQuery) {
    super()
    const { prisma, storage } = deps
    const mail = { emails: deps.emails, siteUrl: deps.siteUrl }
    const repo = new SupportRepository()
    const customers = new SupportCustomerService(prisma, repo, storage, mail, orders)
    this.routes = [
      new SupportAdminRoute(new SupportController(new SupportService(prisma, repo, storage, mail))),
      new SupportCustomerRoute(
        '/account/support-requests',
        'customer',
        new SupportCustomerController(customers, (req) => ({ kind: 'account', customerId: authSubject(req) })),
      ),
      new SupportCustomerRoute(
        '/orders/:code/support-requests',
        'public',
        new SupportCustomerController(customers, (req) => ({
          kind: 'order',
          orderCode: String(req.params.code),
          token: tokenOf(req.query),
        })),
      ),
      new SupportCustomerRoute(
        '/support-requests',
        'public',
        new SupportCustomerController(customers, (req) => ({ kind: 'contact', token: tokenOf(req.query) ?? '' })),
      ),
    ]
  }
}
