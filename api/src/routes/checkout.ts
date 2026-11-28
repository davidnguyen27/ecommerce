import { Router } from 'express'
import {
  CheckoutQuoteRequest,
  CheckoutRequest,
  type CheckoutQuote,
  type CheckoutResult,
  type QuoteLine,
  type VoucherQuote,
} from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { optionalAuth } from '../core/middleware/require-auth.ts'
import { cartVariants } from '../modules/product/index.ts'
import { livePolicyVersions, storedImageOf } from '../placement/order-snapshot.ts'
import { parse } from '../core/middleware/validation.ts'
import { imageRenditions } from '../core/media/images.ts'
import { orderPlacement } from '../placement/place-order.ts'
import { priceOrder } from '../placement/price-order.ts'
import { requireShippingFeeConfig } from '../shipping/shipping-fees.ts'
import { enoughStockIds } from '../stock/stock.ts'
import { quoteVoucher, type VoucherLine } from '../vouchers/apply.ts'

/** Customer checkout, no sign-in needed; a customer access token links the order to the account. */
export function checkoutRoutes(deps: AppDeps) {
  const { prisma, storage, jwtSecret } = deps
  const customerSession = optionalAuth(new TextEncoder().encode(jwtSecret), 'customer')
  const placement = orderPlacement(deps)
  return Router()
    .post('/quote', async (req, res) => {
      const input = parse(CheckoutQuoteRequest, req.body)
      const config = await requireShippingFeeConfig(prisma)
      const ids = input.lines.map((l) => l.variantId)
      const [variants, stocked] = await Promise.all([cartVariants(prisma, ids), enoughStockIds(prisma, input.lines)])
      const policies = await livePolicyVersions(prisma, variants.values())

      const lines = input.lines.map(({ variantId, quantity }): QuoteLine => {
        const found = variants.get(variantId) ?? { snapshot: null, variant: null }
        const { snapshot, variant } = found
        const inStock = variant !== null && stocked.has(variantId)
        const image = storedImageOf(found)
        return {
          variantId,
          quantity,
          product: snapshot && { slug: snapshot.slug, name: snapshot.name },
          sku: variant?.sku ?? null,
          attributes: variant?.attributes ?? null,
          image: image && { ...imageRenditions(storage, image), alt: image.alt },
          price: variant?.price ?? null,
          compareAtPrice: variant?.compareAtPrice ?? null,
          lineTotal: variant && inStock ? variant.price * quantity : null,
          discontinued: variant === null,
          inStock,
        }
      })
      const subtotal = lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)

      let voucher: VoucherQuote | null = null
      if (input.voucherCode !== undefined) {
        // Only buyable lines (on sale, in stock) count toward goods, like `subtotal`.
        const buyable = lines.flatMap(({ variantId, quantity, lineTotal, price }): VoucherLine[] => {
          const snapshot = variants.get(variantId)?.snapshot
          return lineTotal === null || !snapshot || price === null
            ? []
            : [{ variantId, brandId: snapshot.brandId, categoryId: snapshot.categoryId, price, quantity }]
        })
        voucher = await quoteVoucher(prisma, req, input.voucherCode, {
          saleType: 'standard',
          lines: buyable,
          customer: { email: input.email, phone: input.phone },
        })
      }
      const discount = voucher?.applied ? voucher.discount : 0
      const { shippingFee, total } = priceOrder(config, { subtotal, discount, provinceCode: input.provinceCode })
      const withoutVoucher = priceOrder(config, { subtotal, discount: 0, provinceCode: input.provinceCode })

      const body: CheckoutQuote = {
        lines,
        groundShippingOnly: [...variants.values()].some((v) => v.variant !== null && v.snapshot?.groundShippingOnly),
        subtotal,
        voucher,
        discount,
        freeShippingThreshold: config.freeShippingThreshold,
        shippingFee,
        total,
        shippingFeeWithoutVoucher: withoutVoucher.shippingFee,
        totalWithoutVoucher: withoutVoucher.total,
        policies: policies.map(({ slug, title }) => ({ slug, title })),
      }
      res.json(body)
    })
    .post('/', customerSession, async (req, res) => {
      const input = parse(CheckoutRequest, req.body)
      const placer = { customerId: req.auth?.subjectId ?? null, clientIp: req.ip, log: req.log }
      const body: CheckoutResult = await placement.checkout(input, placer)
      res.status(201).json(body)
    })
}
