import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { CommitmentTypeController } from './commitment-type.controller.ts'
import type { ICommitmentTypeQuery } from './commitment-type.interface.ts'
import { CommitmentTypeRepository } from './commitment-type.repository.ts'
import { CommitmentTypeAdminRoute } from './commitment-type.route.ts'
import { CommitmentTypeService } from './commitment-type.service.ts'

/** Wires repository → service → controller → routes. Other modules use `query`. */
export class CommitmentTypeModule extends BaseModule {
  readonly routes: readonly IRoute[]
  readonly query: ICommitmentTypeQuery

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    const service = new CommitmentTypeService(deps.prisma, new CommitmentTypeRepository())
    this.routes = [new CommitmentTypeAdminRoute(new CommitmentTypeController(service))]
    this.query = service
  }
}
