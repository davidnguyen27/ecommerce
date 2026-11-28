import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { LegalInfoController } from './legal-info.controller.ts'
import { LegalInfoRepository } from './legal-info.repository.ts'
import { LegalInfoAdminRoute, LegalInfoPublicRoute } from './legal-info.route.ts'
import { LegalInfoService } from './legal-info.service.ts'

/** Wires repository → service → controller → routes. */
export class LegalInfoModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    const controller = new LegalInfoController(new LegalInfoService(deps.prisma, new LegalInfoRepository()))
    this.routes = [new LegalInfoAdminRoute(controller), new LegalInfoPublicRoute(controller)]
  }
}
