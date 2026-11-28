import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { IStockLedger } from '../stock/index.ts'
import { ProductImportController } from './product-import.controller.ts'
import { ProductImportRepository } from './product-import.repository.ts'
import { ProductImportRoute } from './product-import.route.ts'
import { ProductImportService } from './product-import.service.ts'

/** Wires repository → service → controller → routes. */
export class ProductImportModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>, stock: IStockLedger) {
    super()
    const service = new ProductImportService(deps.prisma, new ProductImportRepository(), {
      stock,
    })
    this.routes = [new ProductImportRoute(new ProductImportController(service))]
  }
}
