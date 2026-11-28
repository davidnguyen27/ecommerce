import {
  PublicImage,
  type AccountOrderSummary,
  type AdminOrder,
  type AdminOrderSummary,
  type AttributeValues,
  type OrderHistoryActor,
  type OrderHistoryEntry,
  type OrderPreorder,
  type PublicOrder,
  type PublicRefund,
} from '@ecommerce/shared'
import { z } from 'zod'
import type { Storage } from '../../core/adapters/storage.ts'
import { StoredImage, imageRenditions } from '../../core/media/images.ts'
import { isoDay } from '../../core/utils/format.ts'
import type { Order, Prisma } from '../../generated/prisma/client.ts'
import type { PaymentGateway } from '../../core/adapters/payment/gateway.ts'
import { remainingOf, type OrderForView } from './order.constant.ts'
import type { OrderPorts } from './order.interface.ts'
import type { AdminOrderRow } from './order.repository.ts'

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

type OrderWithQuantities = Order & { lines: { quantity: number }[] }

/** A row of the signed-in customer's order list. */
export function toAccountOrderSummary(order: OrderWithQuantities): AccountOrderSummary {
  return {
    code: order.code,
    kind: order.kind,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    createdAt: order.createdAt.toISOString(),
    total: Number(order.total),
    itemCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
  }
}

/** A row of the admin order list. */
export function toAdminOrderSummary(order: OrderWithQuantities): AdminOrderSummary {
  return {
    ...toAccountOrderSummary(order),
    recipientName: order.recipientName,
    phone: order.phone,
    email: order.email,
    provinceName: order.provinceName,
  }
}

/** Admin order detail; refund totals come from the refunds port (ADR 0014). */
export function toAdminOrder(
  storage: Storage,
  payments: PaymentGateway,
  refunds: Pick<OrderPorts['refunds'], 'summarize' | 'viaGateway'>,
  order: AdminOrderRow,
): AdminOrder {
  // ADR 0014: received comes from transactions, refunded and refunding from refunds; payment status is unchanged.
  const totals = refunds.summarize(
    order.paymentTransactions.reduce((sum, t) => sum + t.amount, 0n),
    order.refunds,
  )
  const viaGateway = refunds.viaGateway(order.refunds)
  const gatewayRefundableOf = (t: (typeof order.paymentTransactions)[number]) =>
    payments.canRefund({ reference: t.reference, amount: Number(t.amount), source: t.source, payload: t.payload })
      ? Math.max(0, Number(t.amount - (viaGateway.get(t.id) ?? 0n)))
      : 0

  const eventActor = (event: (typeof order.events)[number]): OrderHistoryActor => {
    if (event.actor === 'staff') return { type: 'staff', ...event.staff! }
    if (event.actor === 'customer')
      return { type: 'customer', id: event.customer?.id ?? null, email: event.customer?.email ?? null }
    return { type: 'system' }
  }
  // Order events only: every staff action records an event with its actor; its audit is in the audit log.
  const history: OrderHistoryEntry[] = order.events.map((event) => ({
    action: event.kind,
    actor: eventActor(event),
    data: event.data,
    at: event.createdAt.toISOString(),
  }))

  const view = toPublicOrder(storage, order)
  return {
    ...view,
    lines: view.lines.map((line, i) => ({
      ...line,
      returnedQuantity: order.lines[i]!.returnedQuantity,
      writtenOffQuantity: order.lines[i]!.writtenOffQuantity,
    })),
    customerId: order.customerId,
    cancelNote: order.cancelNote,
    voucher:
      order.voucherId === null
        ? null
        : {
            id: order.voucherId,
            code: order.voucherCode!,
            kind: order.voucherKind!,
            amount: order.voucherAmount === null ? null : Number(order.voucherAmount),
            percent: order.voucherPercent,
            maxDiscount: order.voucherMaxDiscount === null ? null : Number(order.voucherMaxDiscount),
          },
    subtotalAfterDiscount: Number(order.subtotal - order.discount),
    payments: order.paymentTransactions.map((t) => ({
      id: t.id,
      purpose: t.purpose,
      amount: Number(t.amount),
      reference: t.reference,
      paidAt: t.paidAt.toISOString(),
      source: t.source,
      reconciliation: t.reconciliationItem && {
        id: t.reconciliationItem.id,
        reason: t.reconciliationItem.reason,
        status: t.reconciliationItem.status,
        resolution: t.reconciliationItem.resolution,
        note: t.reconciliationItem.note,
        resolvedBy: t.reconciliationItem.resolvedBy,
        resolvedAt: t.reconciliationItem.resolvedAt?.toISOString() ?? null,
      },
      gatewayRefundable: gatewayRefundableOf(t),
    })),
    refunded: Number(totals.refunded),
    refunding: Number(totals.refunding),
    refundable: Number(totals.refundable),
    gatewayRefundable: order.paymentTransactions.reduce((sum, t) => sum + gatewayRefundableOf(t), 0),
    refunds: order.refunds.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      origin: r.origin,
      status: r.status,
      method: r.method,
      reconciliationItemId: r.reconciliationItemId,
      retryOfId: r.retryOfId,
      retriedById: r.retriedBy?.id ?? null,
      paymentTransactionId: r.paymentTransactionId,
      bankReference: r.bankReference,
      transferredOn: r.transferredOn?.toISOString().slice(0, 10) ?? null,
      note: r.note,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      executedBy: r.executedBy,
      executedAt: r.executedAt?.toISOString() ?? null,
      settledBy: r.settledBy,
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    supportRequests: order.supportRequests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    history,
  }
}
