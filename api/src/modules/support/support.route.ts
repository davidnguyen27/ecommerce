import { Router } from 'express'
import { receiveSupportImage } from '../../core/media/support-images.ts'
import type { IRoute, RouteAccess } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { SupportCustomerController } from './support-customer.controller.ts'
import type { SupportController } from './support.controller.ts'

/**
 * Admin support requests under `/api/admin/support-requests`. Viewing needs `support.handle` or `order.view`; reply,
 * note, status, take and create-on-behalf need `support.handle`; warehouse receiving and exchange handover need
 * `order.fulfill`; assigning to others is owner-only (`staff.manage`).
 */
export class SupportAdminRoute implements IRoute {
  readonly path = '/support-requests'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: SupportController) {
    const handle = requirePermission('support.handle')
    const fulfill = requirePermission('order.fulfill')
    this.router
      .use(requirePermission('support.handle', 'order.view'))
      .get('/', c.list)
      .get('/exchange-options', handle, c.exchangeOptions)
      .get('/:code', c.detail)
      .post('/', handle, c.create)
      .post('/:code/reply', handle, c.reply)
      .post('/:code/claim', handle, c.claim)
      .post('/:code/messages/:messageId/attachments', handle, receiveSupportImage, c.attach)
      // Returns: accept/reject, warehouse receiving, refund proposal.
      .post('/:code/decide', handle, c.decide)
      .post('/:code/receive', fulfill, c.receive)
      .post('/:code/exchange-ship', fulfill, c.shipExchange)
      .post('/:code/warranty-milestone', handle, c.warrantyMilestone)
      .post('/:code/warranty-outcome', handle, c.warrantyOutcome)
      .post('/:code/refund', handle, c.refund)
      .post('/:code/assign', requirePermission('staff.manage'), c.assign)
  }
}

/**
 * Support requests as one kind of customer viewer sees them, mounted at `path`:
 * - `/api/account/support-requests`: the signed-in customer's requests; may attach to their own orders.
 * - `/api/orders/:code/support-requests?token=…`: the order's requests, for lookup link holders.
 * - `/api/support-requests?token=…`: a guest's request without an order (chatbot handoff), with the emailed token.
 */
export class SupportCustomerRoute implements IRoute {
  // `mergeParams` for the order code in `/orders/:code/support-requests`.
  readonly router = Router({ mergeParams: true })

  constructor(
    readonly path: string,
    readonly access: RouteAccess,
    c: SupportCustomerController,
  ) {
    this.router
      .get('/', c.list)
      .post('/', c.create)
      .get('/exchange-options', c.exchangeOptions)
      .get('/:requestCode', c.detail)
      .post('/:requestCode/messages', c.addMessage)
      .post('/:requestCode/messages/:messageId/attachments', receiveSupportImage, c.attach)
  }
}
