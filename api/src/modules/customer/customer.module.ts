import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { ISessions } from '../auth/index.ts'
import { CustomerController } from './customer.controller.ts'
import { CustomerRepository } from './customer.repository.ts'
import { CustomerRoute } from './customer.route.ts'
import { CustomerService } from './customer.service.ts'

/** Wires repository → service → controller → routes; a password change opens a new customer session. */
export class CustomerModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma' | 'emails' | 'siteUrl'>, sessions: ISessions) {
    super()
    const mail = { emails: deps.emails, siteUrl: deps.siteUrl }
    const service = new CustomerService(deps.prisma, new CustomerRepository(), mail)
    this.routes = [new CustomerRoute(new CustomerController(service, sessions))]
  }
}
