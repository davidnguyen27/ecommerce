import { Router } from 'express'
import { CheckoutQuoteRequest, shippingFeeFor, type CheckoutQuote, type QuoteLine } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { cartVariants, type CartVariant } from '../checkout/live-variants.ts'
import type { Db } from '../db.ts'
import { parse } from '../http/validation.ts'
import { imageRenditions } from '../media/images.ts'
import { requireShippingFeeConfig } from '../shipping/shipping-fees.ts'
import { inStockIds } from '../stock/stock.ts'

/** Đặt mua của khách, không cần đăng nhập. */
export function checkoutRoutes(prisma: Db, storage: Storage) {
  /** Ảnh gắn với biến thể, không có thì ảnh đầu tiên của sản phẩm. */
  function imageOf({ snapshot, variant }: CartVariant) {
    const images = snapshot?.images ?? []
    const image = images.find((i) => variant && i.variantIds.includes(variant.id)) ?? images[0]
    return image ? { ...imageRenditions(storage, image), alt: image.alt } : null
  }

  return Router().post('/quote', async (req, res) => {
    const input = parse(CheckoutQuoteRequest, req.body)
    const config = await requireShippingFeeConfig(prisma)
    const ids = input.lines.map((l) => l.variantId)
    const [variants, stocked] = await Promise.all([cartVariants(prisma, ids), inStockIds(prisma, ids)])

    const lines = input.lines.map(({ variantId, quantity }): QuoteLine => {
      const found = variants.get(variantId) ?? { snapshot: null, variant: null }
      const { snapshot, variant } = found
      const inStock = variant !== null && stocked.has(variantId)
      return {
        variantId,
        quantity,
        product: snapshot && { slug: snapshot.slug, name: snapshot.name },
        sku: variant?.sku ?? null,
        attributes: variant?.attributes ?? null,
        image: imageOf(found),
        price: variant?.price ?? null,
        compareAtPrice: variant?.compareAtPrice ?? null,
        lineTotal: variant && inStock ? variant.price * quantity : null,
        discontinued: variant === null,
        inStock,
      }
    })
    const subtotal = lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)
    const shippingFee = input.provinceCode === undefined ? null : shippingFeeFor(config, input.provinceCode, subtotal)

    const body: CheckoutQuote = {
      lines,
      groundShippingOnly: [...variants.values()].some((v) => v.variant !== null && v.snapshot?.groundShippingOnly),
      subtotal,
      freeShippingThreshold: config.freeShippingThreshold,
      shippingFee,
      total: shippingFee === null ? null : subtotal + shippingFee,
    }
    res.json(body)
  })
}
