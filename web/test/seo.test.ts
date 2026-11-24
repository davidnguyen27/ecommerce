import type { PublicProduct, VariantAvailability } from '@ecommerce/shared'
import { describe, expect, it } from 'vitest'
import { productJsonLd } from '../app/utils/seo.ts'

const offer = { campaignId: 'c1', depositPercent: 30, deliveryFrom: '2026-12-10', deliveryTo: '2026-12-20' }

const variant = (sku: string, availability: VariantAvailability) => ({
  id: sku,
  sku,
  attributes: {},
  price: 2_000_000,
  compareAtPrice: null,
  inStock: availability === 'in_stock',
  availability,
  preorder: availability === 'preorder' ? offer : null,
})

/** Minimal product for JSON-LD: only the fields `productJsonLd` reads. */
const product = (...availabilities: VariantAvailability[]) =>
  ({
    name: 'Air Max',
    description: '',
    modelCode: '',
    brand: { slug: 'nike', name: 'Nike' },
    images: [],
    variants: availabilities.map((a, i) => variant(`AM-${40 + i}`, a)),
  }) as unknown as PublicProduct

const availabilityOf = (p: PublicProduct) =>
  (productJsonLd(p, 'https://shop.test/san-pham/air-max', (src) => src).offers as { availability: string }).availability

describe('JSON-LD tình trạng hàng', () => {
  it('có biến thể còn hàng thì InStock, dù biến thể khác đặt trước', () => {
    expect(availabilityOf(product('preorder', 'in_stock'))).toBe('https://schema.org/InStock')
  })

  it('không còn hàng sẵn nhưng có biến thể đang nhận đặt trước thì PreOrder', () => {
    expect(availabilityOf(product('out_of_stock', 'preorder'))).toBe('https://schema.org/PreOrder')
  })

  it('không còn hàng, không đặt trước được thì OutOfStock', () => {
    expect(availabilityOf(product('out_of_stock'))).toBe('https://schema.org/OutOfStock')
  })
})
