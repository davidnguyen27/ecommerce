import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { StaffController } from './staff.controller.ts'
import { StaffRepository } from './staff.repository.ts'
import { StaffRoute } from './staff.route.ts'
import { StaffService } from './staff.service.ts'

/** Wires repository → service → controller → routes. */
export class StaffModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    this.routes = [new StaffRoute(new StaffController(new StaffService(deps.prisma, new StaffRepository())))]
  }
}
