import type { AttributeDefinition, AttributeValue, ImageRenditions } from '@ecommerce/shared'

const VND = new Intl.NumberFormat('vi-VN')

/** `2500000` thành `2.500.000 ₫`. */
export function formatVnd(amount: number): string {
  return `${VND.format(amount)} ₫`
}

/** `srcset` từ các cỡ webp sinh sẵn. */
export function srcset(image: ImageRenditions): string {
  return image.sizes.map((size) => `${size.url} ${size.width}w`).join(', ')
}

/** Ảnh nhỏ nhất đủ rộng cho `width`, làm `src` dự phòng. */
export function imageSrc(image: ImageRenditions, width: number): string {
  return (image.sizes.find((size) => size.width >= width) ?? image.sizes.at(-1))?.url ?? image.originalUrl
}

/** Giá trị thuộc tính như khách đọc, kèm đơn vị theo schema. */
export function formatAttribute(definition: AttributeDefinition | undefined, value: AttributeValue): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  if (typeof value === 'number' && definition?.type === 'number' && definition.unit)
    return `${value} ${definition.unit}`
  return String(value)
}
