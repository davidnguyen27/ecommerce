import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { ReconciliationController } from './reconciliation.controller.ts'

/**
 * Reconciliation under `/api/admin/reconciliation`: listing needs `order.view`; restoring an order, resolving by
 * refund or closing an item needs `payment.reconcile`.
 */
export class ReconciliationRoute implements IRoute {
  readonly path = '/reconciliation'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ReconciliationController) {
    const reconcile = requirePermission('payment.reconcile')
    this.router
      .get('/', requirePermission('order.view'), c.list)
      .post('/:id/restore', reconcile, c.restore)
      .post('/:id/refund', reconcile, c.refund)
      .post('/:id/resolve', reconcile, c.resolve)
  }
}
