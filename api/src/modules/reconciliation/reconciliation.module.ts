import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { IOrderQuery } from '../order/index.ts'
import { ReconciliationController } from './reconciliation.controller.ts'
import { ReconciliationRepository } from './reconciliation.repository.ts'
import { ReconciliationRoute } from './reconciliation.route.ts'
import { ReconciliationService } from './reconciliation.service.ts'

/** Wires repository → service → controller → routes. */
export class ReconciliationModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma' | 'emails' | 'siteUrl'>, orders: IOrderQuery) {
    super()
    const mail = { emails: deps.emails, siteUrl: deps.siteUrl }
    const service = new ReconciliationService(deps.prisma, new ReconciliationRepository(), mail)
    this.routes = [new ReconciliationRoute(new ReconciliationController(service, orders))]
  }
}
