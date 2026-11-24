import type { AttributeValue, FieldError, ProductStatus, VariantStatus } from '@ecommerce/shared'

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Nháp',
  published: 'Đã xuất bản',
  archived: 'Lưu trữ',
}

export const VARIANT_STATUS_LABELS: Record<VariantStatus, string> = { active: 'Đang bán', discontinued: 'Ngừng bán' }

/** Draft values; an empty field is `null` or a missing key. */
export type DraftValues = Record<string, AttributeValue | null | undefined>

/** A draft variant row; an empty `id` is the add row. */
export type VariantDraft = {
  id: string
  sku: string
  attributes: DraftValues
  status: VariantStatus
  sortOrder: number
  price: number | null
  compareAtPrice: number | null
}

/** Field errors of the latest save; `target` is `product`, `status` or a variant id (empty for the add row). */
export type TargetedFieldErrors = { target: string; fields: FieldError[] }

export const fieldErrorAt = (errors: TargetedFieldErrors, target: string, path: string) =>
  errors.target === target ? errors.fields.find((f) => f.path === path)?.message : undefined
