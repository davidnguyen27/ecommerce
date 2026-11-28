import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { AuditLogController } from './audit-log.controller.ts'
import { AuditLogRepository } from './audit-log.repository.ts'
import { AuditLogRoute } from './audit-log.route.ts'
import { AuditLogService } from './audit-log.service.ts'

/** Wires repository → service → controller → routes. Writing audit is `core/audit/audited.ts`, not this module. */
export class AuditLogModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    this.routes = [
      new AuditLogRoute(new AuditLogController(new AuditLogService(deps.prisma, new AuditLogRepository()))),
    ]
  }
}
