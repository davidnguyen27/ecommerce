import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { LegalInfoController } from './legal-info.controller.ts'

/** Editing legal info under `/api/admin/legal-info` needs `content.edit`: it is published content like policy pages. */
export class LegalInfoAdminRoute implements IRoute {
  readonly path = '/legal-info'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: LegalInfoController) {
    this.router.use(requirePermission('content.edit')).get('/', c.get).put('/', c.save)
  }
}

/** Customers read legal info for the footer under `/api/legal-info`. */
export class LegalInfoPublicRoute implements IRoute {
  readonly path = '/legal-info'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: LegalInfoController) {
    this.router.get('/', c.get)
  }
}
