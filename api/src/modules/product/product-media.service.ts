import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { ErrorCode } from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { Storage } from '../../core/adapters/storage.ts'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db, DbClient } from '../../core/db.ts'
import { AppError, conflictField, invalidField } from '../../core/errors.ts'
import { DOCUMENT_URL_TTL_SECONDS, deleteDocumentFileQuietly } from '../../core/media/documents.ts'
import { PRODUCT_IMAGE_WIDTHS, deleteImageFilesQuietly, storeImage } from '../../core/media/images.ts'
import { fileError } from '../../core/media/upload.ts'
import { BULK_FILE_NAME, documentNotFound, imageNotFound } from './product.constant.ts'
import { documentAuditFields, imageAuditFields, liveImages, storedImageOf, variantIdsOf } from './product.mapper.ts'
import type { ProductRepository } from './product.repository.ts'
import type { ProductService } from './product.service.ts'

/**
 * Product images (public bucket, resized renditions) and supplier documents (private bucket, signed URLs). Writes
 * lock the product row so ordering, variant links and document citations cannot be passed by two requests at once.
 * Files are deleted only after commit, so a rollback keeps them.
 */
export class ProductMediaService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ProductRepository,
    private readonly products: ProductService,
    private readonly storage: Storage,
  ) {}

  // ===== Images =====

  async images(productId: string) {
    await this.products.load(this.prisma, productId)
    return this.repo.images(this.prisma, productId)
  }

  /** An image of exactly the product in the URL; another product's counts as missing. */
  private async findImage(db: DbClient, productId: string, imageId: string) {
    const image = await this.repo.findImage(db, imageId)
    if (!image || image.productId !== productId) throw imageNotFound()
    return image
  }

  /** Checks the product before processing, so nothing is uploaded for a missing product. */
  async uploadImage(productId: string, file: Buffer, alt: string, ctx: RequestContext, log: Logger) {
    await this.products.load(this.prisma, productId)
    return this.appendImage({ productId, file, alt, variantIds: [] }, ctx, log)
  }

  /**
   * Bulk upload, one file per request: the file name gives the SKU (`<SKU>.<ext>` or `<SKU>_<n>.<ext>`). The browser
   * sends images in order (sorted by SKU and number); the API only appends.
   */
  async uploadBySku(fileName: string, file: Buffer, ctx: RequestContext, log: Logger) {
    const stem = BULK_FILE_NAME.exec(fileName)?.[1]?.trim().toUpperCase() ?? ''
    // SKUs may contain underscores: try the whole name first, then strip a trailing `_<n>`.
    const candidates = [stem, stem.replace(/_\d+$/, '')].filter((sku, i, all) => sku && all.indexOf(sku) === i)
    const variants = await this.repo.variantsBySku(this.prisma, candidates)
    const variant = candidates.map((sku) => variants.find((v) => v.sku === sku)).find(Boolean)
    if (!variant) throw fileError(400, `Không có biến thể nào có SKU ${candidates.at(-1) || fileName}`)

    const image = await this.appendImage(
      { productId: variant.productId, file, alt: variant.product.name, variantIds: [variant.id] },
      ctx,
      log,
    )
    return { variant, image }
  }

  /**
   * Processes the image, uploads it, then appends it after the product's images, tied to `variantIds` (variants of
   * that product, checked by the caller). A DB error deletes the uploaded files.
   */
  private async appendImage(
    input: { productId: string; file: Buffer; alt: string; variantIds: string[] },
    ctx: RequestContext,
    log: Logger,
  ) {
    const { productId } = input
    const imageId = randomUUID()
    const image = await storeImage(this.storage, `products/${productId}/${imageId}`, input.file, PRODUCT_IMAGE_WIDTHS)
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.products.lock(tx, productId)
      const last = await this.repo.lastImage(tx, productId)
      const row = await this.repo.createImage(tx, {
        id: imageId,
        productId,
        storageKey: image.key,
        contentType: image.contentType,
        width: image.width,
        height: image.height,
        widths: image.widths,
        alt: input.alt,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        variants: { create: input.variantIds.map((variantId) => ({ variantId })) },
      })
      await audit({
        action: 'media.product_image.upload',
        entityType: 'product_image',
        entityId: row.id,
        after: imageAuditFields(row),
      })
      return row
    }).catch(async (err: unknown) => {
      await deleteImageFilesQuietly(this.storage, { log }, image)
      throw err
    })
  }

  /** The new order must hold every image of the product exactly once; the same order writes nothing. */
  async reorderImages(productId: string, imageIds: string[], ctx: RequestContext) {
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.products.lock(tx, productId)
      const current = await this.repo.images(tx, productId)
      const before = current.map((i) => i.id)
      if (
        imageIds.length !== before.length ||
        new Set(imageIds).size !== before.length ||
        !imageIds.every((i) => before.includes(i))
      ) {
        throw invalidField('imageIds', 'Thứ tự mới phải gồm đúng mọi ảnh của sản phẩm, mỗi ảnh một lần')
      }
      if (isDeepStrictEqual(imageIds, before) && current.every((image, index) => image.sortOrder === index)) {
        return current
      }
      for (const [sortOrder, imageId] of imageIds.entries()) await this.repo.setImageOrder(tx, imageId, sortOrder)
      await audit({
        action: 'media.product_image.reorder',
        entityType: 'product',
        entityId: productId,
        before: { imageIds: before },
        after: { imageIds },
      })
      return this.repo.images(tx, productId)
    })
  }

  /** Alt text and the variants the image belongs to (only the product's own variants). */
  async updateImage(
    productId: string,
    imageId: string,
    input: { alt: string; variantIds: string[] },
    ctx: RequestContext,
  ) {
    const variantIds = [...new Set(input.variantIds)].sort()
    return audited(this.prisma, ctx, async (tx, audit) => {
      const product = await this.products.lock(tx, productId)
      const before = await this.findImage(tx, productId, imageId)
      const own = new Set(product.variants.map((v) => v.id))
      const foreign = input.variantIds.findIndex((variantId) => !own.has(variantId))
      if (foreign !== -1) {
        throw invalidField(`variantIds.${foreign}`, 'Chỉ gắn được ảnh vào biến thể của chính sản phẩm này')
      }
      if (before.alt === input.alt && isDeepStrictEqual(variantIdsOf(before), variantIds)) return before

      const after = await this.repo.updateImage(tx, imageId, {
        alt: input.alt,
        variants: { deleteMany: {}, create: variantIds.map((variantId) => ({ variantId })) },
      })
      await audit({
        action: 'media.product_image.update',
        entityType: 'product_image',
        entityId: imageId,
        before: imageAuditFields(before),
        after: imageAuditFields(after),
      })
      return after
    })
  }

  /**
   * The last image of a published product cannot go. Images still in the published version keep their files; a later
   * republish or archive deletes them.
   */
  async deleteImage(productId: string, imageId: string, ctx: RequestContext, log: Logger) {
    const { deleted, live } = await audited(this.prisma, ctx, async (tx, audit) => {
      await this.products.lock(tx, productId)
      const draft = await this.products.loadDraft(tx, productId)
      const image = await this.findImage(tx, productId, imageId)
      if (draft.status === 'published' && draft.images.length === 1) {
        throw conflictField(
          'imageId',
          'Đây là ảnh cuối cùng của sản phẩm đã xuất bản; muốn thôi bán thì lưu trữ sản phẩm',
        )
      }
      await this.repo.deleteImage(tx, imageId)
      await audit({
        action: 'media.product_image.delete',
        entityType: 'product_image',
        entityId: imageId,
        before: imageAuditFields(image),
      })
      return { deleted: image, live: liveImages(draft).some((i) => i.key === image.storageKey) }
    })
    if (!live) await deleteImageFilesQuietly(this.storage, { log }, storedImageOf(deleted))
  }

  // ===== Documents =====

  async documents(productId: string) {
    await this.products.load(this.prisma, productId)
    return this.repo.documents(this.prisma, productId)
  }

  /** A document of exactly the product in the URL; another product's counts as missing. */
  private async findDocument(db: DbClient, productId: string, documentId: string) {
    const document = await this.repo.findDocument(db, documentId)
    if (!document || document.productId !== productId) throw documentNotFound()
    return document
  }

  /** Checks the product first, so nothing is uploaded for a missing product. A DB error deletes the file. */
  async uploadDocument(
    productId: string,
    file: { body: Buffer; fileName: string; contentType: string },
    ctx: RequestContext,
    log: Logger,
  ) {
    await this.products.load(this.prisma, productId)
    const documentId = randomUUID()
    const storageKey = `products/${productId}/documents/${documentId}`
    await this.storage.put({ bucket: 'private', key: storageKey, body: file.body, contentType: file.contentType })
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.products.lock(tx, productId)
      const row = await this.repo.createDocument(tx, {
        id: documentId,
        productId,
        storageKey,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.body.length,
      })
      await audit({
        action: 'document.upload',
        entityType: 'product_document',
        entityId: row.id,
        after: documentAuditFields(row),
      })
      return row
    }).catch(async (err: unknown) => {
      await deleteDocumentFileQuietly(this.storage, { log }, storageKey)
      throw err
    })
  }

  /** An expiring signed URL; issuing it is viewing the document, which is audited. */
  async documentUrl(productId: string, documentId: string, ctx: RequestContext) {
    const document = await this.findDocument(this.prisma, productId, documentId)
    const expiresAt = new Date(Date.now() + DOCUMENT_URL_TTL_SECONDS * 1000)
    const url = await this.storage.signedUrl(document.storageKey, DOCUMENT_URL_TTL_SECONDS)
    await audited(this.prisma, ctx, (_tx, audit) =>
      audit({
        action: 'document.view',
        entityType: 'product_document',
        entityId: document.id,
        after: { productId, fileName: document.fileName, expiresAt: expiresAt.toISOString() },
      }),
    )
    return { url, expiresAt }
  }

  /** A document cited by a commitment cannot go (same product lock as commitment writes). */
  async deleteDocument(productId: string, documentId: string, ctx: RequestContext, log: Logger) {
    const deleted = await audited(this.prisma, ctx, async (tx, audit) => {
      await this.products.lock(tx, productId)
      const document = await this.findDocument(tx, productId, documentId)
      const citing = await this.repo.commitmentsCiting(tx, documentId)
      if (citing.length > 0) {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          `Chứng từ đang làm bằng chứng cho cam kết: ${citing.map((c) => c.type.name).join(', ')}. Gỡ hoặc sửa các cam kết đó trước`,
          citing.map((c) => ({ path: `commitments.${c.id}`, message: `${c.type.name}: ${c.statement}` })),
        )
      }
      await this.repo.deleteDocument(tx, documentId)
      await audit({
        action: 'document.delete',
        entityType: 'product_document',
        entityId: documentId,
        before: documentAuditFields(document),
      })
      return document
    })
    await deleteDocumentFileQuietly(this.storage, { log }, deleted.storageKey)
  }
}
