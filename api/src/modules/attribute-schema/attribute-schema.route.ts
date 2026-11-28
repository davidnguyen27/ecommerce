import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { AttributeSchemaController } from './attribute-schema.controller.ts'

/** View and edit attribute schemas under `/api/admin/attribute-schemas`; every route needs `catalog.edit`. */
export class AttributeSchemaAdminRoute implements IRoute {
  readonly path = '/attribute-schemas'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: AttributeSchemaController) {
    this.router
      .use(requirePermission('catalog.edit'))
      .get('/', c.list)
      .get('/:productType', c.get)
      .put('/:productType', c.update)
      .post('/:productType/validate', c.validate)
  }
}

/** A product type's attribute schema under `/api/attribute-schemas`, for website labels and filters. */
export class AttributeSchemaPublicRoute implements IRoute {
  readonly path = '/attribute-schemas'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: AttributeSchemaController) {
    this.router.get('/:productType', c.publicGet)
  }
}
