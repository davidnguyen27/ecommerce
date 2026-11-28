import { Router } from 'express'
import { receiveImage } from '../../core/media/images.ts'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import { validate } from '../../core/middleware/validation.ts'
import type { BrandController } from './brand.controller.ts'
import { BrandDto } from './dto/index.ts'

/** Brand management under `/api/admin/brands`: logos need `media.upload`, other routes `catalog.edit`. */
export class BrandAdminRoute implements IRoute {
  readonly path = '/brands'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: BrandController) {
    this.router
      // Declared before the shared `catalog.edit` guard below, since logos have their own permission.
      .put('/:id/logo', requirePermission('media.upload'), receiveImage, c.uploadLogo)
      .delete('/:id/logo', requirePermission('media.upload'), c.deleteLogo)
      .use(requirePermission('catalog.edit'))
      .get('/', c.list)
      .post('/', validate(BrandDto), c.createItem)
      .put('/:id', validate(BrandDto), c.updateItem)
      .post('/:id/hide', c.hide)
      .post('/:id/unhide', c.unhide)
  }
}

/** Customers browse brands under `/api/brands`; hidden brands count as missing. */
export class BrandPublicRoute implements IRoute {
  readonly path = '/brands'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: BrandController) {
    this.router.get('/', c.publicList).get('/:slug', c.publicDetail)
  }
}
