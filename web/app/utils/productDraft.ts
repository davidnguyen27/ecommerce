import type { AttributeValue, FieldError, ProductStatus, VariantStatus } from '@ecommerce/shared'

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Nháp',
  published: 'Đã xuất bản',
  archived: 'Lưu trữ',
}

export const VARIANT_STATUS_LABELS: Record<VariantStatus, string> = { active: 'Đang bán', discontinued: 'Ngừng bán' }

/** Giá trị đang soạn; ô bỏ trống là `null` hoặc chưa có khóa. */
export type DraftValues = Record<string, AttributeValue | null | undefined>

/** Một dòng biến thể đang soạn; `id` rỗng là dòng thêm mới. */
export type VariantDraft = {
  id: string
  sku: string
  attributes: DraftValues
  status: VariantStatus
  sortOrder: number
  price: number | null
  compareAtPrice: number | null
}

/** Lỗi theo trường của lần lưu gần nhất; `target` là `product`, `status` hoặc id biến thể (rỗng với dòng thêm mới). */
export type TargetedFieldErrors = { target: string; fields: FieldError[] }

export const fieldErrorAt = (errors: TargetedFieldErrors, target: string, path: string) =>
  errors.target === target ? errors.fields.find((f) => f.path === path)?.message : undefined
