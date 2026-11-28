import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { ContentPageController } from './content-page.controller.ts'

/** Draft and publish content pages under `/api/admin/pages`; every route needs `content.edit`. */
export class ContentPageAdminRoute implements IRoute {
  readonly path = '/pages'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ContentPageController) {
    this.router
      .use(requirePermission('content.edit'))
      .get('/', c.list)
      .post('/', c.create)
      .get('/:id', c.detail)
      .put('/:id', c.update)
      .post('/:id/publish', c.publish)
      .get('/:id/versions', c.versions)
      .get('/:id/versions/:version', c.version)
  }
}

/** Customers read content pages under `/api/pages`; only published versions, never drafts. */
export class ContentPagePublicRoute implements IRoute {
  readonly path = '/pages'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: ContentPageController) {
    this.router.get('/', c.publicList).get('/:slug', c.publicPage)
  }
}
