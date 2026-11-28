import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { StockController } from './stock.controller.ts'
import type { IStockLedger } from './stock.interface.ts'
import { StockLedger } from './stock.ledger.ts'
import { StockRepository } from './stock.repository.ts'
import { StockAdminRoute } from './stock.route.ts'
import { StockService } from './stock.service.ts'

/** Wires repository → ledger and service → controller → routes. Other modules use `ledger`. */
export class StockModule extends BaseModule {
  readonly routes: readonly IRoute[]
  readonly ledger: IStockLedger

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    const repo = new StockRepository()
    const ledger = new StockLedger(repo)
    this.routes = [new StockAdminRoute(new StockController(new StockService(deps.prisma, repo, ledger)))]
    this.ledger = ledger
  }
}

/**
 * The stock ledger for code outside `modules/` with no module wiring yet (checkout, pre-orders, support,
 * reconciliation). It works only in the `db` or transaction it is given, so one shared instance is safe. Removed once
 * those move.
 */
export const stockLedger: IStockLedger = new StockLedger(new StockRepository())

/** `stockLedger.change` as a function, for code and tests that call the ledger directly (CODING_STANDARDS "Test"). */
export const changeStock: IStockLedger['change'] = (tx, actorId, variantIds, plan) =>
  stockLedger.change(tx, actorId, variantIds, plan)
