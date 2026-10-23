import { ATTRIBUTE_FILTER_PREFIX, type PublicProduct } from '@ecommerce/shared'
import type { LocationQuery } from 'vue-router'

/** Mô tả ngắn cho thẻ meta: gộp khoảng trắng, cắt ở ranh giới từ. */
export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > 0 ? cut.slice(0, space) : cut}…`
}

/** Tham số tìm kiếm, lọc, sắp xếp của danh sách sản phẩm (ngoài `attr.*`); phân trang `trang` không tính. */
export const LISTING_FILTER_PARAMS = ['q', 'type', 'minPrice', 'maxPrice', 'sort']

const isFilterParam = (name: string) => LISTING_FILTER_PARAMS.includes(name) || name.startsWith(ATTRIBUTE_FILTER_PREFIX)

/** URL danh sách có tìm kiếm, bộ lọc hoặc sắp xếp: trùng nội dung với trang gốc nên không cho index. */
export function isFilteredListing(query: LocationQuery): boolean {
  return Object.entries(query).some(
    ([name, value]) => isFilterParam(name) && [value].flat().some((v) => typeof v === 'string' && v !== ''),
  )
}

/** Canonical của trang danh sách: bỏ bộ lọc và tham số lạ, giữ số trang khi không lọc. */
export function listingCanonicalPath(path: string, query: LocationQuery): string {
  const page = Number(query.trang)
  return Number.isInteger(page) && page > 1 && !isFilteredListing(query) ? `${path}?trang=${page}` : path
}

/**
 * Dữ liệu cấu trúc schema.org Product. Giá VND của các biến thể đang bán: một biến thể là `Offer`, nhiều biến
 * thể là `AggregateOffer` với khoảng giá. Chưa có `availability` vì chưa quản lý tồn kho (M2).
 */
export function productJsonLd(product: PublicProduct, url: string, absolute: (src: string) => string) {
  const prices = product.variants.map((variant) => variant.price)
  const offers =
    prices.length === 1
      ? { '@type': 'Offer', price: prices[0], priceCurrency: 'VND', url }
      : {
          '@type': 'AggregateOffer',
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: prices.length,
          priceCurrency: 'VND',
        }
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    ...(product.description && { description: excerpt(product.description, 5000) }),
    ...(product.modelCode && { mpn: product.modelCode }),
    ...(prices.length === 1 && { sku: product.variants[0]!.sku }),
    brand: { '@type': 'Brand', name: product.brand.name },
    image: product.images.map((image) => absolute(image.originalUrl)),
    url,
    offers,
  }
}

/** JSON để đặt trong `<script type="application/ld+json">`; thoát `<` để nội dung không đóng được thẻ script. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
