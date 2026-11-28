import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import { validate } from '../../core/middleware/validation.ts'
import { AccountOrderQueryDto, AdminOrderQueryDto, CancelPaidOrderDto } from './dto/index.ts'
import type { OrderController } from './order.controller.ts'

/** Admin orders under `/api/admin/orders`: viewing needs `order.view`, fulfillment `order.fulfill`. */
export class OrderAdminRoute implements IRoute {
  readonly path = '/orders'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: OrderController) {
    const fulfill = requirePermission('order.fulfill')
    this.router
      .get('/', requirePermission('order.view'), validate(AdminOrderQueryDto, 'query'), c.adminList)
      .get('/:code', requirePermission('order.view'), c.adminDetail)
      .post('/:code/cancel', fulfill, c.adminCancel)
      .post(
        '/:code/cancel-paid',
        requirePermission('order.cancel_paid'),
        validate(CancelPaidOrderDto),
        c.adminCancelPaid,
      )
      .post('/:code/prepare', fulfill, c.prepare)
      .post('/:code/hand-over', fulfill, c.handOver)
      .post('/:code/deliver', fulfill, c.deliver)
      .post('/:code/delivery-failed', fulfill, c.failDelivery)
      .post('/:code/redeliver', fulfill, c.redeliver)
      .post('/:code/return-to-stock', fulfill, c.returnToStock)
      .post('/:code/restock-redeliver', fulfill, c.restockForRedelivery)
  }
}

/** The signed-in customer's orders under `/api/account/orders`. */
export class OrderAccountRoute implements IRoute {
  readonly path = '/account/orders'
  readonly access = 'customer'
  readonly router = Router()

  constructor(c: OrderController) {
    this.router
      .get('/', validate(AccountOrderQueryDto, 'query'), c.accountList)
      .get('/:code', c.accountDetail)
      .post('/:code/pay-remainder', c.accountPayRemainder)
      .post('/:code/cancel', c.accountCancel)
  }
}

/**
 * Orders by lookup token link under `/api/orders`, no sign-in. The token allows viewing, cancelling unpaid orders and
 * paying the remainder. Other paths under `/api/orders/:code/…` (support requests) fall through to their routers.
 */
export class OrderPublicRoute implements IRoute {
  readonly path = '/orders'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: OrderController) {
    this.router
      .get('/:code', c.publicDetail)
      .post('/:code/pay-remainder', c.publicPayRemainder)
      .post('/:code/cancel', c.publicCancel)
  }
}
