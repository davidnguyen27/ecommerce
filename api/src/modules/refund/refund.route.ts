import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { RefundController } from './refund.controller.ts'

/**
 * Refund execution under `/api/admin/refunds`; everything needs `payment.refund`. Refunds are viewed in the order
 * detail (`order.view`).
 */
export class RefundRoute implements IRoute {
  readonly path = '/refunds'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: RefundController) {
    this.router
      .use(requirePermission('payment.refund'))
      .post('/:id/manual', c.manual)
      .post('/:id/vnpay', c.viaGateway)
      .post('/:id/settle', c.settle)
      .post('/:id/retry', c.retry)
  }
}
