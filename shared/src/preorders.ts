import { z } from 'zod'
import { AuditActor } from './audit.ts'
import { AttributeValues } from './attributes.ts'
import { CartLine, InvoiceInfo, QuoteContact, ShippingAddress } from './checkout.ts'
import { FulfillmentStatus, OrderStatus, PaymentStatus } from './orders.ts'
import { PageQuery, pageOf } from './pagination.ts'
import { PreorderOffer, ProductStatus, PublicImage, VariantStatus } from './products.ts'
import { ProvinceCode } from './regions.ts'
import { VoucherCodeInput, VoucherConflict, VoucherQuote } from './vouchers.ts'

/** Campaign supply status; "arrived" is tracked per order, not here. */
export const PreorderSupplyStatus = z.enum(['not_ordered', 'ordered', 'in_transit', 'issue'])
export type PreorderSupplyStatus = z.infer<typeof PreorderSupplyStatus>

/** A variant open in the campaign and its allocation. */
export const PreorderCampaignVariantInput = z.object({
  variantId: z.uuid(),
  allocation: z.number().int().min(1, 'Số suất ít nhất là 1').max(100_000),
})
export type PreorderCampaignVariantInput = z.infer<typeof PreorderCampaignVariantInput>

const Variants = z
  .array(PreorderCampaignVariantInput)
  .min(1, 'Cần ít nhất một biến thể')
  .max(200)
  .superRefine((variants, ctx) => {
    const seen = new Set<string>()
    variants.forEach(({ variantId }, index) => {
      if (seen.has(variantId))
        ctx.addIssue({ code: 'custom', path: [index, 'variantId'], message: 'Biến thể bị trùng' })
      seen.add(variantId)
    })
  })

const CampaignFields = z.object({
  /** Percentage of goods the customer deposits. */
  depositPercent: z.number().int().min(10, 'Mức cọc từ 10%').max(100, 'Mức cọc tối đa 100%'),
  /** Expected delivery, `YYYY-MM-DD`. */
  deliveryFrom: z.iso.date(),
  deliveryTo: z.iso.date(),
  /** Closing time for pre-orders, ISO 8601; must be in the future when created or changed. */
  closesAt: z.iso.datetime({ offset: true }),
  /** Days the customer has to pay the remainder after arrival. */
  remainderDays: z.number().int().min(1, 'Ít nhất 1 ngày').max(90),
  supplyStatus: PreorderSupplyStatus,
  supplyNote: z.string().trim().max(2000),
  /** All campaign variants after saving: add new ones, change allocations, drop variants without orders. */
  variants: Variants,
})

const deliveryOrder = (value: { deliveryFrom?: string; deliveryTo?: string }, ctx: z.RefinementCtx) => {
  if (value.deliveryFrom && value.deliveryTo && value.deliveryFrom > value.deliveryTo) {
    ctx.addIssue({ code: 'custom', path: ['deliveryTo'], message: 'Ngày giao muộn nhất phải sau ngày sớm nhất' })
  }
}

/** Opens a pre-order campaign for one product. */
export const PreorderCampaignCreate = CampaignFields.extend({
  productId: z.uuid(),
  remainderDays: CampaignFields.shape.remainderDays.default(7),
  supplyStatus: PreorderSupplyStatus.default('not_ordered'),
  supplyNote: CampaignFields.shape.supplyNote.default(''),
}).superRefine(deliveryOrder)
export type PreorderCampaignCreate = z.input<typeof PreorderCampaignCreate>

/**
 * Edits a campaign: send only the fields to change. Once it has orders, deposit percent and remainder days are locked,
 * allocations cannot go below used, and variants with orders cannot be dropped. A closed campaign's closing time is
 * fixed.
 */
export const PreorderCampaignUpdate = CampaignFields.partial().superRefine(deliveryOrder)
export type PreorderCampaignUpdate = z.input<typeof PreorderCampaignUpdate>

export const PreorderCampaignQuery = PageQuery.extend({
  state: z.enum(['open', 'closed', 'all']).default('all'),
  productId: z.uuid().optional(),
})
export type PreorderCampaignQuery = z.infer<typeof PreorderCampaignQuery>

const CampaignHeader = z.object({
  id: z.string(),
  product: z.object({ id: z.string(), name: z.string(), slug: z.string(), status: ProductStatus }),
  depositPercent: z.number(),
  deliveryFrom: z.string(),
  deliveryTo: z.string(),
  closesAt: z.string(),
  remainderDays: z.number(),
  supplyStatus: PreorderSupplyStatus,
  supplyNote: z.string(),
  /** Present when staff closed it by hand. */
  closedAt: z.string().nullable(),
  /** Taking pre-orders: not closed by hand and not past its closing time. */
  isOpen: z.boolean(),
  createdAt: z.string(),
  createdBy: AuditActor,
})

/**
 * A campaign variant: allocation and used (total quantity of uncancelled pre-orders), of which deposited (fully paid
 * included) and awaiting deposit; arrived is units reserved from received stock for those orders.
 */
export const PreorderCampaignVariant = z.object({
  variantId: z.string(),
  sku: z.string(),
  attributes: AttributeValues,
  status: VariantStatus,
  allocation: z.number(),
  used: z.number(),
  deposited: z.number(),
  pendingDeposit: z.number(),
  arrived: z.number(),
})
export type PreorderCampaignVariant = z.infer<typeof PreorderCampaignVariant>

/** An uncancelled order of the campaign, in the campaign detail; by deposit time (pending deposits last). */
export const PreorderCampaignOrder = z.object({
  code: z.number(),
  recipientName: z.string(),
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  fulfillmentStatus: FulfillmentStatus,
  sku: z.string(),
  quantity: z.number(),
  arrivedQuantity: z.number(),
  depositPaidAt: z.string().nullable(),
  remainderDueAt: z.string().nullable(),
  remainderOverdueAt: z.string().nullable(),
})
export type PreorderCampaignOrder = z.infer<typeof PreorderCampaignOrder>

export const PreorderCampaign = CampaignHeader.extend({
  variants: z.array(PreorderCampaignVariant),
  orders: z.array(PreorderCampaignOrder),
})
export type PreorderCampaign = z.infer<typeof PreorderCampaign>

/**
 * `GET /api/admin/preorder-campaigns/attention` (ticket 10): pre-orders with an overdue remainder, and campaigns with a
 * supply problem that still have deposited orders not fully paid. `total` counts all items, for the dashboard badge.
 */
export const PreorderAttention = z.object({
  overdueOrders: z.array(
    z.object({
      code: z.number(),
      recipientName: z.string(),
      phone: z.string(),
      productName: z.string(),
      remainingAmount: z.number(),
      remainderDueAt: z.string(),
      remainderOverdueAt: z.string(),
    }),
  ),
  issueCampaigns: z.array(
    z.object({
      id: z.string(),
      productName: z.string(),
      supplyNote: z.string(),
      /** Deposited orders not fully paid (awaiting stock or the remainder). */
      depositedOrders: z.number(),
    }),
  ),
  total: z.number(),
})
export type PreorderAttention = z.infer<typeof PreorderAttention>

export const PreorderCampaignPage = pageOf(
  CampaignHeader.extend({ variantCount: z.number(), totalAllocation: z.number(), totalUsed: z.number() }),
)
export type PreorderCampaignPage = z.infer<typeof PreorderCampaignPage>

// Pre-order checkout (ADR 0012): outside the cart, one variant per order.

/**
 * Pre-order deposit: the campaign percentage of goods after discount (spec M5), rounded up to 1,000 VND, capped at
 * that amount. Shared by the API and the pre-order page so customers see exactly what they pay.
 */
export const depositFor = (subtotal: number, percent: number) =>
  Math.min(subtotal, Math.ceil((subtotal * percent) / 100 / 1000) * 1000)

/** Body of `POST /api/preorders/quote`. Without `provinceCode` no shipping fee is computed. */
export const PreorderQuoteRequest = z.object({
  variantId: z.uuid(),
  quantity: CartLine.shape.quantity,
  provinceCode: ProvinceCode.optional(),
  voucherCode: VoucherCodeInput.optional(),
  ...QuoteContact,
})
export type PreorderQuoteRequest = z.infer<typeof PreorderQuoteRequest>

/**
 * Pre-order quote as the customer would order now; writes nothing. `offer` is the variant's open campaign (`null` if
 * none), `problem` why this quantity cannot be ordered (`null` if it can). Amounts depending on shipping are `null`
 * before a province is picked.
 */
export const PreorderQuote = z.object({
  variantId: z.string(),
  quantity: z.number(),
  /** `null` when the variant is no longer for sale (discontinued, unpublished, missing). */
  product: z.object({ slug: z.string(), name: z.string() }).nullable(),
  sku: z.string().nullable(),
  attributes: AttributeValues.nullable(),
  image: PublicImage.nullable(),
  price: z.number().nullable(),
  offer: PreorderOffer.extend({ remainderDays: z.number() }).nullable(),
  /** Only `in_stock`, `campaign`, `sold_out`, `discontinued`: price and deposit come from this quote itself. */
  problem: z.lazy(() => PreorderChange).nullable(),
  subtotal: z.number().nullable(),
  /** Voucher result; `null` when no code was sent. */
  voucher: VoucherQuote.nullable(),
  /** Voucher discount, 0 without a code or when it does not apply. Deposit, shipping and total are after discount. */
  discount: z.number(),
  depositAmount: z.number().nullable(),
  shippingFee: z.number().nullable(),
  total: z.number().nullable(),
  /** Total due minus deposit, shipping included. */
  remainingAmount: z.number().nullable(),
  /** Amounts without the voucher, for comparison; equal to the fields above when there is no discount. */
  depositAmountWithoutVoucher: z.number().nullable(),
  totalWithoutVoucher: z.number().nullable(),
  /** The published pre-order policy; `null` if none, in which case pre-ordering is not possible. */
  preorderPolicy: z.object({ slug: z.string(), title: z.string() }).nullable(),
  /** The product's published returns and warranty policies. */
  policies: z.array(z.object({ slug: z.string(), title: z.string() })),
  groundShippingOnly: z.boolean(),
})
export type PreorderQuote = z.infer<typeof PreorderQuote>

/**
 * Body of `POST /api/preorders`. `campaignId`, `price` and `depositPercent` are what the customer saw: any difference
 * gives 409. A customer access token links the order to the account.
 */
export const PreorderRequest = z.object({
  variantId: z.uuid(),
  quantity: CartLine.shape.quantity,
  campaignId: z.uuid(),
  price: z.number().int().positive(),
  depositPercent: z.number().int().min(10).max(100),
  address: ShippingAddress,
  note: z.string().trim().max(1000).default(''),
  /** Guests must tick it, as at checkout. */
  acceptPrivacyPolicy: z.boolean().optional(),
  /** Every customer must tick it: has read the deposit, cancel/refund and remainder deadline terms. */
  acceptPreorderPolicy: z.boolean().optional(),
  invoice: InvoiceInfo.optional(),
  /** Voucher code and discount the customer saw; a difference at order time gives 409 with `details.voucher`. */
  voucherCode: VoucherCodeInput.optional(),
  discount: z.number().int().min(0).default(0),
})
export type PreorderRequest = z.input<typeof PreorderRequest>

/** Why the pre-order cannot be placed as seen. Never includes remaining allocation (ADR 0006). */
export const PreorderChange = z.discriminatedUnion('kind', [
  /** In stock now: buy instead of pre-ordering. */
  z.object({ kind: z.literal('in_stock') }),
  z.object({ kind: z.literal('price'), from: z.number(), to: z.number() }),
  z.object({ kind: z.literal('deposit'), from: z.number(), to: z.number() }),
  /** The campaign seen has closed or been replaced (delivery may differ). */
  z.object({ kind: z.literal('campaign') }),
  /** Not enough allocation left for the chosen quantity. */
  z.object({ kind: z.literal('sold_out') }),
  /** The variant is discontinued or the product unpublished. */
  z.object({ kind: z.literal('discontinued') }),
])
export type PreorderChange = z.infer<typeof PreorderChange>

/**
 * Response of `POST /api/orders/:code/pay-remainder` and `/api/account/orders/:code/pay-remainder`: a new
 * remaining-balance link and its expiry. `token` is a lookup token issued for customers coming from the account, so
 * the result page can open the order when the gateway sends them back; `null` when they already have one.
 */
export const PayRemainderResult = z.object({
  checkoutUrl: z.string(),
  expiresAt: z.string(),
  token: z.string().nullable(),
})
export type PayRemainderResult = z.infer<typeof PayRemainderResult>

/**
 * `error.details` of a pre-order 409: a change to the variant, campaign or price (`change`), or (when all of those
 * hold) the voucher no longer as seen (`voucher`). Nothing is written.
 */
export const PreorderConflictDetails = z.union([
  z.object({ change: PreorderChange }),
  z.object({ voucher: VoucherConflict }),
])
export type PreorderConflictDetails = z.infer<typeof PreorderConflictDetails>

/**
 * A campaign that cannot be supplied (M6a): deposited orders without arrived stock will be cancelled, each refunded in
 * full. Returned by `GET /api/admin/preorder-campaigns/:id/cancel-unsupplied` so the confirm dialog shows the order
 * count and total refund.
 */
export const UnsuppliedPreview = z.object({
  orders: z.array(z.object({ code: z.number(), recipientName: z.string(), refundAmount: z.number() })),
  refundTotal: z.number(),
})
export type UnsuppliedPreview = z.infer<typeof UnsuppliedPreview>

/** Body of `POST /api/admin/preorder-campaigns/:id/cancel-unsupplied`: a required note (what the supplier said). */
export const CancelUnsuppliedRequest = z.object({
  note: z
    .string({ error: 'Nhập ghi chú: nhà cung cấp báo gì' })
    .trim()
    .min(1, 'Nhập ghi chú: nhà cung cấp báo gì')
    .max(2000),
})
export type CancelUnsuppliedRequest = z.input<typeof CancelUnsuppliedRequest>

/** Bulk cancel result: cancelled order codes and the closed campaign. */
export const CancelUnsuppliedResult = z.object({
  cancelledOrderCodes: z.array(z.number()),
  campaign: PreorderCampaign,
})
export type CancelUnsuppliedResult = z.infer<typeof CancelUnsuppliedResult>
