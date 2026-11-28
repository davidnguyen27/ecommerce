import type { AttributeDefinition, ProductType } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

/** A product type's current attribute schema. */
export type LoadedSchema = { productType: ProductType; attributes: AttributeDefinition[]; updatedAt: Date }

/** What other modules (products, import, chatbot) may ask of the attribute schema module. */
export interface IAttributeSchemaQuery {
  /** The seed migration covers all five types, so it always exists. */
  load(db: DbClient, productType: ProductType): Promise<LoadedSchema>
  /**
   * Like `load`, but locks the schema row until the transaction ends: schema edits use `update`, product writes
   * `share`, so no product slips past the violation check while the schema changes.
   */
  lock(tx: Prisma.TransactionClient, productType: ProductType, mode: 'update' | 'share'): Promise<LoadedSchema>
}
