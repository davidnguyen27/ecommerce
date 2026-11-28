import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { IOrderQuery } from '../order/index.ts'
import { RefundController } from './refund.controller.ts'
import { RefundRoute } from './refund.route.ts'
import { RefundService } from './refund.service.ts'

/** Wires service → controller → routes. Other code uses the refund functions exported from `index.ts`. */
export class RefundModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma' | 'payments' | 'emails' | 'siteUrl'>, orders: IOrderQuery) {
    super()
    const mail = { emails: deps.emails, siteUrl: deps.siteUrl }
    const service = new RefundService(deps.prisma, deps.payments, mail)
    this.routes = [new RefundRoute(new RefundController(service, orders))]
  }
}
