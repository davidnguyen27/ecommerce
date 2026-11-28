import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { PreorderCampaignController } from './preorder-campaign.controller.ts'

/** Pre-order campaigns under `/api/admin/preorder-campaigns`. Viewing needs `order.view`; changes `preorder.manage`. */
export class PreorderCampaignRoute implements IRoute {
  readonly path = '/preorder-campaigns'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: PreorderCampaignController) {
    const manage = requirePermission('preorder.manage')
    this.router
      .use(requirePermission('order.view', 'preorder.manage'))
      .get('/', c.list)
      // Before `/:id`.
      .get('/attention', requirePermission('order.view'), c.attention)
      .get('/:id', c.detail)
      .post('/', manage, c.open)
      .patch('/:id', manage, c.update)
      .post('/:id/close', manage, c.close)
      .get('/:id/cancel-unsupplied', c.unsuppliedPreview)
      // Cancelling paid orders and closing the campaign are separate permissions: both are needed.
      .post('/:id/cancel-unsupplied', requirePermission('order.cancel_paid'), manage, c.cancelUnsupplied)
  }
}
