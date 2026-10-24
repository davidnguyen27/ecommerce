import { ErrorCode, SizeChart, type AdminProduct, type AdminVariant, type AttributeValues } from '@ecommerce/shared'
import { z } from 'zod'
import type { DbClient } from '../db.ts'
import type { Prisma, Product, ProductVariant } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'

export const ProductParams = z.object({ id: z.uuid() })

/** Thứ tự hiển thị của biến thể và ảnh. */
export const SORT_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }] as const

export const productNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy sản phẩm')

/** Sản phẩm kèm biến thể theo thứ tự hiển thị; không có thì 404. */
export async function loadProduct(db: DbClient, id: string) {
  const product = await db.product.findUnique({
    where: { id },
    include: { variants: { orderBy: [...SORT_ORDER] } },
  })
  if (!product) throw productNotFound()
  return product
}

/**
 * Khóa dòng sản phẩm tới hết transaction, để thao tác trên biến thể của cùng sản phẩm xếp hàng:
 * bất biến trải trên nhiều biến thể (còn biến thể đang bán, tổ hợp không trùng) không bị hai request cùng lọt qua.
 */
export async function lockProduct(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT 1 FROM "product" WHERE "id" = ${id}::uuid FOR UPDATE`
  return loadProduct(tx, id)
}

/** Giá lưu BIGINT; số VND vẫn nằm trong khoảng số nguyên an toàn của JS. */
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

/** Trường nghiệp vụ của sản phẩm, cũng là phần ghi vào audit. */
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

/** Trường nghiệp vụ của biến thể ghi vào audit, trừ giá: đổi giá có bản audit `price.change` riêng. */
export function variantAuditFields(variant: ProductVariant) {
  const { sku, attributes, status, sortOrder } = toAdminVariant(variant)
  return { productId: variant.productId, sku, attributes, status, sortOrder }
}

/** Giá của biến thể ghi vào audit `price.change`. */
export function priceAuditFields(variant: Pick<ProductVariant, 'productId' | 'sku' | 'price' | 'compareAtPrice'>) {
  return {
    productId: variant.productId,
    sku: variant.sku,
    price: toNumber(variant.price),
    compareAtPrice: toNumber(variant.compareAtPrice),
  }
}
