import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import { validate } from '../../core/middleware/validation.ts'
import type { CategoryController } from './category.controller.ts'
import { CreateCategoryDto, UpdateCategoryDto } from './dto/index.ts'

/** Category tree management under `/api/admin/categories`; every route needs `catalog.edit`. */
export class CategoryAdminRoute implements IRoute {
  readonly path = '/categories'
  readonly access = 'staff'
  readonly router = Router()

  constructor(controller: CategoryController) {
    this.router
      .use(requirePermission('catalog.edit'))
      .get('/', controller.list)
      .post('/', validate(CreateCategoryDto), controller.createItem)
      .put('/:id', validate(UpdateCategoryDto), controller.updateItem)
      .post('/:id/hide', controller.hide)
      .post('/:id/unhide', controller.unhide)
      .delete('/:id', controller.deleteItem)
  }
}

/** Customers browse the tree under `/api/categories`; hidden categories and everything under them count as missing. */
export class CategoryPublicRoute implements IRoute {
  readonly path = '/categories'
  readonly access = 'public'
  readonly router = Router()

  constructor(controller: CategoryController) {
    this.router.get('/', controller.tree).get('/:slug', controller.bySlug)
  }
}
