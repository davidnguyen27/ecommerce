import type { AppDeps } from '../../app.ts'
import { optionalAuth } from '../../core/middleware/require-auth.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { IStockLedger } from '../stock/index.ts'
import { CheckoutController } from './checkout.controller.ts'
import { CheckoutRoute, PreorderRoute } from './checkout.route.ts'
import { CheckoutService } from './checkout.service.ts'
import { orderPlacement } from './place-order.ts'

/** Wires the quote service and order placement → controller → routes. */
export class CheckoutModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: AppDeps, stock: Pick<IStockLedger, 'enoughStockIds'>) {
    super()
    const customerSession = optionalAuth(new TextEncoder().encode(deps.jwtSecret), 'customer')
    const controller = new CheckoutController(
      new CheckoutService(deps.prisma, deps.storage, stock),
      orderPlacement(deps),
    )
    this.routes = [new CheckoutRoute(controller, customerSession), new PreorderRoute(controller, customerSession)]
  }
}
