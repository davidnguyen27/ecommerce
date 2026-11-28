import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { ProductType, PublicCommitment, SizeChart, type AdminProductDetail, type FieldError } from '@ecommerce/shared'
import type { DbClient } from '../core/db.ts'
import { COMMITMENTS_WITH_TYPE, toPublicCommitment } from './commitments.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { StoredImage } from '../core/media/images.ts'
import { SORT_ORDER, productNotFound, toAdminProduct, toAdminVariant, toNumber } from './products.ts'

const Values = z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]))

/**
 * Everything customers see of a product at publish time. Public endpoints read only this (CODING_STANDARDS
 * "Snapshot đã xuất bản"), evidenced commitments included; brand and category names, policy page titles and attribute
 * labels are read from their own tables.
 */
export const ProductSnapshot = z.object({
  productType: ProductType,
  brandId: z.string(),
  categoryId: z.string(),
  name: z.string(),
  slug: z.string(),
  modelCode: z.string(),
  description: z.string(),
  usageCare: z.string(),
  sizeChart: SizeChart.nullable(),
  originStatement: z.string(),
  attributes: Values,
  groundShippingOnly: z.boolean(),
  /** Only variants on sale, in display order. */
  variants: z.array(
    z.object({
      id: z.string(),
      sku: z.string(),
      attributes: Values,
      price: z.number(),
      compareAtPrice: z.number().nullable(),
    }),
  ),
  /** In display order; `variantIds` holds only variants on sale, empty means a shared image. */
  images: z.array(StoredImage.extend({ id: z.string(), alt: z.string(), variantIds: z.array(z.string()) })),
  policyPageIds: z.array(z.string()),
  /** Evidenced commitments as shown; versions published before this field existed have none. */
  commitments: z.array(PublicCommitment).default([]),
})
export type ProductSnapshot = z.infer<typeof ProductSnapshot>

/** The product's draft, enough to build a snapshot. */
export async function loadDraft(db: DbClient, id: string) {
  const product = await db.product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: [...SORT_ORDER] },
      images: { orderBy: [...SORT_ORDER], include: { variants: { select: { variantId: true } } } },
      policyPages: { select: { pageId: true } },
      commitments: COMMITMENTS_WITH_TYPE,
      liveVersion: true,
    },
  })
  if (!product) throw productNotFound()
  return product
}
export type Draft = Awaited<ReturnType<typeof loadDraft>>

/** Reasons it cannot be published yet; empty means ready. */
export function publishBlockers(draft: Draft): FieldError[] {
  const blockers: FieldError[] = []
  const active = draft.variants.filter((v) => v.status === 'active')
  if (active.length === 0) blockers.push({ path: 'variants', message: 'Cần ít nhất một biến thể đang bán' })
  draft.variants.forEach((variant, index) => {
    if (variant.status === 'active' && variant.price === null) {
      blockers.push({ path: `variants.${index}.price`, message: `Biến thể ${variant.sku} đang bán nhưng chưa có giá` })
    }
  })
  if (draft.images.length === 0) blockers.push({ path: 'images', message: 'Cần ít nhất một ảnh' })
  return blockers
}

/** Snapshot built from the draft; call only when `publishBlockers` is empty (every variant on sale has a price). */
export function buildSnapshot(draft: Draft): ProductSnapshot {
  const active = draft.variants.filter((v) => v.status === 'active')
  const activeIds = new Set(active.map((v) => v.id))
  return {
    productType: draft.productType,
    brandId: draft.brandId,
    categoryId: draft.categoryId,
    name: draft.name,
    slug: draft.slug,
    modelCode: draft.modelCode,
    description: draft.description,
    usageCare: draft.usageCare,
    sizeChart: draft.sizeChart === null ? null : SizeChart.parse(draft.sizeChart),
    originStatement: draft.originStatement,
    attributes: Values.parse(draft.attributes),
    groundShippingOnly: draft.groundShippingOnly,
    variants: active.map((v) => ({
      id: v.id,
      sku: v.sku,
      attributes: Values.parse(v.attributes),
      price: toNumber(v.price) ?? 0,
      compareAtPrice: toNumber(v.compareAtPrice),
    })),
    images: draft.images.flatMap((image) => {
      const linked = image.variants.map((v) => v.variantId)
      const variantIds = linked.filter((id) => activeIds.has(id)).sort()
      // Images tied only to discontinued variants are not shown and must not become shared images.
      if (linked.length > 0 && variantIds.length === 0) return []
      const { id, storageKey: key, contentType, width, height, widths, alt } = image
      return [{ id, key, contentType, width, height, widths, alt, variantIds }]
    }),
    policyPageIds: draft.policyPages.map((p) => p.pageId).sort(),
    commitments: draft.commitments.map(toPublicCommitment),
  }
}

export const liveSnapshot = (draft: Draft) =>
  draft.liveVersion ? ProductSnapshot.parse(draft.liveVersion.snapshot) : null

/** The cheapest variant; ties go to the earlier one. */
export function cheapestVariant(snapshot: ProductSnapshot) {
  return snapshot.variants.reduce((min, v) => (v.price < min.price ? v : min))
}

/** Creates a new version from the snapshot. Call under the product row lock so version numbers do not race. */
export async function createVersion(
  tx: Prisma.TransactionClient,
  productId: string,
  snapshot: ProductSnapshot,
  publishedById: string,
) {
  const last = await tx.productVersion.findFirst({ where: { productId }, orderBy: { version: 'desc' } })
  const cheapest = cheapestVariant(snapshot)
  return tx.productVersion.create({
    data: {
      productId,
      version: (last?.version ?? 0) + 1,
      slug: snapshot.slug,
      productType: snapshot.productType,
      brandId: snapshot.brandId,
      categoryId: snapshot.categoryId,
      fromPrice: cheapest.price,
      fromCompareAtPrice: cheapest.compareAtPrice,
      snapshot,
      publishedById,
    },
  })
}

/** The version customers currently see, with its snapshot; null when unpublished. */
export async function loadLiveVersion(db: DbClient, liveVersionId: string | null) {
  if (liveVersionId === null) return null
  const version = await db.productVersion.findUniqueOrThrow({ where: { id: liveVersionId } })
  return { version: version.version, snapshot: ProductSnapshot.parse(version.snapshot) }
}

/**
 * Price changes apply to customers at once, without republishing: the new version copies the live one and only swaps
 * that variant's price, so draft content stays hidden. Call under the product row lock.
 */
export async function publishPrice(
  tx: Prisma.TransactionClient,
  productId: string,
  live: ProductSnapshot,
  variant: { id: string; price: number; compareAtPrice: number | null },
  publishedById: string,
) {
  const snapshot: ProductSnapshot = {
    ...live,
    variants: live.variants.map((v) =>
      v.id === variant.id ? { ...v, price: variant.price, compareAtPrice: variant.compareAtPrice } : v,
    ),
  }
  const version = await createVersion(tx, productId, snapshot, publishedById)
  await tx.product.update({ where: { id: productId }, data: { liveVersionId: version.id } })
  return version
}

/** Has unpublished changes: the draft's snapshot differs from the live version. */
export function hasUnpublishedChanges(draft: Draft) {
  const live = liveSnapshot(draft)
  return live !== null && !isDeepStrictEqual(live, buildSnapshot(draft))
}

export function toAdminProductDetail(draft: Draft): AdminProductDetail {
  return {
    ...toAdminProduct(draft),
    variants: draft.variants.map((v) => ({ ...toAdminVariant(v), onHand: v.onHand })),
    policyPageIds: draft.policyPages.map((p) => p.pageId).sort(),
    liveVersion: draft.liveVersion && {
      version: draft.liveVersion.version,
      publishedAt: draft.liveVersion.publishedAt.toISOString(),
    },
    hasUnpublishedChanges: hasUnpublishedChanges(draft),
  }
}

/** Images in the live version; their files must stay in storage even if the draft removed them. */
export function liveImages(draft: Draft): StoredImage[] {
  return liveSnapshot(draft)?.images ?? []
}
