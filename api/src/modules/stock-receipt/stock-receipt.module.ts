import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
// Adapter to code not moved into modules yet (pre-order arrivals).
import { preorderApi } from '../preorder-campaign/index.ts'
import type { IStockLedger } from '../stock/index.ts'
import { StockReceiptController } from './stock-receipt.controller.ts'
import { StockReceiptRepository } from './stock-receipt.repository.ts'
import { StockReceiptRoute } from './stock-receipt.route.ts'
import { StockReceiptService } from './stock-receipt.service.ts'

/** Wires repository → service → controller → routes. */
export class StockReceiptModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma' | 'emails' | 'siteUrl'>, stock: IStockLedger) {
    super()
    const mail = { emails: deps.emails, siteUrl: deps.siteUrl }
    const service = new StockReceiptService(deps.prisma, new StockReceiptRepository(), mail, {
      stock,
      arrivals: { plan: preorderApi.planArrivals, apply: preorderApi.applyArrivals },
    })
    this.routes = [new StockReceiptRoute(new StockReceiptController(service))]
  }
}
