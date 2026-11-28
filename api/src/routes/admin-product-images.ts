import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Router, type Request } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  ReorderProductImagesRequest,
  UpdateProductImageRequest,
  UploadProductImageFields,
  type AdminProductImage,
  type AdminProductImageList,
  type BulkImageResult,
} from '@ecommerce/shared'
import type { Storage } from '../core/adapters/storage.ts'
import { audited } from '../core/audit/audited.ts'
import { requirePermission } from '../core/middleware/staff-context.ts'
import { ProductParams, SORT_ORDER, loadProduct, lockProduct } from '../catalog/products.ts'
import { liveImages, loadDraft } from '../catalog/publication.ts'
import type { Db, DbClient } from '../core/db.ts'
import type { ProductImage } from '../generated/prisma/client.ts'
import { AppError, conflictField, invalidField } from '../core/errors.ts'
import { parse } from '../core/middleware/validation.ts'
import { fileError } from '../core/media/upload.ts'
import {
  PRODUCT_IMAGE_WIDTHS,
  deleteImageFilesQuietly,
  imageRenditions,
  receiveImage,
  storeImage,
  uploadedFile,
  type StoredImage,
} from '../core/media/images.ts'

const ImageParams = z.object({ id: z.uuid(), imageId: z.uuid() })

type ImageWithVariants = ProductImage & { variants: { variantId: string }[] }

const WITH_VARIANTS = { variants: { select: { variantId: true }, orderBy: { variantId: 'asc' } } } as const

const imageNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy ảnh')

const stored = (image: ProductImage): StoredImage => ({
  key: image.storageKey,
  contentType: image.contentType,
  width: image.width,
  height: image.height,
  widths: image.widths,
})

/** Image business fields recorded in audit. */
function auditFields(image: ImageWithVariants) {
  const { productId, storageKey, contentType, width, height, alt, sortOrder } = image
  return { productId, storageKey, contentType, width, height, alt, sortOrder, variantIds: variantIdsOf(image) }
}

const variantIdsOf = (image: ImageWithVariants) => image.variants.map((v) => v.variantId).sort()

function toAdminImage(storage: Storage, image: ImageWithVariants): AdminProductImage {
  return {
    id: image.id,
    ...imageRenditions(storage, stored(image)),
    alt: image.alt,
    sortOrder: image.sortOrder,
    variantIds: variantIdsOf(image),
  }
}

const imagesOf = (db: DbClient, productId: string) =>
  db.productImage.findMany({ where: { productId }, include: WITH_VARIANTS, orderBy: [...SORT_ORDER] })

/**
 * Processes the image, uploads it, then appends it after the product's images, tied to `variantIds` (variants of
 * that product, checked by the caller). A DB error deletes the uploaded files.
 */
async function appendImage(
  prisma: Db,
  storage: Storage,
  req: Request,
  input: { productId: string; file: Buffer; alt: string; variantIds: string[] },
) {
  const { productId } = input
  const imageId = randomUUID()
  const image = await storeImage(storage, `products/${productId}/${imageId}`, input.file, PRODUCT_IMAGE_WIDTHS)
  return audited(prisma, req, async (tx, audit) => {
    await lockProduct(tx, productId)
    const last = await tx.productImage.findFirst({ where: { productId }, orderBy: { sortOrder: 'desc' } })
    const row = await tx.productImage.create({
      data: {
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
      },
      include: WITH_VARIANTS,
    })
    await audit({
      action: 'media.product_image.upload',
      entityType: 'product_image',
      entityId: row.id,
      after: auditFields(row),
    })
    return row
  }).catch(async (err: unknown) => {
    await deleteImageFilesQuietly(storage, req, image)
    throw err
  })
}

/** Bulk image file names: `<SKU>.<ext>` or `<SKU>_<n>.<ext>`. */
const BULK_FILE_NAME = /^(.+?)\.[A-Za-z0-9]+$/

/**
 * Bulk images, mounted at `/images`: one file per request, the file name gives the SKU. Needs `media.upload`. The
 * browser sends images in order (sorted by SKU and number); the API only appends.
 */
export function adminBulkImageRoutes(prisma: Db, storage: Storage) {
  return Router().post('/by-sku', requirePermission('media.upload'), receiveImage, async (req, res) => {
    const file = uploadedFile(req)
    const stem = BULK_FILE_NAME.exec(req.file!.originalname)?.[1]?.trim().toUpperCase() ?? ''
    // SKUs may contain underscores: try the whole name first, then strip a trailing `_<n>`.
    const candidates = [stem, stem.replace(/_\d+$/, '')].filter((sku, i, all) => sku && all.indexOf(sku) === i)
    const variants = await prisma.productVariant.findMany({
      where: { sku: { in: candidates } },
      include: { product: { select: { name: true } } },
    })
    const variant = candidates.map((sku) => variants.find((v) => v.sku === sku)).find(Boolean)
    if (!variant) throw fileError(400, `Không có biến thể nào có SKU ${candidates.at(-1) || req.file!.originalname}`)

    const created = await appendImage(prisma, storage, req, {
      productId: variant.productId,
      file,
      alt: variant.product.name,
      variantIds: [variant.id],
    })
    const body: BulkImageResult = {
      productId: variant.productId,
      sku: variant.sku,
      image: toAdminImage(storage, created),
    }
    res.status(201).json(body)
  })
}

/**
 * Images of a product, mounted at `/products/:id/images`. Viewing needs product view permission or `media.upload`;
 * upload, edit, reorder, delete need `media.upload`. Writes lock the product row so ordering and variant links cannot
 * be passed by two requests at once.
 */
export function adminProductImageRoutes(prisma: Db, storage: Storage) {
  return (
    Router({ mergeParams: true })
      .get('/', requirePermission('catalog.edit', 'price.edit', 'media.upload'), async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        await loadProduct(prisma, id)
        const body: AdminProductImageList = { items: (await imagesOf(prisma, id)).map((i) => toAdminImage(storage, i)) }
        res.json(body)
      })
      .post('/', requirePermission('media.upload'), receiveImage, async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        const { alt } = parse(UploadProductImageFields, req.body)
        const file = uploadedFile(req)
        // Check the product before processing, so nothing is uploaded for a missing product.
        await loadProduct(prisma, id)
        const created = await appendImage(prisma, storage, req, { productId: id, file, alt, variantIds: [] })
        res.status(201).json(toAdminImage(storage, created))
      })
      // Declared before `/:imageId` so `order` is not read as an image id.
      .put('/order', requirePermission('media.upload'), async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        const { imageIds } = parse(ReorderProductImagesRequest, req.body)
        const images = await audited(prisma, req, async (tx, audit) => {
          await lockProduct(tx, id)
          const current = await imagesOf(tx, id)
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
          for (const [sortOrder, imageId] of imageIds.entries()) {
            await tx.productImage.update({ where: { id: imageId }, data: { sortOrder } })
          }
          await audit({
            action: 'media.product_image.reorder',
            entityType: 'product',
            entityId: id,
            before: { imageIds: before },
            after: { imageIds },
          })
          return imagesOf(tx, id)
        })
        const body: AdminProductImageList = { items: images.map((i) => toAdminImage(storage, i)) }
        res.json(body)
      })
      .put('/:imageId', requirePermission('media.upload'), async (req, res) => {
        const { id, imageId } = parse(ImageParams, req.params)
        const input = parse(UpdateProductImageRequest, req.body)
        const variantIds = [...new Set(input.variantIds)].sort()
        const updated = await audited(prisma, req, async (tx, audit) => {
          const product = await lockProduct(tx, id)
          const before = await findImage(tx, id, imageId)
          const own = new Set(product.variants.map((v) => v.id))
          const foreign = input.variantIds.findIndex((variantId) => !own.has(variantId))
          if (foreign !== -1)
            throw invalidField(`variantIds.${foreign}`, 'Chỉ gắn được ảnh vào biến thể của chính sản phẩm này')
          if (before.alt === input.alt && isDeepStrictEqual(variantIdsOf(before), variantIds)) return before

          const after = await tx.productImage.update({
            where: { id: imageId },
            data: {
              alt: input.alt,
              variants: { deleteMany: {}, create: variantIds.map((variantId) => ({ variantId })) },
            },
            include: WITH_VARIANTS,
          })
          await audit({
            action: 'media.product_image.update',
            entityType: 'product_image',
            entityId: imageId,
            before: auditFields(before),
            after: auditFields(after),
          })
          return after
        })
        res.json(toAdminImage(storage, updated))
      })
      .delete('/:imageId', requirePermission('media.upload'), async (req, res) => {
        const { id, imageId } = parse(ImageParams, req.params)
        const { deleted, live } = await audited(prisma, req, async (tx, audit) => {
          await lockProduct(tx, id)
          const draft = await loadDraft(tx, id)
          const image = await findImage(tx, id, imageId)
          if (draft.status === 'published' && draft.images.length === 1) {
            throw conflictField(
              'imageId',
              'Đây là ảnh cuối cùng của sản phẩm đã xuất bản; muốn thôi bán thì lưu trữ sản phẩm',
            )
          }
          await tx.productImage.delete({ where: { id: imageId } })
          await audit({
            action: 'media.product_image.delete',
            entityType: 'product_image',
            entityId: imageId,
            before: auditFields(image),
          })
          return { deleted: image, live: liveImages(draft).some((i) => i.key === image.storageKey) }
        })
        // Delete files after commit: on rollback the image keeps all its files. Images still in the published version
        // keep their files; a later republish or archive deletes them.
        if (!live) await deleteImageFilesQuietly(storage, req, stored(deleted))
        res.status(204).end()
      })
  )
}

/** An image of exactly the product in the URL; another product's counts as missing. */
async function findImage(db: DbClient, productId: string, imageId: string) {
  const image = await db.productImage.findUnique({ where: { id: imageId }, include: WITH_VARIANTS })
  if (!image || image.productId !== productId) throw imageNotFound()
  return image
}
