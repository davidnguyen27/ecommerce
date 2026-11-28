import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { AuditLogController } from './audit-log.controller.ts'

/** The audit log under `/api/admin/audit`, read-only, with `audit.view`. */
export class AuditLogRoute implements IRoute {
  readonly path = '/audit'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: AuditLogController) {
    this.router.use(requirePermission('audit.view')).get('/', c.list).get('/actors', c.actors)
  }
}
