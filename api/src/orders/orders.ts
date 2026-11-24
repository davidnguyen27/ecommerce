import {
  ErrorCode,
  PublicImage,
  type AttributeValues,
  type OrderPreorder,
  type PublicOrder,
  type PublicRefund,
} from '@ecommerce/shared'
import { z } from 'zod'
import type { Storage } from '../adapters/storage.ts'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import type { DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { StoredImage, imageRenditions } from '../media/images.ts'
import { isoDay } from './format.ts'

/**
 * Refunds as customers see them. Failed ones are hidden: customers only need to know money is coming or came;
 * accounting creates a new refund if needed.
 */
export function toPublicRefunds(
  refunds: readonly { amount: bigint; status: string; createdAt: Date; completedAt: Date | null }[],
): PublicRefund[] {
  return refunds
    .filter((r) => r.status !== 'failed')
    .map((r) => ({
      amount: Number(r.amount),
      status: r.status === 'succeeded' ? 'refunded' : 'refunding',
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }))
}

/** Thumbnail stored on an order line: a public bucket file with `alt`. */
export const OrderLineImage = StoredImage.extend({ alt: z.string() })
export type OrderLineImage = z.infer<typeof OrderLineImage>

/**
 * Order history event kinds: `paid` when fully paid, `payment_flagged` when a payment needs reconciliation, `cancelled`
 * when an unpaid order is cancelled (`data.reason` is `OrderCancelReason`, expiry included), `preparing` when packing
 * starts, `handed_over` at handover (`data` has `carrier`, `trackingNumber`), `delivered` when delivered (order
 * complete), `delivery_failed` when delivery fails (still processing).
 */
export type OrderEventKind =
  | 'created'
  | 'paid'
  /** A pre-order received its full deposit (M4). */
  | 'deposit_paid'
  /** A receipt reserved part of the arrived stock for a pre-order (`data`: variant, quantity, receipt; ADR 0013). */
  | 'stock_allocated'
  /** A pre-order is fully reserved: the remaining-balance deadline starts. */
  | 'arrived'
  /** Remaining-balance reminder email sent (ticket 08). */
  | 'remainder_reminded'
  /** Remaining balance overdue: flagged, not cancelled (`data.remainderDueAt`). */
  | 'remainder_overdue'
  /**
   * Staff changed the campaign's expected delivery and the customer was told (`data.before`, `data.after`; ticket 09).
   */
  | 'delivery_changed'
  | 'payment_flagged'
  | 'cancelled'
  | 'preparing'
  | 'handed_over'
  /** Accounting restored a cancelled order once the money arrived in full (reconciliation). */
  | 'restored'
  /**
   * Accounting closed a reconciliation item: handled outside the system, or by refund (`data.resolution = refunded`).
   */
  | 'reconciliation_resolved'
  /** A refund was created, awaiting accounting (`data`: `refundId`, `amount`, `origin`; ADR 0014). */
  | 'refund_created'
  /** A refund completed: manually, gateway success, or settled by accounting. */
  | 'refund_succeeded'
  /** A refund failed; it can be recreated. */
  | 'refund_failed'
  | 'delivered'
  | 'delivery_failed'
  /** A failed delivery was redelivered with a new tracking number (`data.previous`: the old one; M6a). */
  | 'redelivered'
  /** The warehouse received returned goods: per line restocked or written off (`data.lines`). */
  | 'returned_to_stock'
  /** Redelivery from stock: reserved again for the order, back to not prepared. */
  | 'restocked_for_redelivery'
  /** Cancelling the order closed the customer's cancel requests (`data.requestCodes`; M6b). */
  | 'support_resolved'

/** Who acted: staff, customer (with id when signed in) or the system. */
export type OrderEventActor =
  { type: 'staff'; staffId: string } | { type: 'customer'; customerId?: string } | { type: 'system' }

/** Appends an event to the order history. Call in the state change's transaction. */
export async function recordOrderEvent(
  db: DbClient,
  orderId: string,
  kind: OrderEventKind,
  actor: OrderEventActor,
  data: Prisma.InputJsonObject = {},
) {
  await db.orderEvent.create({
    data: {
      orderId,
      kind,
      actor: actor.type,
      staffId: actor.type === 'staff' ? actor.staffId : null,
      customerId: actor.type === 'customer' ? (actor.customerId ?? null) : null,
      data,
    },
  })
}

/** Website order lookup link, emailed to the customer. */
export function orderLookupUrl(siteUrl: string, code: number, token: string) {
  const url = new URL(`/don-hang/${code}`, siteUrl)
  url.searchParams.set('token', token)
  return url
}

/**
 * The payment result page the gateway sends customers back to. No token: the gateway must not see the view/cancel link;
 * the browser keeps the token from the checkout response.
 */
export function paymentResultUrl(siteUrl: string, code: number) {
  const url = new URL(`/don-hang/${code}`, siteUrl)
  url.searchParams.set('ket-qua', '1')
  return url
}

/** Issues another lookup token for the order (hash stored) and returns the link, for emails. */
export async function issueOrderLookupUrl(db: DbClient, siteUrl: string, order: { id: string; code: number }) {
  const token = newOpaqueToken()
  await db.orderLookupToken.create({ data: { orderId: order.id, tokenHash: hashOpaqueToken(token) } })
  return orderLookupUrl(siteUrl, order.code, token)
}

/** Enough to build a `PublicOrder`. */
export const ORDER_VIEW_INCLUDE = {
  lines: { orderBy: { position: 'asc' } },
  policyVersions: { include: { pageVersion: { include: { page: { select: { slug: true } } } } } },
  privacyPolicyVersion: { select: { version: true } },
  // The campaign's current expected delivery, next to the promise made at order time (ticket 09).
  preorderCampaign: { select: { deliveryFrom: true, deliveryTo: true } },
  // Received amount and the refunds customers see (ADR 0014).
  paymentTransactions: { select: { amount: true } },
  refunds: {
    select: { amount: true, status: true, createdAt: true, completedAt: true },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.OrderInclude

export type OrderForView = Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>

export const orderNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/** Order code from the URL as a number; a non-code string is 404, like a code with no order. */
export function parseOrderCode(code: string) {
  if (!/^\d{1,9}$/.test(code)) throw orderNotFound()
  return Number(code)
}

/**
 * Order by code and lookup token. Unknown code, missing or wrong token are all the same 404, so no order's existence
 * leaks. `code` is the URL string.
 */
export async function findOrderByToken(db: DbClient, code: string, token: string | undefined) {
  if (!token) throw orderNotFound()
  const orderCode = parseOrderCode(code)
  const hash = hashOpaqueToken(token)
  const order = await db.order.findFirst({
    where: { code: orderCode, OR: [{ lookupTokenHash: hash }, { lookupTokens: { some: { tokenHash: hash } } }] },
    include: ORDER_VIEW_INCLUDE,
  })
  if (!order) throw orderNotFound()
  return order
}

/**
 * Order by code for the signed-in customer. Someone else's order is also 404, like an unknown code, so nothing leaks.
 * `code` is the URL string.
 */
export async function findCustomerOrder(db: DbClient, code: string, customerId: string) {
  const order = await db.order.findFirst({
    where: { code: parseOrderCode(code), customerId },
    include: ORDER_VIEW_INCLUDE,
  })
  if (!order) throw orderNotFound()
  return order
}

/** Deposited pre-orders not fully paid: waiting for stock or for the remaining balance. */
export const DEPOSITED_PREORDER = {
  kind: 'preorder',
  status: 'processing',
  paymentStatus: 'deposit_paid',
} as const satisfies Prisma.OrderWhereInput

/** A pre-order's remaining balance: total minus deposit, shipping included (GLOSSARY "Phần còn lại"). */
export const remainingOf = (order: { total: bigint; depositAmount: bigint | null }) =>
  order.total - order.depositAmount!

/** The order's pre-order part; `null` for in-stock orders (`order_preorder_check` guarantees the fields). */
export function preorderOf(
  order: Pick<
    OrderForView,
    | 'kind'
    | 'preorderCampaignId'
    | 'total'
    | 'depositPercent'
    | 'depositAmount'
    | 'deliveryFrom'
    | 'deliveryTo'
    | 'remainderDays'
    | 'depositPaidAt'
    | 'arrivedAt'
    | 'remainderDueAt'
    | 'remainderOverdueAt'
    | 'lines'
    | 'preorderCampaign'
  >,
): OrderPreorder | null {
  const { depositPercent, depositAmount, deliveryFrom, deliveryTo, remainderDays } = order
  if (order.kind !== 'preorder' || depositPercent === null || depositAmount === null) return null
  if (deliveryFrom === null || deliveryTo === null || remainderDays === null) return null
  const quantity = order.lines.reduce((sum, line) => sum + line.quantity, 0)
  return {
    campaignId: order.preorderCampaignId!,
    // Fully arrived stays fully arrived, even after handover drops the reserved count to 0.
    arrivedQuantity: order.arrivedAt ? quantity : order.lines.reduce((sum, line) => sum + line.reservedQuantity, 0),
    quantity,
    arrivedAt: order.arrivedAt?.toISOString() ?? null,
    remainderDueAt: order.remainderDueAt?.toISOString() ?? null,
    remainderOverdueAt: order.remainderOverdueAt?.toISOString() ?? null,
    currentDeliveryFrom: isoDay(order.preorderCampaign?.deliveryFrom ?? deliveryFrom),
    currentDeliveryTo: isoDay(order.preorderCampaign?.deliveryTo ?? deliveryTo),
    depositPercent,
    depositAmount: Number(depositAmount),
    remainingAmount: Number(remainingOf(order)),
    deliveryFrom: isoDay(deliveryFrom),
    deliveryTo: isoDay(deliveryTo),
    remainderDays,
    depositPaidAt: order.depositPaidAt?.toISOString() ?? null,
  }
}

export function toPublicOrder(storage: Storage, order: OrderForView): PublicOrder {
  const image = (value: Prisma.JsonValue): PublicImage | null => {
    if (value === null) return null
    const stored = OrderLineImage.parse(value)
    return { ...imageRenditions(storage, stored), alt: stored.alt }
  }
  return {
    code: order.code,
    kind: order.kind,
    preorder: preorderOf(order),
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    createdAt: order.createdAt.toISOString(),
    reservedUntil: order.reservedUntil?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    cancelCause: order.cancelCause,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    address: {
      recipientName: order.recipientName,
      phone: order.phone,
      email: order.email,
      provinceCode: order.provinceCode,
      provinceName: order.provinceName,
      wardCode: order.wardCode,
      wardName: order.wardName,
      streetAddress: order.streetAddress,
    },
    note: order.note,
    lines: order.lines.map((line) => ({
      variantId: line.variantId,
      sku: line.sku,
      productName: line.productName,
      attributes: line.attributes as AttributeValues,
      image: image(line.image),
      price: Number(line.price),
      quantity: line.quantity,
      lineTotal: Number(line.price) * line.quantity,
      discount: Number(line.discount),
    })),
    subtotal: Number(order.subtotal),
    voucherCode: order.voucherCode,
    discount: Number(order.discount),
    shippingFee: Number(order.shippingFee),
    total: Number(order.total),
    policies: order.policyVersions
      .map(({ pageVersion }) => ({
        slug: pageVersion.page.slug,
        title: pageVersion.title,
        version: pageVersion.version,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    privacyConsent: order.privacyPolicyVersion && {
      policyVersion: order.privacyPolicyVersion.version,
      consentedAt: order.createdAt.toISOString(),
    },
    invoice:
      order.invoiceCompanyName === null || order.invoiceTaxCode === null || order.invoiceAddress === null
        ? null
        : { companyName: order.invoiceCompanyName, taxCode: order.invoiceTaxCode, address: order.invoiceAddress },
    shipment:
      order.carrier === null || order.trackingNumber === null || order.handedOverAt === null
        ? null
        : {
            carrier: order.carrier,
            trackingNumber: order.trackingNumber,
            handedOverAt: order.handedOverAt.toISOString(),
          },
    received: order.paymentTransactions.reduce((sum, t) => sum + Number(t.amount), 0),
    // Failed refunds are hidden: customers only need to know money is coming or came; accounting recreates if needed.
    refunds: toPublicRefunds(order.refunds),
  }
}
