// The product module's public surface (ADR 0018): the module, its query, and what other code reads of products.
import type { DbClient } from '../../core/db.ts'
import type { CartVariant } from './product.interface.ts'
import { readCartVariants } from './product.query.ts'
import { ProductRepository } from './product.repository.ts'

export { ProductModule, type ProductModuleDeps } from './product.module.ts'
export type { CartVariant, IProductQuery, VariantActor } from './product.interface.ts'
export { ProductSnapshot } from './product.model.ts'
export type { SearchCriteria } from './product-search.repository.ts'
export { productAuditFields, variantCreatedAudits } from './product.mapper.ts'

const cartRepository = new ProductRepository()

/**
 * Cart lines' variants from the live versions, for checkout, pre-orders and exchanges in their own transactions.
 * Reads only through `db`, so it needs no module wiring (CODING_STANDARDS "Module").
 */
export function cartVariants(db: DbClient, variantIds: readonly string[]): Promise<Map<string, CartVariant>> {
  return readCartVariants(cartRepository, db, variantIds)
}
