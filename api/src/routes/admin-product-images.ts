import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  ReorderProductImagesRequest,
  UpdateProductImageRequest,
  UploadProductImageFields,
  type AdminProductImage,
  type AdminProductImageList,
} from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import { ProductParams, SORT_ORDER, loadProduct, lockProduct } from '../catalog/products.ts'
import { liveImages, loadDraft } from '../catalog/publication.ts'
import type { Db, DbClient } from '../db.ts'
import type { ProductImage } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import {
  PRODUCT_IMAGE_WIDTHS,
  deleteImageFilesQuietly,
  imageRenditions,
  receiveImage,
  storeImage,
  uploadedFile,
  type StoredImage,
} from '../media/images.ts'

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

/** Trường nghiệp vụ của ảnh ghi vào audit. */
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
 * Ảnh của một sản phẩm, mount tại `/products/:id/images`. Xem cần quyền xem sản phẩm hoặc `media.upload`;
 * tải lên, sửa, sắp xếp, xóa cần `media.upload`. Thao tác ghi khóa dòng sản phẩm để thứ tự và việc gắn biến thể
 * không bị hai request cùng lọt qua.
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
        // Kiểm sản phẩm trước khi xử lý ảnh, để không đẩy file lên storage cho sản phẩm không có.
        await loadProduct(prisma, id)

        const imageId = randomUUID()
        const image = await storeImage(storage, `products/${id}/${imageId}`, file, PRODUCT_IMAGE_WIDTHS)
        const created = await audited(prisma, req, async (tx, audit) => {
          await lockProduct(tx, id)
          const last = await tx.productImage.findFirst({ where: { productId: id }, orderBy: { sortOrder: 'desc' } })
          const row = await tx.productImage.create({
            data: {
              id: imageId,
              productId: id,
              storageKey: image.key,
              contentType: image.contentType,
              width: image.width,
              height: image.height,
              widths: image.widths,
              alt,
              sortOrder: (last?.sortOrder ?? -1) + 1,
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
        res.status(201).json(toAdminImage(storage, created))
      })
      // Khai báo trước `/:imageId` để `order` không bị hiểu là id ảnh.
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
            const message = 'Đây là ảnh cuối cùng của sản phẩm đã xuất bản; muốn thôi bán thì lưu trữ sản phẩm'
            throw new AppError(409, ErrorCode.CONFLICT, message, [{ path: 'imageId', message }])
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
        // Xóa file sau khi commit: rollback thì ảnh vẫn còn đủ file. Ảnh khách còn thấy ở phiên bản đang xuất bản
        // thì giữ file; lần xuất bản lại hoặc lưu trữ sau đó mới xóa.
        if (!live) await deleteImageFilesQuietly(storage, req, stored(deleted))
        res.status(204).end()
      })
  )
}

/** Ảnh thuộc đúng sản phẩm trên URL; ảnh của sản phẩm khác coi như không có. */
async function findImage(db: DbClient, productId: string, imageId: string) {
  const image = await db.productImage.findUnique({ where: { id: imageId }, include: WITH_VARIANTS })
  if (!image || image.productId !== productId) throw imageNotFound()
  return image
}
