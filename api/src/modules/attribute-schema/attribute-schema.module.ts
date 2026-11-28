import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { AttributeSchemaController } from './attribute-schema.controller.ts'
import type { IAttributeSchemaQuery } from './attribute-schema.interface.ts'
import { AttributeSchemaQuery } from './attribute-schema.query.ts'
import { AttributeSchemaRepository } from './attribute-schema.repository.ts'
import { AttributeSchemaAdminRoute, AttributeSchemaPublicRoute } from './attribute-schema.route.ts'
import { AttributeSchemaService } from './attribute-schema.service.ts'

/** Wires repository → query and service → controller → routes. Products, import and the chatbot use `query`. */
export class AttributeSchemaModule extends BaseModule {
  readonly routes: readonly IRoute[]
  readonly query: IAttributeSchemaQuery

  constructor(deps: Pick<AppDeps, 'prisma'>) {
    super()
    const repo = new AttributeSchemaRepository()
    const query = new AttributeSchemaQuery(repo)
    const controller = new AttributeSchemaController(new AttributeSchemaService(deps.prisma, repo, query))
    this.routes = [new AttributeSchemaAdminRoute(controller), new AttributeSchemaPublicRoute(controller)]
    this.query = query
  }
}
