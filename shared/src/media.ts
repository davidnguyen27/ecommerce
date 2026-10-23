import { z } from 'zod'

/** Ảnh nhận jpeg, png, webp; MIME type đọc từ nội dung file, không theo đuôi. */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/** Dung lượng tối đa của một ảnh tải lên. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Một ảnh đã lưu: bản gốc và các cỡ webp sinh sẵn, xếp từ nhỏ tới lớn, để dựng `srcset`. */
export const ImageRenditions = z.object({
  originalUrl: z.string(),
  /** Kích thước bản gốc sau khi xoay theo EXIF. */
  width: z.number(),
  height: z.number(),
  /** `width` là chiều rộng danh nghĩa của cỡ; ảnh gốc nhỏ hơn thì không bị phóng to. */
  sizes: z.array(z.object({ width: z.number(), url: z.string() })),
})
export type ImageRenditions = z.infer<typeof ImageRenditions>

const Alt = z.string().trim().max(500)

export const AdminProductImage = ImageRenditions.extend({
  id: z.string(),
  alt: z.string(),
  sortOrder: z.number(),
  /** Biến thể của chính sản phẩm này; rỗng là ảnh chung. */
  variantIds: z.array(z.string()),
})
export type AdminProductImage = z.infer<typeof AdminProductImage>

/** Xếp theo thứ tự hiển thị. */
export const AdminProductImageList = z.object({ items: z.array(AdminProductImage) })
export type AdminProductImageList = z.infer<typeof AdminProductImageList>

/** Trường text gửi kèm file khi tải ảnh (multipart, file ở trường `file`). */
export const UploadProductImageFields = z.object({ alt: Alt.default('') })

export const UpdateProductImageRequest = z.object({
  alt: Alt,
  variantIds: z.array(z.uuid()).max(500),
})
export type UpdateProductImageRequest = z.infer<typeof UpdateProductImageRequest>

/** Thứ tự mới: đúng toàn bộ ảnh của sản phẩm, mỗi ảnh một lần. */
export const ReorderProductImagesRequest = z.object({ imageIds: z.array(z.uuid()).max(500) })
export type ReorderProductImagesRequest = z.infer<typeof ReorderProductImagesRequest>
