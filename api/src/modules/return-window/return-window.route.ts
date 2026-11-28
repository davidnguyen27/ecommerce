import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { ReturnWindowController } from './return-window.controller.ts'

/**
 * Return windows under `/api/admin/return-windows`. Viewable by content editors, request handlers and order viewers;
 * editing needs `content.edit` (it goes with the returns policy page).
 */
export class ReturnWindowRoute implements IRoute {
  readonly path = '/return-windows'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ReturnWindowController) {
    this.router
      .get('/', requirePermission('content.edit', 'support.handle', 'order.view'), c.list)
      .put('/', requirePermission('content.edit'), c.save)
  }
}
