import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { VoucherController } from './voucher.controller.ts'
import { VoucherRepository } from './voucher.repository.ts'
import { VoucherRoute } from './voucher.route.ts'
import { VoucherService } from './voucher.service.ts'

/** Wires repository → service → controller → routes. Checkout calls the functions exported from `index.ts`. */
export class VoucherModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    this.routes = [new VoucherRoute(new VoucherController(new VoucherService(deps.prisma, new VoucherRepository())))]
  }
}
