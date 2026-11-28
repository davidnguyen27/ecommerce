import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { ReportController } from './report.controller.ts'

/**
 * Reports (M7) under `/api/admin/reports`, each with its `.xlsx`; every route needs `report.view`. Mounted after the
 * chatbot report (`/reports/chatbot`), which has its own permission.
 */
export class ReportRoute implements IRoute {
  readonly path = '/reports'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ReportController) {
    this.router
      .use(requirePermission('report.view'))
      .get('/revenue', c.revenue)
      .get('/revenue.xlsx', c.revenueXlsx)
      .get('/collections', c.collections)
      .get('/collections.xlsx', c.collectionsXlsx)
      .get('/stock', c.stock)
      .get('/stock.xlsx', c.stockXlsx)
      .get('/vouchers', c.vouchers)
      .get('/vouchers.xlsx', c.vouchersXlsx)
      .get('/cancellations', c.cancellations)
      .get('/cancellations.xlsx', c.cancellationsXlsx)
      .get('/returns', c.returns)
      .get('/returns.xlsx', c.returnsXlsx)
      .get('/exceptions', c.exceptions)
  }
}
