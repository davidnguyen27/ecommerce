import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { CategoryController } from './category.controller.ts'
import { CategoryQuery } from './category.query.ts'
import type { ICategoryQuery } from './category.interface.ts'
import { CategoryRepository } from './category.repository.ts'
import { CategoryAdminRoute, CategoryPublicRoute } from './category.route.ts'
import { CategoryService } from './category.service.ts'

/** Wires repository → service → controller → routes. Products and the sitemap use `query`. */
export class CategoryModule extends BaseModule {
  readonly routes: readonly IRoute[]
  readonly query: ICategoryQuery

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    const repo = new CategoryRepository()
    const query = new CategoryQuery(repo)
    const service = new CategoryService(deps.prisma, repo, query)
    const controller = new CategoryController(service)
    this.routes = [new CategoryAdminRoute(controller), new CategoryPublicRoute(controller)]
    this.query = query
  }
}

/**
 * The category query for code outside `modules/` that has no module wiring yet (old product and sitemap routes). It
 * reads only through the `db` it is given, so one shared instance is safe. Removed once those move (ticket 04, 09).
 */
export const categoryQuery: ICategoryQuery = new CategoryQuery(new CategoryRepository())
