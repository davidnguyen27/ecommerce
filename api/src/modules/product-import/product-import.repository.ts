import type { Prisma } from '../../generated/prisma/client.ts'

/** Writes of an import, all in the caller's transaction. */
export class ProductImportRepository {
  /** Keeps attribute schemas, brands and categories still until the transaction ends, as single product writes do. */
  async lockReferences(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT 1 FROM "attribute_schema" FOR SHARE`
    await tx.$executeRaw`SELECT 1 FROM "brand" FOR KEY SHARE`
    await tx.$executeRaw`SELECT 1 FROM "category" FOR KEY SHARE`
  }

  async createProducts(
    tx: Prisma.TransactionClient,
    products: Prisma.ProductCreateManyInput[],
    variants: Prisma.ProductVariantCreateManyInput[],
  ) {
    await tx.product.createMany({ data: products })
    await tx.productVariant.createMany({ data: variants })
  }

  createdProducts(tx: Prisma.TransactionClient, ids: string[]) {
    return tx.product.findMany({ where: { id: { in: ids } }, include: { variants: { orderBy: { sortOrder: 'asc' } } } })
  }

  variantIdsBySku(tx: Prisma.TransactionClient, skus: string[]) {
    return tx.productVariant.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } })
  }

  /** Variants that already have a stock ledger row. */
  ledgeredVariants(tx: Prisma.TransactionClient, variantIds: string[]) {
    return tx.stockMovement.findMany({
      where: { variantId: { in: variantIds } },
      select: { variantId: true },
      distinct: ['variantId'],
    })
  }
}
