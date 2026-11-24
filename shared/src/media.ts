import { z } from 'zod'

/** Images accept jpeg, png, webp; the MIME type comes from content, not the extension. */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** Max size of one uploaded image. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** A stored image: the original and prebuilt webp widths, smallest first, for `srcset`. */
export const ImageRenditions = z.object({
  originalUrl: z.string(),
  /** Original dimensions after EXIF rotation. */
  width: z.number(),
  height: z.number(),
  /** `width` is the nominal width; smaller originals are never upscaled. */
  sizes: z.array(z.object({ width: z.number(), url: z.string() })),
})
export type ImageRenditions = z.infer<typeof ImageRenditions>

const Alt = z.string().trim().max(500)

export const AdminProductImage = ImageRenditions.extend({
  id: z.string(),
  alt: z.string(),
  sortOrder: z.number(),
  /** Variants of this same product; empty means a shared image. */
  variantIds: z.array(z.string()),
})
export type AdminProductImage = z.infer<typeof AdminProductImage>

/** In display order. */
export const AdminProductImageList = z.object({ items: z.array(AdminProductImage) })
export type AdminProductImageList = z.infer<typeof AdminProductImageList>

/** Result of one bulk upload by SKU: the image attached to the product and the SKU's variant from the file name. */
export const BulkImageResult = z.object({ productId: z.string(), sku: z.string(), image: AdminProductImage })
export type BulkImageResult = z.infer<typeof BulkImageResult>

/** Text fields sent with an image upload (multipart, file in field `file`). */
export const UploadProductImageFields = z.object({ alt: Alt.default('') })

export const UpdateProductImageRequest = z.object({
  alt: Alt,
  variantIds: z.array(z.uuid()).max(500),
})
export type UpdateProductImageRequest = z.infer<typeof UpdateProductImageRequest>

/** New order: exactly all the product's images, each once. */
export const ReorderProductImagesRequest = z.object({ imageIds: z.array(z.uuid()).max(500) })
export type ReorderProductImagesRequest = z.infer<typeof ReorderProductImagesRequest>
