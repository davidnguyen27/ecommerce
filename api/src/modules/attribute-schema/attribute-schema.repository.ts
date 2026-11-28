import type { AttributeDefinition, ProductType } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import { Prisma } from '../../generated/prisma/client.ts'

/** Attribute schema rows (one per product type) and the products they constrain. Every method takes `db`. */
export class AttributeSchemaRepository {
  findOrThrow(db: DbClient, productType: ProductType) {
    return db.attributeSchema.findUniqueOrThrow({ where: { productType } })
  }

  async lock(tx: Prisma.TransactionClient, productType: ProductType, mode: 'update' | 'share') {
    const lock = Prisma.raw(mode === 'update' ? 'FOR UPDATE' : 'FOR SHARE')
    await tx.$executeRaw`SELECT 1 FROM "attribute_schema" WHERE "product_type" = ${productType}::"product_type" ${lock}`
  }

  async update(tx: Prisma.TransactionClient, productType: ProductType, attributes: AttributeDefinition[]) {
    await tx.attributeSchema.update({ where: { productType }, data: { attributes } })
  }

  /** Products of the type (drafts and archived too) with their own and variant attributes. */
  productsOfType(tx: Prisma.TransactionClient, productType: ProductType) {
    return tx.product.findMany({
      where: { productType },
      select: { id: true, name: true, attributes: true, variants: { select: { attributes: true } } },
      orderBy: { name: 'asc' },
    })
  }
}
