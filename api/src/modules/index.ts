import type { AppDeps } from '../app.ts'
import type { BaseModule } from '../core/module/base.module.ts'
import { AttributeSchemaModule } from './attribute-schema/index.ts'
import { BrandModule } from './brand/index.ts'
import { CategoryModule } from './category/index.ts'
import { CommitmentTypeModule } from './commitment-type/index.ts'
import { OrderModule } from './order/index.ts'
import { ProductModule } from './product/index.ts'
import { ProductImportModule } from './product-import/index.ts'

/**
 * Builds every module in dependency order: a module that needs another's query interface is built after it and gets
 * it in its constructor. Routes mount in this order.
 */
export function createModules(deps: AppDeps): BaseModule[] {
  const schemas = new AttributeSchemaModule(deps)
  const categories = new CategoryModule(deps)
  return [
    schemas,
    categories,
    new BrandModule(deps),
    new CommitmentTypeModule(deps),
    new ProductModule(deps, { schemas: schemas.query, categories: categories.query }),
    new ProductImportModule(deps),
    new OrderModule(deps),
  ]
}
