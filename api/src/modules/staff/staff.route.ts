import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { StaffController } from './staff.controller.ts'

/** Staff management under `/api/admin/staff`; every route needs `staff.manage`. */
export class StaffRoute implements IRoute {
  readonly path = '/staff'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: StaffController) {
    this.router
      .use(requirePermission('staff.manage'))
      .get('/', c.list)
      .post('/', c.create)
      .put('/:id', c.update)
      .put('/:id/roles', c.changeRoles)
      .post('/:id/lock', c.lock)
      .post('/:id/unlock', c.unlock)
  }
}
