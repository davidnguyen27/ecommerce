import { ErrorCode, type ProductStatus } from '@ecommerce/shared'
import { AppError, conflictField } from '../../core/errors.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

/** Display order of variants and images. */
export const SORT_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }] as const

export const IMAGE_WITH_VARIANTS = {
  variants: { select: { variantId: true }, orderBy: { variantId: 'asc' } },
} as const

export const COMMITMENT_WITH_TYPE_AND_DOCUMENTS = {
  type: true,
  documents: { select: { documentId: true }, orderBy: { documentId: 'asc' } },
} as const

const COMMITMENT_ORDER = [{ type: { name: 'asc' } }, { createdAt: 'asc' }] as const

export const COMMITMENT_ORDER_BY = [...COMMITMENT_ORDER]

/** A product's commitments in display order, with type; used to build the publish snapshot. */
export const COMMITMENTS_WITH_TYPE = {
  include: { type: true },
  orderBy: [...COMMITMENT_ORDER],
} satisfies Prisma.ProductCommitmentFindManyArgs

/** Audit action of each status a product moves to. */
export const STATUS_ACTIONS: Record<ProductStatus, string> = {
  published: 'catalog.product.publish',
  archived: 'catalog.product.archive',
  draft: 'catalog.product.unarchive',
}

/** Bulk image file names: `<SKU>.<ext>` or `<SKU>_<n>.<ext>`. */
export const BULK_FILE_NAME = /^(.+?)\.[A-Za-z0-9]+$/

export const productNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy sản phẩm')
export const variantNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy biến thể')
export const imageNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy ảnh')
export const documentNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy chứng từ')
export const commitmentNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy cam kết')

/** Slug is the product's only unique constraint besides the primary key. */
export const slugTaken = () => conflictField('slug', 'Slug này đã có sản phẩm khác dùng')
export const skuTaken = () => conflictField('sku', 'SKU này đã có biến thể khác dùng')
export const commitmentTypeTaken = () => conflictField('typeId', 'Sản phẩm đã có cam kết thuộc loại này')
