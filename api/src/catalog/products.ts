import { ErrorCode, SizeChart, type AdminProduct, type AdminVariant, type AttributeValues } from '@ecommerce/shared'
import { z } from 'zod'
import type { AuditEntry } from '../core/audit/audited.ts'
import type { DbClient } from '../core/db.ts'
import type { Prisma, Product, ProductVariant } from '../generated/prisma/client.ts'
import { AppError } from '../core/errors.ts'

export const ProductParams = z.object({ id: z.uuid() })

/** Display order of variants and images. */
export const SORT_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }] as const

export const productNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy sản phẩm')

/** A product with variants in display order; 404 if missing. */
export async function loadProduct(db: DbClient, id: string) {
  const product = await db.product.findUnique({
    where: { id },
    include: { variants: { orderBy: [...SORT_ORDER] } },
  })
  if (!product) throw productNotFound()
  return product
}

/**
 * Locks the product row until the transaction ends, so operations on its variants queue up: invariants spanning
 * variants (one still on sale, no duplicate combinations) cannot be passed by two requests at once.
 */
export async function lockProduct(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "product" WHERE "id" = ${id}::uuid FOR UPDATE`
  return loadProduct(tx, id)
}

/** Prices are BIGINT; VND amounts stay within JS safe integers. */
export const toNumber = (value: bigint | null | undefined) => (value == null ? null : Number(value))

export function toAdminVariant(variant: ProductVariant): AdminVariant {
  return {
    id: variant.id,
    sku: variant.sku,
    attributes: variant.attributes as AttributeValues,
    price: toNumber(variant.price),
    compareAtPrice: toNumber(variant.compareAtPrice),
    status: variant.status,
    sortOrder: variant.sortOrder,
  }
}

export function toAdminProduct(product: Product & { variants: ProductVariant[] }): AdminProduct {
  return {
    id: product.id,
    ...productAuditFields(product),
    updatedAt: product.updatedAt.toISOString(),
    variants: product.variants.map(toAdminVariant),
  }
}

/** Business fields of a product, also what the audit records. */
export function productAuditFields(product: Product) {
  return {
    productType: product.productType,
    brandId: product.brandId,
    categoryId: product.categoryId,
    name: product.name,
    slug: product.slug,
    modelCode: product.modelCode,
    description: product.description,
    usageCare: product.usageCare,
    sizeChart: product.sizeChart === null ? null : SizeChart.parse(product.sizeChart),
    originStatement: product.originStatement,
    attributes: product.attributes as AttributeValues,
    groundShippingOnly: product.groundShippingOnly,
    status: product.status,
  }
}

/** Variant business fields recorded in audit, except price: price changes get their own `price.change` entry. */
export function variantAuditFields(variant: ProductVariant) {
  const { sku, attributes, status, sortOrder } = toAdminVariant(variant)
  return { productId: variant.productId, sku, attributes, status, sortOrder }
}

/** Audit on variant creation; a set price adds `price.change` from empty, so price history has a starting point. */
export function variantCreatedAudits(variant: ProductVariant): AuditEntry[] {
  const entries: AuditEntry[] = [
    {
      action: 'catalog.variant.create',
      entityType: 'product_variant',
      entityId: variant.id,
      after: variantAuditFields(variant),
    },
  ]
  if (variant.price !== null || variant.compareAtPrice !== null) {
    entries.push({
      action: 'price.change',
      entityType: 'product_variant',
      entityId: variant.id,
      before: priceAuditFields({ ...variant, price: null, compareAtPrice: null }),
      after: priceAuditFields(variant),
    })
  }
  return entries
}

/** Variant price recorded in the `price.change` audit. */
export function priceAuditFields(variant: Pick<ProductVariant, 'productId' | 'sku' | 'price' | 'compareAtPrice'>) {
  return {
    productId: variant.productId,
    sku: variant.sku,
    price: toNumber(variant.price),
    compareAtPrice: toNumber(variant.compareAtPrice),
  }
}
