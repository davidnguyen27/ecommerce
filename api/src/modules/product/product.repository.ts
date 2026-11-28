import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { LATEST_VERSION } from '../../content/pages.ts'
import {
  COMMITMENTS_WITH_TYPE,
  COMMITMENT_ORDER_BY,
  COMMITMENT_WITH_TYPE_AND_DOCUMENTS,
  IMAGE_WITH_VARIANTS,
  SORT_ORDER,
} from './product.constant.ts'

const PRODUCT_LIST_INCLUDE = {
  brand: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  _count: { select: { variants: true } },
} as const satisfies Prisma.ProductInclude

const DRAFT_INCLUDE = {
  variants: { orderBy: [...SORT_ORDER] },
  images: { orderBy: [...SORT_ORDER], include: { variants: { select: { variantId: true } } } },
  policyPages: { select: { pageId: true } },
  commitments: COMMITMENTS_WITH_TYPE,
  liveVersion: true,
} as const satisfies Prisma.ProductInclude

export type ProductListRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_LIST_INCLUDE }>
/** The product's draft, enough to build a snapshot. */
export type Draft = Prisma.ProductGetPayload<{ include: typeof DRAFT_INCLUDE }>
export type ProductWithVariants = Prisma.ProductGetPayload<{ include: { variants: true } }>
export type ImageWithVariants = Prisma.ProductImageGetPayload<{ include: typeof IMAGE_WITH_VARIANTS }>
export type CommitmentWithEvidence = Prisma.ProductCommitmentGetPayload<{
  include: typeof COMMITMENT_WITH_TYPE_AND_DOCUMENTS
}>

/**
 * Data access for products and what hangs off them: variants, published versions, policy pages, images, documents,
 * commitments. Every method takes `db`; repositories never open transactions (ADR 0018).
 */
export class ProductRepository {
  // ===== Products =====

  /** A product with variants in display order, or `null`. */
  find(db: DbClient, id: string): Promise<ProductWithVariants | null> {
    return db.product.findUnique({ where: { id }, include: { variants: { orderBy: [...SORT_ORDER] } } })
  }

  /** Locks the product row until the transaction ends (variant, image, document and commitment writes queue on it). */
  async lock(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT 1 FROM "product" WHERE "id" = ${id}::uuid FOR UPDATE`
  }

  list(db: DbClient) {
    return db.product.findMany({ include: PRODUCT_LIST_INCLUDE, orderBy: { updatedAt: 'desc' } })
  }

  findDraft(db: DbClient, id: string): Promise<Draft | null> {
    return db.product.findUnique({ where: { id }, include: DRAFT_INCLUDE })
  }

  create(tx: Prisma.TransactionClient, data: Prisma.ProductUncheckedCreateInput) {
    return tx.product.create({ data, include: { variants: true } })
  }

  update(tx: Prisma.TransactionClient, id: string, data: Prisma.ProductUncheckedUpdateInput) {
    return tx.product.update({ where: { id }, data, include: { variants: { orderBy: [...SORT_ORDER] } } })
  }

  async setStatus(tx: Prisma.TransactionClient, id: string, data: Prisma.ProductUncheckedUpdateInput) {
    await tx.product.update({ where: { id }, data })
  }

  /** The product's category, locked (`FOR KEY SHARE`) until the transaction ends so it is not deleted midway. */
  async lockCategory(tx: Prisma.TransactionClient, categoryId: string) {
    await tx.$executeRaw`SELECT 1 FROM "category" WHERE "id" = ${categoryId}::uuid FOR KEY SHARE`
    return tx.category.findUnique({ where: { id: categoryId } })
  }

  findBrand(db: DbClient, brandId: string) {
    return db.brand.findUnique({ where: { id: brandId } })
  }

  /** Policy pages to pick from; titles are the draft (a staff screen, not the customer's). */
  policyPageOptions(db: DbClient) {
    return db.contentPage.findMany({
      where: { kind: 'policy' },
      include: { _count: { select: { versions: true } } },
      orderBy: { createdAt: 'asc' },
    })
  }

  contentPages(db: DbClient, ids: string[]) {
    return db.contentPage.findMany({ where: { id: { in: ids } } })
  }

  async replacePolicyPages(tx: Prisma.TransactionClient, productId: string, pageIds: string[]) {
    await tx.productPolicyPage.deleteMany({ where: { productId } })
    await tx.productPolicyPage.createMany({ data: pageIds.map((pageId) => ({ productId, pageId })) })
  }

  /** Published policy pages of a snapshot, with their latest version, for the customer product page. */
  publishedPolicyPages(db: DbClient, ids: string[]) {
    return db.contentPage.findMany({
      where: { id: { in: ids }, kind: 'policy', versions: { some: {} } },
      include: { versions: LATEST_VERSION },
      orderBy: { createdAt: 'asc' },
    })
  }

  // ===== Variants =====

  findVariantBySku(db: DbClient, sku: string) {
    return db.productVariant.findUnique({ where: { sku } })
  }

  createVariant(tx: Prisma.TransactionClient, data: Prisma.ProductVariantUncheckedCreateInput) {
    return tx.productVariant.create({ data })
  }

  updateVariant(tx: Prisma.TransactionClient, id: string, data: Prisma.ProductVariantUncheckedUpdateInput) {
    return tx.productVariant.update({ where: { id }, data })
  }

  /** Variants with any of these SKUs, with the product name (bulk image upload). */
  variantsBySku(db: DbClient, skus: string[]) {
    return db.productVariant.findMany({
      where: { sku: { in: skus } },
      include: { product: { select: { name: true } } },
    })
  }

  /** Variants with status and the product's live snapshot (cart and checkout). */
  cartRows(db: DbClient, variantIds: readonly string[]) {
    return db.productVariant.findMany({
      where: { id: { in: [...variantIds] } },
      select: {
        id: true,
        status: true,
        product: { select: { id: true, liveVersion: { select: { snapshot: true } } } },
      },
    })
  }

  // ===== Published versions =====

  latestVersion(tx: Prisma.TransactionClient, productId: string) {
    return tx.productVersion.findFirst({ where: { productId }, orderBy: { version: 'desc' } })
  }

  createVersion(tx: Prisma.TransactionClient, data: Prisma.ProductVersionUncheckedCreateInput) {
    return tx.productVersion.create({ data })
  }

  findVersion(db: DbClient, id: string) {
    return db.productVersion.findUniqueOrThrow({ where: { id } })
  }

  versionsWithBrand(db: DbClient, ids: string[]) {
    return db.productVersion.findMany({ where: { id: { in: ids } }, include: { brand: true } })
  }

  /** Serializes publishes, so two products cannot go live with one slug at the same time. */
  async lockLiveSlugs(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catalog.product.live_slug'))`
  }

  findOtherLiveWithSlug(tx: Prisma.TransactionClient, productId: string, slug: string) {
    return tx.product.findFirst({ where: { id: { not: productId }, liveVersion: { slug } } })
  }

  /** A product currently using the slug wins; otherwise the most recent publish among past users. */
  async findPublishedBySlug(db: DbClient, slug: string) {
    const include = { liveVersion: { include: { brand: true, category: true } } } as const
    return (
      (await db.product.findFirst({ where: { liveVersion: { is: { slug } } }, include })) ??
      (await db.product.findFirst({
        where: { status: 'published', versions: { some: { slug } } },
        include,
        orderBy: { liveVersion: { publishedAt: 'desc' } },
      }))
    )
  }

  /** Ids of the category with this slug and all descendants, hidden ones included; unknown slug gives none. */
  async categorySubtreeIds(db: DbClient, slug: string) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE down AS (
        SELECT id FROM category WHERE slug = ${slug}
        UNION ALL
        SELECT c.id FROM category c JOIN down ON c.parent_id = down.id
      )
      SELECT id::text FROM down`
    return rows.map((r) => r.id)
  }

  findCategoryBySlug(db: DbClient, slug: string) {
    return db.category.findUnique({ where: { slug }, select: { productType: true } })
  }

  // ===== Images =====

  images(db: DbClient, productId: string): Promise<ImageWithVariants[]> {
    return db.productImage.findMany({ where: { productId }, include: IMAGE_WITH_VARIANTS, orderBy: [...SORT_ORDER] })
  }

  findImage(db: DbClient, imageId: string): Promise<ImageWithVariants | null> {
    return db.productImage.findUnique({ where: { id: imageId }, include: IMAGE_WITH_VARIANTS })
  }

  lastImage(tx: Prisma.TransactionClient, productId: string) {
    return tx.productImage.findFirst({ where: { productId }, orderBy: { sortOrder: 'desc' } })
  }

  createImage(tx: Prisma.TransactionClient, data: Prisma.ProductImageUncheckedCreateInput) {
    return tx.productImage.create({ data, include: IMAGE_WITH_VARIANTS })
  }

  updateImage(tx: Prisma.TransactionClient, imageId: string, data: Prisma.ProductImageUncheckedUpdateInput) {
    return tx.productImage.update({ where: { id: imageId }, data, include: IMAGE_WITH_VARIANTS })
  }

  async setImageOrder(tx: Prisma.TransactionClient, imageId: string, sortOrder: number) {
    await tx.productImage.update({ where: { id: imageId }, data: { sortOrder } })
  }

  async deleteImage(tx: Prisma.TransactionClient, imageId: string) {
    await tx.productImage.delete({ where: { id: imageId } })
  }

  // ===== Documents =====

  documents(db: DbClient, productId: string) {
    return db.productDocument.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } })
  }

  findDocument(db: DbClient, documentId: string) {
    return db.productDocument.findUnique({ where: { id: documentId } })
  }

  ownDocumentIds(tx: Prisma.TransactionClient, productId: string, ids: string[]) {
    return tx.productDocument.findMany({ where: { productId, id: { in: ids } }, select: { id: true } })
  }

  createDocument(tx: Prisma.TransactionClient, data: Prisma.ProductDocumentUncheckedCreateInput) {
    return tx.productDocument.create({ data })
  }

  async deleteDocument(tx: Prisma.TransactionClient, documentId: string) {
    await tx.productDocument.delete({ where: { id: documentId } })
  }

  /** Commitments citing the document, with type. */
  commitmentsCiting(tx: Prisma.TransactionClient, documentId: string) {
    return tx.productCommitment.findMany({
      where: { documents: { some: { documentId } } },
      include: { type: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  // ===== Commitments =====

  /** A product's commitments with type and documents, sorted by type name. */
  commitments(db: DbClient, productId: string): Promise<CommitmentWithEvidence[]> {
    return db.productCommitment.findMany({
      where: { productId },
      include: COMMITMENT_WITH_TYPE_AND_DOCUMENTS,
      orderBy: COMMITMENT_ORDER_BY,
    })
  }

  findCommitment(db: DbClient, commitmentId: string): Promise<CommitmentWithEvidence | null> {
    return db.productCommitment.findUnique({ where: { id: commitmentId }, include: COMMITMENT_WITH_TYPE_AND_DOCUMENTS })
  }

  findCommitmentType(tx: Prisma.TransactionClient, typeId: string) {
    return tx.commitmentType.findUnique({ where: { id: typeId } })
  }

  createCommitment(tx: Prisma.TransactionClient, data: Prisma.ProductCommitmentUncheckedCreateInput) {
    return tx.productCommitment.create({ data, include: COMMITMENT_WITH_TYPE_AND_DOCUMENTS })
  }

  updateCommitment(tx: Prisma.TransactionClient, id: string, data: Prisma.ProductCommitmentUncheckedUpdateInput) {
    return tx.productCommitment.update({ where: { id }, data, include: COMMITMENT_WITH_TYPE_AND_DOCUMENTS })
  }

  async deleteCommitment(tx: Prisma.TransactionClient, id: string) {
    await tx.productCommitment.delete({ where: { id } })
  }
}
