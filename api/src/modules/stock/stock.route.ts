import { Router } from 'express'
import { STOCK_VIEW_PERMISSIONS } from '@ecommerce/shared'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { StockController } from './stock.controller.ts'

/**
 * Stock and ledger under `/api/admin/stock`. Viewing needs `catalog.edit`, `price.edit` or `stock.adjust` (catalog
 * and price editors need to know stock); changing stock needs `stock.adjust`.
 */
export class StockAdminRoute implements IRoute {
  readonly path = '/stock'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: StockController) {
    this.router
      .use(requirePermission(...STOCK_VIEW_PERMISSIONS))
      .get('/', c.list)
      .get('/movements', c.movements)
      .post('/adjustments', requirePermission('stock.adjust'), c.adjust)
  }
}
