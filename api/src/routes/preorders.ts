import { Router } from 'express'
import {
  PreorderQuoteRequest,
  PreorderRequest,
  type CheckoutResult,
  type PreorderQuote,
  type VoucherQuote,
} from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { optionalAuth } from '../core/middleware/require-auth.ts'
import { livePolicyVersions, storedImageOf } from '../placement/order-snapshot.ts'
import { findCurrentPreorderPolicy } from '../content/pages.ts'
import { parse } from '../core/middleware/validation.ts'
import { imageRenditions } from '../core/media/images.ts'
import { isoDay } from '../core/utils/format.ts'
import { orderPlacement } from '../placement/place-order.ts'
import { priceOrder } from '../placement/price-order.ts'
import { checkPreorder } from '../preorders/check.ts'
import { requireShippingFeeConfig } from '../shipping/shipping-fees.ts'
import { quoteVoucher } from '../vouchers/apply.ts'

/**
 * Pre-order quote and placement (ADR 0012, 0013). No sign-in needed; a customer access token links the order to the
 * account.
 */
export function preorderRoutes(deps: AppDeps) {
  const { prisma, storage, jwtSecret } = deps
  const customerSession = optionalAuth(new TextEncoder().encode(jwtSecret), 'customer')
  const placement = orderPlacement(deps)
  return Router()
    .post('/quote', async (req, res) => {
      const input = parse(PreorderQuoteRequest, req.body)
      const [config, preorderPolicy, check] = await Promise.all([
        requireShippingFeeConfig(prisma),
        findCurrentPreorderPolicy(prisma),
        checkPreorder(prisma, input.variantId, input.quantity),
      ])
      const { found, campaign, problem } = check
      const { snapshot, variant } = found
      const policies = await livePolicyVersions(prisma, [found])
      const image = variant && storedImageOf(found)
      const subtotal = variant ? variant.price * input.quantity : null

      let voucher: VoucherQuote | null = null
      if (input.voucherCode !== undefined) {
        voucher = await quoteVoucher(prisma, req, input.voucherCode, {
          saleType: 'preorder',
          lines:
            variant && snapshot
              ? [
                  {
                    variantId: variant.id,
                    brandId: snapshot.brandId,
                    categoryId: snapshot.categoryId,
                    price: variant.price,
                    quantity: input.quantity,
                  },
                ]
              : [],
          customer: { email: input.email, phone: input.phone },
        })
      }
      const discount = voucher?.applied ? voucher.discount : 0
      /** Fee, total and deposit after `discount`; all `null` without a variant. */
      const amounts = (discount: number) =>
        subtotal === null
          ? { shippingFee: null, total: null, depositAmount: null }
          : priceOrder(config, {
              subtotal,
              discount,
              provinceCode: input.provinceCode,
              depositPercent: campaign?.depositPercent,
            })
      const { shippingFee, total, depositAmount } = amounts(discount)
      const withoutVoucher = amounts(0)

      const body: PreorderQuote = {
        variantId: input.variantId,
        quantity: input.quantity,
        product: variant && snapshot && { slug: snapshot.slug, name: snapshot.name },
        sku: variant?.sku ?? null,
        attributes: variant?.attributes ?? null,
        image: image ? { ...imageRenditions(storage, image), alt: image.alt } : null,
        price: variant?.price ?? null,
        offer: campaign && {
          campaignId: campaign.id,
          depositPercent: campaign.depositPercent,
          deliveryFrom: isoDay(campaign.deliveryFrom),
          deliveryTo: isoDay(campaign.deliveryTo),
          remainderDays: campaign.remainderDays,
        },
        problem: problem && { kind: problem },
        subtotal,
        voucher,
        discount,
        depositAmount,
        shippingFee,
        total,
        remainingAmount: total === null || depositAmount === null ? null : total - depositAmount,
        depositAmountWithoutVoucher: withoutVoucher.depositAmount,
        totalWithoutVoucher: withoutVoucher.total,
        preorderPolicy: preorderPolicy && { slug: preorderPolicy.page.slug, title: preorderPolicy.title },
        policies: policies.map(({ slug, title }) => ({ slug, title })),
        groundShippingOnly: Boolean(variant && snapshot?.groundShippingOnly),
      }
      res.json(body)
    })
    .post('/', customerSession, async (req, res) => {
      const input = parse(PreorderRequest, req.body)
      const placer = { customerId: req.auth?.subjectId ?? null, clientIp: req.ip, log: req.log }
      const body: CheckoutResult = await placement.preorder(input, placer)
      res.status(201).json(body)
    })
}
