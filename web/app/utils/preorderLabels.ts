import type { AttributeValues, PreorderSupplyStatus } from '@ecommerce/shared'

export const PREORDER_SUPPLY_LABELS: Record<PreorderSupplyStatus, string> = {
  not_ordered: 'Chưa đặt nhập',
  ordered: 'Đã đặt nhập',
  in_transit: 'Đang về',
  issue: 'Gặp sự cố',
}

/** Thuộc tính biến thể thành một dòng ngắn, ví dụ `Đen · 40`. */
export const variantLabel = (attributes: AttributeValues) =>
  Object.values(attributes)
    .map((v) => (Array.isArray(v) ? v.join(', ') : String(v)))
    .join(' · ')

/** Thời điểm ISO thành giá trị cho `<input type="datetime-local">` theo giờ máy nhân viên. */
export function toDateTimeLocal(iso: string) {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
