import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { ReportController } from './report.controller.ts'
import { ReportRoute } from './report.route.ts'
import { ReportService } from './report.service.ts'

/** Wires service → controller → routes. No repository: each report is its own SQL in `report-*.ts`. */
export class ReportModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    this.routes = [new ReportRoute(new ReportController(new ReportService(deps.prisma)))]
  }
}
