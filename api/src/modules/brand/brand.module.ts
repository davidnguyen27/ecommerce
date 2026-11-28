import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { BrandController } from './brand.controller.ts'
import type { IBrandQuery } from './brand.interface.ts'
import { BrandRepository } from './brand.repository.ts'
import { BrandAdminRoute, BrandPublicRoute } from './brand.route.ts'
import { BrandService } from './brand.service.ts'

/** Wires repository → service → controller → routes. Other modules use `query`. */
export class BrandModule extends BaseModule {
  readonly routes: readonly IRoute[]
  readonly query: IBrandQuery

  constructor(deps: Pick<AppDeps, 'prisma' | 'storage'>) {
    super()
    const service = new BrandService(deps.prisma, new BrandRepository(), deps.storage)
    const controller = new BrandController(service, deps.storage)
    this.routes = [new BrandAdminRoute(controller), new BrandPublicRoute(controller)]
    this.query = service
  }
}
