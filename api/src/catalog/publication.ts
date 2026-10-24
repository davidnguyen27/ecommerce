import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { ProductType, PublicCommitment, SizeChart, type AdminProductDetail, type FieldError } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { COMMITMENTS_WITH_TYPE, toPublicCommitment } from './commitments.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { StoredImage } from '../media/images.ts'
import { SORT_ORDER, productNotFound, toAdminProduct, toNumber } from './products.ts'

const Values = z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]))

/**
 * Mọi thứ khách thấy của một sản phẩm tại lần xuất bản. Endpoint công khai chỉ đọc từ đây
 * (CODING_STANDARDS "Snapshot đã xuất bản"), kể cả cam kết có bằng chứng; tên thương hiệu, danh mục,
 * tiêu đề trang chính sách và nhãn thuộc tính thì đọc từ chính chúng.
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
  /** Chỉ biến thể đang bán, theo thứ tự hiển thị. */
  variants: z.array(
    z.object({
      id: z.string(),
      sku: z.string(),
      attributes: Values,
      price: z.number(),
      compareAtPrice: z.number().nullable(),
    }),
  ),
  /** Theo thứ tự hiển thị; `variantIds` chỉ gồm biến thể đang bán, rỗng là ảnh chung. */
  images: z.array(StoredImage.extend({ id: z.string(), alt: z.string(), variantIds: z.array(z.string()) })),
  policyPageIds: z.array(z.string()),
  /** Cam kết có bằng chứng như khách thấy; phiên bản xuất bản trước khi có trường này coi như không có cam kết. */
  commitments: z.array(PublicCommitment).default([]),
})
export type ProductSnapshot = z.infer<typeof ProductSnapshot>

/** Bản đang soạn của sản phẩm, đủ để dựng snapshot. */
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

/** Lý do chưa xuất bản được; rỗng là đủ điều kiện. */
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

/** Snapshot dựng từ bản đang soạn; chỉ gọi khi `publishBlockers` rỗng (biến thể đang bán đều có giá). */
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
      // Ảnh chỉ gắn với biến thể ngừng bán thì khách không cần thấy, và không được thành ảnh chung.
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

/** Biến thể có giá thấp nhất; cùng giá thì lấy biến thể đứng trước. */
export function cheapestVariant(snapshot: ProductSnapshot) {
  return snapshot.variants.reduce((min, v) => (v.price < min.price ? v : min))
}

/** Tạo phiên bản mới từ snapshot. Gọi dưới khóa dòng sản phẩm, để số phiên bản không bị hai request tranh nhau. */
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

/** Phiên bản khách đang thấy kèm snapshot; sản phẩm chưa xuất bản thì null. */
export async function loadLiveVersion(db: DbClient, liveVersionId: string | null) {
  if (liveVersionId === null) return null
  const version = await db.productVersion.findUniqueOrThrow({ where: { id: liveVersionId } })
  return { version: version.version, snapshot: ProductSnapshot.parse(version.snapshot) }
}

/**
 * Giá đổi có hiệu lực ngay với khách, không chờ xuất bản lại: phiên bản mới chép phiên bản đang xuất bản
 * và chỉ thay giá của biến thể đó, nên nội dung đang soạn không lộ ra. Gọi dưới khóa dòng sản phẩm.
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

/** Có thay đổi chưa xuất bản: snapshot dựng lại từ bản đang soạn khác phiên bản khách đang thấy. */
export function hasUnpublishedChanges(draft: Draft) {
  const live = liveSnapshot(draft)
  return live !== null && !isDeepStrictEqual(live, buildSnapshot(draft))
}

export function toAdminProductDetail(draft: Draft): AdminProductDetail {
  return {
    ...toAdminProduct(draft),
    policyPageIds: draft.policyPages.map((p) => p.pageId).sort(),
    liveVersion: draft.liveVersion && {
      version: draft.liveVersion.version,
      publishedAt: draft.liveVersion.publishedAt.toISOString(),
    },
    hasUnpublishedChanges: hasUnpublishedChanges(draft),
  }
}

/** Ảnh trong phiên bản khách đang thấy; file của chúng phải còn trên storage dù bản đang soạn đã gỡ ảnh. */
export function liveImages(draft: Draft): StoredImage[] {
  return liveSnapshot(draft)?.images ?? []
}
