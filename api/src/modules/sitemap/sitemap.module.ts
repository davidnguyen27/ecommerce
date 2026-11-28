import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { ICategoryQuery } from '../category/index.ts'
import { SitemapController } from './sitemap.controller.ts'
import { SitemapRepository } from './sitemap.repository.ts'
import { SitemapRoute } from './sitemap.route.ts'
import { SitemapService } from './sitemap.service.ts'

/** Wires repository → service → controller → routes; categories come from the category module's query. */
export class SitemapModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>, categories: ICategoryQuery) {
    super()
    const service = new SitemapService(deps.prisma, new SitemapRepository(), categories)
    this.routes = [new SitemapRoute(new SitemapController(service))]
  }
}
