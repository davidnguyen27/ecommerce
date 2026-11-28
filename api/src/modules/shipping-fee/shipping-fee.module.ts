import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { ShippingFeeController } from './shipping-fee.controller.ts'
import { ShippingFeeRepository } from './shipping-fee.repository.ts'
import { ShippingFeeRoute } from './shipping-fee.route.ts'
import { ShippingFeeService } from './shipping-fee.service.ts'

/** Wires repository → service → controller → routes. Checkout reads the config through `index.ts`. */
export class ShippingFeeModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    const service = new ShippingFeeService(deps.prisma, new ShippingFeeRepository())
    this.routes = [new ShippingFeeRoute(new ShippingFeeController(service))]
  }
}
