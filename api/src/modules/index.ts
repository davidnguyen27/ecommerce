import type { AppDeps } from '../app.ts'
import type { BaseModule } from '../core/module/base.module.ts'
import { AttributeSchemaModule } from './attribute-schema/index.ts'
import { BrandModule } from './brand/index.ts'
import { CategoryModule } from './category/index.ts'
import { CommitmentTypeModule } from './commitment-type/index.ts'
import { OrderModule } from './order/index.ts'

/**
 * Builds every module in dependency order: a module that needs another's query interface is built after it and gets
 * it in its constructor.
 */
export function createModules(deps: AppDeps): BaseModule[] {
  return [
    new AttributeSchemaModule(deps),
    new CategoryModule(deps),
    new BrandModule(deps),
    new CommitmentTypeModule(deps),
    new OrderModule(deps),
  ]
}
