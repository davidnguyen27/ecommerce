import { isDeepStrictEqual } from 'node:util'
import type { z } from 'zod'
import { ErrorCode, VariantRequest, type AdminVariant, type AttributeValues } from '@ecommerce/shared'
import type { Audit } from '../core/audit/audited.ts'
import { forbidden } from '../core/middleware/staff-context.ts'
import type { Prisma, ProductVariant } from '../generated/prisma/client.ts'
import { AppError, conflictField, invalidField, rethrowUnique } from '../core/errors.ts'
import { attributeSchemaQuery, assertAttributes } from '../modules/attribute-schema/index.ts'
import {
  lockProduct,
  priceAuditFields,
  toAdminVariant,
  toNumber,
  variantAuditFields,
  variantCreatedAudits,
} from './products.ts'
import { loadLiveVersion, publishPrice } from './publication.ts'

// Admin variant writes, run inside `audited()` under the product row lock.

/** Who edits and what they may change; built by the route from the staff session. */
export type VariantActor = { staffId: string; canEditCatalog: boolean; canEditPrice: boolean }

const skuTaken = () => conflictField('sku', 'SKU này đã có biến thể khác dùng')

type VariantInput = z.output<typeof VariantRequest>
type LockedProduct = Awaited<ReturnType<typeof lockProduct>>
type VariantFields = Pick<ProductVariant, 'sku' | 'status' | 'sortOrder'> & { attributes: AttributeValues }
type VariantPrice = { price: number | null; compareAtPrice: number | null }

/** Creates a variant (the route requires `catalog.edit`); a price also needs `price.edit` and writes `price.change`. */
export async function createVariant(
  tx: Prisma.TransactionClient,
  audit: Audit,
  actor: VariantActor,
  productId: string,
  input: VariantInput,
): Promise<AdminVariant> {
  const product = await lockProduct(tx, productId)
  const { others, fields } = await resolveFields(tx, product, null, input)
  const price = { price: input.price ?? null, compareAtPrice: input.compareAtPrice ?? null }
  const priced = price.price !== null || price.compareAtPrice !== null
  if (priced && !actor.canEditPrice) throw forbidden()
  // A new variant is not on the website yet: the published version lacks it.
  await assertVariant(tx, product, others, null, fields, price, false)

  const created = await tx.productVariant
    .create({ data: { ...fields, ...price, productId } })
    .catch(rethrowUnique(skuTaken))
  await audit(variantCreatedAudits(created))
  return toAdminVariant(created)
}

/**
 * Updates a variant. SKU, attributes, status and order need `catalog.edit`; a price different from the current one
 * needs `price.edit`, writes its own `price.change` audit, and for variants on the website goes live at once via a new
 * published version.
 */
export async function updateVariant(
  tx: Prisma.TransactionClient,
  audit: Audit,
  actor: VariantActor,
  productId: string,
  variantId: string,
  input: VariantInput,
): Promise<AdminVariant> {
  const product = await lockProduct(tx, productId)
  const before = product.variants.find((v) => v.id === variantId)
  if (!before) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy biến thể')
  const { others, fields } = await resolveFields(tx, product, before, input)
  const price = {
    price: input.price === undefined ? toNumber(before.price) : input.price,
    compareAtPrice: input.compareAtPrice === undefined ? toNumber(before.compareAtPrice) : input.compareAtPrice,
  }
  const current = variantAuditFields(before)
  const fieldsChanged = !isDeepStrictEqual(current, { productId, ...fields })
  const priceChanged =
    price.price !== toNumber(before.price) || price.compareAtPrice !== toNumber(before.compareAtPrice)

  if (fieldsChanged && !actor.canEditCatalog) throw forbidden()
  if (priceChanged && !actor.canEditPrice) throw forbidden()
  if (!fieldsChanged && !priceChanged) return toAdminVariant(before)

  const live = await loadLiveVersion(tx, product.liveVersionId)
  const onWebsite = live?.snapshot.variants.some((v) => v.id === before.id) ?? false
  await assertVariant(tx, product, others, before, fields, price, onWebsite)

  const after = await tx.productVariant
    .update({ where: { id: before.id }, data: { ...fields, ...price } })
    .catch(rethrowUnique(skuTaken))
  if (fieldsChanged) {
    await audit({
      action: 'catalog.variant.update',
      entityType: 'product_variant',
      entityId: after.id,
      before: current,
      after: variantAuditFields(after),
    })
  }
  if (priceChanged) {
    await audit({
      action: 'price.change',
      entityType: 'product_variant',
      entityId: after.id,
      before: priceAuditFields(before),
      after: priceAuditFields(after),
    })
    if (live && onWebsite && price.price !== null) {
      const variant = { id: after.id, price: price.price, compareAtPrice: price.compareAtPrice }
      const version = await publishPrice(tx, productId, live.snapshot, variant, actor.staffId)
      await audit({
        action: 'catalog.product.publish',
        entityType: 'product',
        entityId: productId,
        before: { status: product.status, liveVersion: live.version },
        after: { status: product.status, liveVersion: version.version },
      })
    }
  }
  return toAdminVariant(after)
}

/** Non-price fields after applying `input` to `before` (null on create); attributes are checked under the lock. */
async function resolveFields(
  tx: Prisma.TransactionClient,
  product: LockedProduct,
  before: ProductVariant | null,
  input: VariantInput,
) {
  const others = product.variants.filter((v) => v.id !== before?.id)
  const schema = await attributeSchemaQuery.lock(tx, product.productType, 'share')
  const fields: VariantFields = {
    sku: input.sku,
    attributes: assertAttributes(schema.attributes, 'variant', input.attributes),
    status: input.status,
    sortOrder: input.sortOrder ?? before?.sortOrder ?? Math.max(-1, ...others.map((v) => v.sortOrder)) + 1,
  }
  return { others, fields }
}

/** Business rules of the variant about to be saved; `onWebsite` means it is in the version customers see. */
async function assertVariant(
  tx: Prisma.TransactionClient,
  product: LockedProduct,
  others: ProductVariant[],
  before: ProductVariant | null,
  fields: VariantFields,
  price: VariantPrice,
  onWebsite: boolean,
) {
  if (price.compareAtPrice !== null && (price.price === null || price.compareAtPrice < price.price)) {
    throw invalidField('compareAtPrice', 'Giá hãng phải để trống hoặc không thấp hơn giá bán')
  }
  if (others.some((v) => isDeepStrictEqual(v.attributes, fields.attributes))) {
    throw conflictField('attributes', 'Sản phẩm đã có biến thể với tổ hợp thuộc tính này')
  }
  // Combinations were checked under the product lock; the only unique left to hit is a SKU just taken by another
  // product.
  if (fields.sku !== before?.sku && (await tx.productVariant.findUnique({ where: { sku: fields.sku } }))) {
    throw skuTaken()
  }
  if (product.status !== 'published') return
  const stillSelling = others.some((v) => v.status === 'active')
  if (before?.status === 'active' && fields.status !== 'active' && !stillSelling) {
    throw conflictField(
      'status',
      'Đây là biến thể đang bán cuối cùng của sản phẩm đã xuất bản; muốn thôi bán thì lưu trữ sản phẩm',
    )
  }
  if (price.price === null && (fields.status === 'active' || onWebsite)) {
    throw conflictField('price', 'Biến thể của sản phẩm đã xuất bản phải có giá bán')
  }
}
