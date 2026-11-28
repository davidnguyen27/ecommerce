import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { ShippingFeeController } from './shipping-fee.controller.ts'

/**
 * Shipping fees under `/api/admin/shipping-fees`, with the existing `price.edit`: a fee is a price the customer pays
 * (spec "Phí giao").
 */
export class ShippingFeeRoute implements IRoute {
  readonly path = '/shipping-fees'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ShippingFeeController) {
    this.router.use(requirePermission('price.edit')).get('/', c.get).put('/', c.update)
  }
}
