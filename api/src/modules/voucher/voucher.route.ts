import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { VoucherController } from './voucher.controller.ts'

/**
 * Vouchers under `/api/admin/vouchers`. Viewing needs `voucher.manage` or `order.view`; create, edit, disable need
 * `voucher.manage`.
 */
export class VoucherRoute implements IRoute {
  readonly path = '/vouchers'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: VoucherController) {
    const manage = requirePermission('voucher.manage')
    this.router
      .use(requirePermission('order.view', 'voucher.manage'))
      .get('/', c.list)
      .get('/:id', c.detail)
      .get('/:id/orders', c.orders)
      .post('/', manage, c.create)
      .patch('/:id', manage, c.update)
      .post('/:id/disable', manage, c.disable)
  }
}
