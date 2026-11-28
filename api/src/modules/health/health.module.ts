import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { HealthController } from './health.controller.ts'
import { HealthRoute } from './health.route.ts'
import { HealthService } from './health.service.ts'

/** Not in `createModules`: its route lives at the root, not under `/api`. No repository: one `SELECT 1`. */
export class HealthModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    this.routes = [new HealthRoute(new HealthController(new HealthService(deps.prisma)))]
  }
}
