import { ATTRIBUTE_FILTER_PREFIX, type PublicProduct } from '@ecommerce/shared'
import type { LocationQuery } from 'vue-router'

/** Short meta description: whitespace collapsed, cut at a word boundary. */
export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > 0 ? cut.slice(0, space) : cut}…`
}

/** Product list search, filter and sort params (besides `attr.*`); the `trang` page param does not count. */
export const LISTING_FILTER_PARAMS = ['q', 'type', 'minPrice', 'maxPrice', 'sort']

const isFilterParam = (name: string) => LISTING_FILTER_PARAMS.includes(name) || name.startsWith(ATTRIBUTE_FILTER_PREFIX)

/** List URLs with search, filters or sorting duplicate the base page, so they are not indexed. */
export function isFilteredListing(query: LocationQuery): boolean {
  return Object.entries(query).some(
    ([name, value]) => isFilterParam(name) && [value].flat().some((v) => typeof v === 'string' && v !== ''),
  )
}

/** Canonical of a list page: filters and unknown params dropped, the page number kept when unfiltered. */
export function listingCanonicalPath(path: string, query: LocationQuery): string {
  const page = Number(query.trang)
  return Number.isInteger(page) && page > 1 && !isFilteredListing(query) ? `${path}?trang=${page}` : path
}

/**
 * schema.org Product structured data. VND prices of variants on sale: one variant is an `Offer`, several an
 * `AggregateOffer` with a price range. `availability` is in stock with at least one in-stock variant, else pre-order
 * when one is open for pre-order, else out of stock.
 */
export function productJsonLd(product: PublicProduct, url: string, absolute: (src: string) => string) {
  const prices = product.variants.map((variant) => variant.price)
  const status = product.variants.some((v) => v.inStock)
    ? 'InStock'
    : product.variants.some((v) => v.availability === 'preorder')
      ? 'PreOrder'
      : 'OutOfStock'
  const availability = `https://schema.org/${status}`
  const offers =
    prices.length === 1
      ? { '@type': 'Offer', price: prices[0], priceCurrency: 'VND', availability, url }
      : {
          '@type': 'AggregateOffer',
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: prices.length,
          priceCurrency: 'VND',
          availability,
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

/** JSON for `<script type="application/ld+json">`; `<` is escaped so content cannot close the script tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
