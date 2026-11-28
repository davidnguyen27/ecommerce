import { isDeepStrictEqual } from 'node:util'
import {
  SizeChart,
  type AdminCommitment,
  type AdminProduct,
  type AdminProductDetail,
  type AdminProductDocument,
  type AdminProductImage,
  type AdminProductSummary,
  type AdminVariant,
  type AttributeValues,
  type FieldError,
  type PublicCommitment,
} from '@ecommerce/shared'
import type { Storage } from '../../core/adapters/storage.ts'
import type { AuditEntry } from '../../core/audit/audited.ts'
import { imageRenditions, type StoredImage } from '../../core/media/images.ts'
import type {
  CommitmentType,
  Product,
  ProductCommitment,
  ProductDocument,
  ProductImage,
  ProductVariant,
} from '../../generated/prisma/client.ts'
import { AttributeValuesShape, ProductSnapshot } from './product.model.ts'
import type { CommitmentWithEvidence, Draft, ImageWithVariants, ProductListRow } from './product.repository.ts'

// ===== Products and variants =====

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

export function toAdminProductSummary(p: ProductListRow): AdminProductSummary {
  return {
    id: p.id,
    productType: p.productType,
    name: p.name,
    slug: p.slug,
    modelCode: p.modelCode,
    brand: p.brand,
    category: p.category,
    status: p.status,
    variantCount: p._count.variants,
    updatedAt: p.updatedAt.toISOString(),
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

// ===== Publication =====

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
    attributes: AttributeValuesShape.parse(draft.attributes),
    groundShippingOnly: draft.groundShippingOnly,
    variants: active.map((v) => ({
      id: v.id,
      sku: v.sku,
      attributes: AttributeValuesShape.parse(v.attributes),
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

/** Status and the version customers see, recorded in audit on transitions. */
export const lifecycle = (draft: Draft) => ({ status: draft.status, liveVersion: draft.liveVersion?.version ?? null })

// ===== Images =====

export const storedImageOf = (image: ProductImage): StoredImage => ({
  key: image.storageKey,
  contentType: image.contentType,
  width: image.width,
  height: image.height,
  widths: image.widths,
})

export const variantIdsOf = (image: ImageWithVariants) => image.variants.map((v) => v.variantId).sort()

/** Image business fields recorded in audit. */
export function imageAuditFields(image: ImageWithVariants) {
  const { productId, storageKey, contentType, width, height, alt, sortOrder } = image
  return { productId, storageKey, contentType, width, height, alt, sortOrder, variantIds: variantIdsOf(image) }
}

export function toAdminImage(storage: Storage, image: ImageWithVariants): AdminProductImage {
  return {
    id: image.id,
    ...imageRenditions(storage, storedImageOf(image)),
    alt: image.alt,
    sortOrder: image.sortOrder,
    variantIds: variantIdsOf(image),
  }
}

// ===== Documents =====

/** Document business fields recorded in audit. */
export function documentAuditFields(document: ProductDocument) {
  const { productId, storageKey, fileName, contentType, sizeBytes } = document
  return { productId, storageKey, fileName, contentType, sizeBytes }
}

export function toAdminDocument(document: ProductDocument): AdminProductDocument {
  return {
    id: document.id,
    fileName: document.fileName,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    createdAt: document.createdAt.toISOString(),
  }
}

// ===== Commitments =====

export const documentIdsOf = (commitment: CommitmentWithEvidence) => commitment.documents.map((d) => d.documentId)

/** Commitment business fields recorded in audit. */
export function commitmentAuditFields(commitment: CommitmentWithEvidence) {
  const { productId, typeId, statement } = commitment
  return { productId, typeId, statement, documentIds: documentIdsOf(commitment) }
}

export function toAdminCommitment(commitment: CommitmentWithEvidence): AdminCommitment {
  return {
    id: commitment.id,
    typeId: commitment.typeId,
    typeName: commitment.type.name,
    kind: commitment.type.kind,
    statement: commitment.statement,
    documentIds: documentIdsOf(commitment),
  }
}

/**
 * Evidenced commitments as customers see them: type and content, never documents. Copied into the snapshot on
 * publish; warranty appears only here, as a commitment with `kind: 'warranty'` (ADR 0005).
 */
export const toPublicCommitment = (c: ProductCommitment & { type: CommitmentType }): PublicCommitment => ({
  type: c.type.name,
  kind: c.type.kind,
  statement: c.statement,
})
