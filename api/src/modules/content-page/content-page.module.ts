import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { ContentPageController } from './content-page.controller.ts'
import { ContentPageRepository } from './content-page.repository.ts'
import { ContentPageAdminRoute, ContentPagePublicRoute } from './content-page.route.ts'
import { ContentPageService } from './content-page.service.ts'

/** Wires repository → service → controller → routes. Other modules read published versions through `index.ts`. */
export class ContentPageModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    const controller = new ContentPageController(new ContentPageService(deps.prisma, new ContentPageRepository()))
    this.routes = [new ContentPageAdminRoute(controller), new ContentPagePublicRoute(controller)]
  }
}
