import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { ReturnWindowController } from './return-window.controller.ts'
import { ReturnWindowRepository } from './return-window.repository.ts'
import { ReturnWindowRoute } from './return-window.route.ts'
import { ReturnWindowService } from './return-window.service.ts'

/** Wires repository → service → controller → routes. */
export class ReturnWindowModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    const service = new ReturnWindowService(deps.prisma, new ReturnWindowRepository())
    this.routes = [new ReturnWindowRoute(new ReturnWindowController(service))]
  }
}
