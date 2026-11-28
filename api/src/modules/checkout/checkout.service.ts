import type { z } from 'zod'
import type {
  CheckoutQuote,
  CheckoutQuoteRequest,
  PreorderQuote,
  PreorderQuoteRequest,
  QuoteLine,
  VoucherQuote,
} from '@ecommerce/shared'
import type { Storage } from '../../core/adapters/storage.ts'
import type { Db } from '../../core/db.ts'
import { imageRenditions } from '../../core/media/images.ts'
import { isoDay } from '../../core/utils/format.ts'
import { findCurrentPreorderPolicy } from '../../content/pages.ts'
import { requireShippingFeeConfig } from '../shipping-fee/index.ts'
import { quoteVoucher, type VoucherLine } from '../voucher/index.ts'
import { checkPreorder } from '../preorder-campaign/index.ts'
import { cartVariants } from '../product/index.ts'
import type { IStockLedger } from '../stock/index.ts'
import { livePolicyVersions, storedImageOf } from './order-snapshot.ts'
import { priceOrder } from './price-order.ts'

/**
 * Quotes for the cart and for a pre-order: what the customer sees before placing. Nothing is reserved; placing goes
 * through `orderPlacement`. `clientIp` counts voucher guesses against that IP's limit.
 */
export class CheckoutService {
  constructor(
    private readonly prisma: Db,
    private readonly storage: Storage,
    private readonly stock: Pick<IStockLedger, 'enoughStockIds'>,
  ) {}

  async quote(input: z.output<typeof CheckoutQuoteRequest>, clientIp: string): Promise<CheckoutQuote> {
    const { prisma, storage } = this
    const config = await requireShippingFeeConfig(prisma)
    const ids = input.lines.map((l) => l.variantId)
    const [variants, stocked] = await Promise.all([
      cartVariants(prisma, ids),
      this.stock.enoughStockIds(prisma, input.lines),
    ])
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
      voucher = await quoteVoucher(prisma, clientIp, input.voucherCode, {
        saleType: 'standard',
        lines: buyable,
        customer: { email: input.email, phone: input.phone },
      })
    }
    const discount = voucher?.applied ? voucher.discount : 0
    const { shippingFee, total } = priceOrder(config, { subtotal, discount, provinceCode: input.provinceCode })
    const withoutVoucher = priceOrder(config, { subtotal, discount: 0, provinceCode: input.provinceCode })

    return {
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
  }

  /** Pre-order quote (ADR 0012, 0013): deposit, remaining balance, the campaign's offer or why there is none. */
  async preorderQuote(input: z.output<typeof PreorderQuoteRequest>, clientIp: string): Promise<PreorderQuote> {
    const { prisma, storage } = this
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
      voucher = await quoteVoucher(prisma, clientIp, input.voucherCode, {
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

    return {
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
  }
}
