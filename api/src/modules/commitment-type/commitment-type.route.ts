import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import { validate } from '../../core/middleware/validation.ts'
import type { CommitmentTypeController } from './commitment-type.controller.ts'
import { CommitmentTypeDto } from './dto/index.ts'

/**
 * Commitment types under `/api/admin/commitment-types`. Anyone editing products or viewing documents can read the
 * list; adding or editing needs `commitment.edit`.
 */
export class CommitmentTypeAdminRoute implements IRoute {
  readonly path = '/commitment-types'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: CommitmentTypeController) {
    this.router
      .get('/', requirePermission('catalog.edit', 'price.edit', 'document.view', 'commitment.edit'), c.list)
      .post('/', requirePermission('commitment.edit'), validate(CommitmentTypeDto), c.createItem)
      .put('/:id', requirePermission('commitment.edit'), c.update)
  }
}
