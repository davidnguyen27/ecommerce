import { Router } from 'express'
import { STOCK_VIEW_PERMISSIONS } from '@ecommerce/shared'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { StockReceiptController } from './stock-receipt.controller.ts'

/**
 * Stock receipts under `/api/admin/stock/receipts`. Viewing has the stock page's permissions; creating and previewing
 * pre-order allocation need `stock.adjust`.
 */
export class StockReceiptRoute implements IRoute {
  readonly path = '/stock/receipts'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: StockReceiptController) {
    const adjust = requirePermission('stock.adjust')
    this.router
      .use(requirePermission(...STOCK_VIEW_PERMISSIONS))
      .get('/', c.list)
      .post('/preview', adjust, c.preview)
      .get('/:id', c.detail)
      .post('/', adjust, c.create)
  }
}
