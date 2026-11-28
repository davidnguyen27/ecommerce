import { isDeepStrictEqual } from 'node:util'
import type { z } from 'zod'
import {
  ErrorCode,
  type AdminVariant,
  type AttributeValues,
  ProductRequest,
  type ProductStatus,
  VariantRequest,
} from '@ecommerce/shared'
import type { Storage } from '../../core/adapters/storage.ts'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db, DbClient } from '../../core/db.ts'
import { AppError, conflictField, invalidField, rethrowUnique } from '../../core/errors.ts'
import { deleteImageFilesQuietly, type StoredImage } from '../../core/media/images.ts'
import { forbidden } from '../../core/middleware/staff-context.ts'
import { Prisma, type ProductVariant } from '../../generated/prisma/client.ts'
import { assertAttributes, type IAttributeSchemaQuery } from '../attribute-schema/index.ts'
import type { Logger } from 'pino'
import { STATUS_ACTIONS, productNotFound, skuTaken, slugTaken, variantNotFound } from './product.constant.ts'
import type { VariantActor } from './product.interface.ts'
import {
  buildSnapshot,
  cheapestVariant,
  lifecycle,
  liveImages,
  liveSnapshot,
  priceAuditFields,
  productAuditFields,
  publishBlockers,
  toAdminVariant,
  toNumber,
  variantAuditFields,
  variantCreatedAudits,
} from './product.mapper.ts'
import { ProductSnapshot } from './product.model.ts'
import type { Draft, ProductRepository, ProductWithVariants } from './product.repository.ts'

type ProductInput = z.output<typeof ProductRequest>
type VariantInput = z.output<typeof VariantRequest>
type VariantFields = Pick<ProductVariant, 'sku' | 'status' | 'sortOrder'> & { attributes: AttributeValues }
type VariantPrice = { price: number | null; compareAtPrice: number | null }

/**
 * Products, variants and publishing. Writes lock the product row first, so invariants spanning variants (one still on
 * sale, no duplicate combinations) and publish conditions cannot be passed by two requests at once.
 */
export class ProductService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ProductRepository,
    private readonly schemas: IAttributeSchemaQuery,
    private readonly storage: Storage,
  ) {}

  // ===== Reads =====

  /** A product with variants in display order; 404 if missing. */
  async load(db: DbClient, id: string): Promise<ProductWithVariants> {
    const product = await this.repo.find(db, id)
    if (!product) throw productNotFound()
    return product
  }

  /** Locks the product row until the transaction ends, then reads it. */
  async lock(tx: Prisma.TransactionClient, id: string) {
    await this.repo.lock(tx, id)
    return this.load(tx, id)
  }

  async loadDraft(db: DbClient, id: string): Promise<Draft> {
    const draft = await this.repo.findDraft(db, id)
    if (!draft) throw productNotFound()
    return draft
  }

  list() {
    return this.repo.list(this.prisma)
  }

  policyPageOptions() {
    return this.repo.policyPageOptions(this.prisma)
  }

  draft(id: string) {
    return this.loadDraft(this.prisma, id)
  }

  // ===== Products =====

  async create(input: ProductInput, ctx: RequestContext) {
    return audited(this.prisma, ctx, async (tx, audit) => {
      const category = await this.lockCategory(tx, input.categoryId)
      await this.assertBrandExists(tx, input.brandId)
      const schema = await this.schemas.lock(tx, category.productType, 'share')
      const product = await this.repo.create(tx, {
        ...input,
        productType: category.productType,
        sizeChart: input.sizeChart ?? Prisma.DbNull,
        attributes: assertAttributes(schema.attributes, 'product', input.attributes),
      })
      await audit({
        action: 'catalog.product.create',
        entityType: 'product',
        entityId: product.id,
        after: productAuditFields(product),
      })
      return product
    }).catch(rethrowUnique(slugTaken))
  }

  async update(id: string, input: ProductInput, ctx: RequestContext) {
    return audited(this.prisma, ctx, async (tx, audit) => {
      const before = await this.lock(tx, id)
      if (input.categoryId !== before.categoryId) {
        const category = await this.lockCategory(tx, input.categoryId)
        // Changing the product type would break every variant's attributes, so it is fixed at creation.
        if (category.productType !== before.productType) {
          throw conflictField('categoryId', 'Chỉ chuyển được sang danh mục cùng nhóm hàng')
        }
      }
      if (input.brandId !== before.brandId) await this.assertBrandExists(tx, input.brandId)
      const schema = await this.schemas.lock(tx, before.productType, 'share')
      const attributes = assertAttributes(schema.attributes, 'product', input.attributes)

      const { productType, status } = before
      if (isDeepStrictEqual(productAuditFields(before), { productType, ...input, attributes, status })) return before
      const after = await this.repo.update(tx, id, {
        ...input,
        sizeChart: input.sizeChart ?? Prisma.DbNull,
        attributes,
      })
      await audit({
        action: 'catalog.product.update',
        entityType: 'product',
        entityId: id,
        before: productAuditFields(before),
        after: productAuditFields(after),
      })
      return after
    }).catch(rethrowUnique(slugTaken))
  }

  /** The product's category, locked until the transaction ends so it is not deleted midway; missing gives 400. */
  private async lockCategory(tx: Prisma.TransactionClient, categoryId: string) {
    const category = await this.repo.lockCategory(tx, categoryId)
    if (!category) throw invalidField('categoryId', 'Danh mục không tồn tại')
    return category
  }

  private async assertBrandExists(tx: Prisma.TransactionClient, brandId: string) {
    if (!(await this.repo.findBrand(tx, brandId))) throw invalidField('brandId', 'Thương hiệu không tồn tại')
  }

  // ===== Variants =====

  /** Creates a variant (the route requires `catalog.edit`); a price also needs `price.edit` and writes `price.change`. */
  createVariant(
    productId: string,
    input: VariantInput,
    actor: VariantActor,
    ctx: RequestContext,
  ): Promise<AdminVariant> {
    return audited(this.prisma, ctx, async (tx, audit) => {
      const product = await this.lock(tx, productId)
      const { others, fields } = await this.resolveFields(tx, product, null, input)
      const price = { price: input.price ?? null, compareAtPrice: input.compareAtPrice ?? null }
      const priced = price.price !== null || price.compareAtPrice !== null
      if (priced && !actor.canEditPrice) throw forbidden()
      // A new variant is not on the website yet: the published version lacks it.
      await this.assertVariant(tx, product, others, null, fields, price, false)

      const created = await this.repo
        .createVariant(tx, { ...fields, ...price, productId })
        .catch(rethrowUnique(skuTaken))
      await audit(variantCreatedAudits(created))
      return toAdminVariant(created)
    })
  }

  /**
   * Updates a variant. SKU, attributes, status and order need `catalog.edit`; a price different from the current one
   * needs `price.edit`, writes its own `price.change` audit, and for variants on the website goes live at once via a
   * new published version.
   */
  updateVariant(
    productId: string,
    variantId: string,
    input: VariantInput,
    actor: VariantActor,
    ctx: RequestContext,
  ): Promise<AdminVariant> {
    return audited(this.prisma, ctx, async (tx, audit) => {
      const product = await this.lock(tx, productId)
      const before = product.variants.find((v) => v.id === variantId)
      if (!before) throw variantNotFound()
      const { others, fields } = await this.resolveFields(tx, product, before, input)
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

      const live = await this.loadLiveVersion(tx, product.liveVersionId)
      const onWebsite = live?.snapshot.variants.some((v) => v.id === before.id) ?? false
      await this.assertVariant(tx, product, others, before, fields, price, onWebsite)

      const after = await this.repo.updateVariant(tx, before.id, { ...fields, ...price }).catch(rethrowUnique(skuTaken))
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
          const version = await this.publishPrice(tx, productId, live.snapshot, variant, actor.staffId)
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
    })
  }

  /** Non-price fields after applying `input` to `before` (null on create); attributes are checked under the lock. */
  private async resolveFields(
    tx: Prisma.TransactionClient,
    product: ProductWithVariants,
    before: ProductVariant | null,
    input: VariantInput,
  ) {
    const others = product.variants.filter((v) => v.id !== before?.id)
    const schema = await this.schemas.lock(tx, product.productType, 'share')
    const fields: VariantFields = {
      sku: input.sku,
      attributes: assertAttributes(schema.attributes, 'variant', input.attributes),
      status: input.status,
      sortOrder: input.sortOrder ?? before?.sortOrder ?? Math.max(-1, ...others.map((v) => v.sortOrder)) + 1,
    }
    return { others, fields }
  }

  /** Business rules of the variant about to be saved; `onWebsite` means it is in the version customers see. */
  private async assertVariant(
    tx: Prisma.TransactionClient,
    product: ProductWithVariants,
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
    if (fields.sku !== before?.sku && (await this.repo.findVariantBySku(tx, fields.sku))) throw skuTaken()
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

  // ===== Publishing =====

  /** Creates a new version from the snapshot. Call under the product row lock so version numbers do not race. */
  private async createVersion(
    tx: Prisma.TransactionClient,
    productId: string,
    snapshot: ProductSnapshot,
    publishedById: string,
  ) {
    const last = await this.repo.latestVersion(tx, productId)
    const cheapest = cheapestVariant(snapshot)
    return this.repo.createVersion(tx, {
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
    })
  }

  /** The version customers currently see, with its snapshot; null when unpublished. */
  private async loadLiveVersion(db: DbClient, liveVersionId: string | null) {
    if (liveVersionId === null) return null
    const version = await this.repo.findVersion(db, liveVersionId)
    return { version: version.version, snapshot: ProductSnapshot.parse(version.snapshot) }
  }

  /**
   * Price changes apply to customers at once, without republishing: the new version copies the live one and only
   * swaps that variant's price, so draft content stays hidden. Call under the product row lock.
   */
  private async publishPrice(
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
    const version = await this.createVersion(tx, productId, snapshot, publishedById)
    await this.repo.setStatus(tx, productId, { liveVersionId: version.id })
    return version
  }

  /**
   * Publish, archive or bring back to draft. Republishing with no changes creates no duplicate version. Images removed
   * from the draft keep their files for the old version until customers no longer see it, then are deleted after
   * commit.
   */
  async changeStatus(id: string, status: ProductStatus, ctx: RequestContext, log: Logger) {
    const { draft, unused } = await audited(this.prisma, ctx, async (tx, audit) => {
      await this.repo.lock(tx, id)
      const before = await this.loadDraft(tx, id)
      const unchanged = { draft: before, unused: [] as StoredImage[] }
      if (before.status === status && status !== 'published') return unchanged
      if (before.status === 'published' && status === 'draft') {
        throw conflictField(
          'status',
          'Không đưa được sản phẩm đã xuất bản về nháp; muốn gỡ khỏi website thì lưu trữ sản phẩm',
        )
      }
      if (before.status === 'archived' && status === 'published') {
        throw conflictField('status', 'Sản phẩm lưu trữ phải được đưa về nháp trước khi xuất bản lại')
      }

      if (status === 'published') {
        const blockers = publishBlockers(before)
        if (blockers.length > 0) {
          throw new AppError(409, ErrorCode.CONFLICT, 'Sản phẩm chưa đủ điều kiện xuất bản', blockers)
        }
        const snapshot = buildSnapshot(before)
        if (isDeepStrictEqual(liveSnapshot(before), snapshot)) return unchanged
        await this.assertLiveSlugFree(tx, id, snapshot.slug)
        const version = await this.createVersion(tx, id, snapshot, ctx.staffId)
        await this.repo.setStatus(tx, id, { status, liveVersionId: version.id })
      } else {
        await this.repo.setStatus(tx, id, { status, liveVersionId: null })
      }

      const after = await this.loadDraft(tx, id)
      await audit({
        action: STATUS_ACTIONS[status],
        entityType: 'product',
        entityId: id,
        before: lifecycle(before),
        after: lifecycle(after),
      })
      const used = new Set([...after.images.map((i) => i.storageKey), ...liveImages(after).map((i) => i.key)])
      return { draft: after, unused: liveImages(before).filter((i) => !used.has(i.key)) }
    })
    for (const image of unused) await deleteImageFilesQuietly(this.storage, { log }, image)
    return draft
  }

  /**
   * Slugs are unique only among drafts: a product renamed but not republished keeps its old slug on the website. A
   * shared lock for every publish keeps two products from going live with one slug at the same time.
   */
  private async assertLiveSlugFree(tx: Prisma.TransactionClient, productId: string, slug: string) {
    await this.repo.lockLiveSlugs(tx)
    if (await this.repo.findOtherLiveWithSlug(tx, productId, slug)) {
      throw conflictField('slug', 'Slug này đang được sản phẩm khác dùng trên website')
    }
  }

  /** Attaches policy pages (only pages of kind policy); the same set writes nothing. */
  async setPolicies(id: string, pageIds: string[], ctx: RequestContext) {
    const wanted = [...new Set(pageIds)].sort()
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.repo.lock(tx, id)
      const before = await this.loadDraft(tx, id)
      const pages = await this.repo.contentPages(tx, wanted)
      pageIds.forEach((pageId, index) => {
        if (pages.find((p) => p.id === pageId)?.kind !== 'policy') {
          const message = 'Chỉ gắn được trang nội dung loại chính sách'
          throw new AppError(400, ErrorCode.VALIDATION_ERROR, message, [{ path: `pageIds.${index}`, message }])
        }
      })
      const current = before.policyPages.map((p) => p.pageId).sort()
      if (isDeepStrictEqual(current, wanted)) return before

      await this.repo.replacePolicyPages(tx, id, wanted)
      await audit({
        action: 'catalog.product.policies',
        entityType: 'product',
        entityId: id,
        before: { policyPageIds: current },
        after: { policyPageIds: wanted },
      })
      return this.loadDraft(tx, id)
    })
  }
}
