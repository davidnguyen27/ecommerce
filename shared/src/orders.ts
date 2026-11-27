import { z } from 'zod'
import { AttributeValues } from './attributes.ts'
import { PageQuery, pageOf } from './pagination.ts'
import { PublicImage } from './products.ts'
import { AdminRefund, PublicRefund } from './refunds.ts'
import { SupportRequestKind, SupportRequestStatus } from './support.ts'

/** Order status (GLOSSARY "Trạng thái đơn hàng"). */
export const OrderStatus = z.enum(['pending_payment', 'processing', 'completed', 'cancelled'])
export type OrderStatus = z.infer<typeof OrderStatus>

/** Payment status; `deposit_paid` only for pre-orders (deposited, not fully paid). M6 adds refunds. */
export const PaymentStatus = z.enum(['unpaid', 'deposit_paid', 'paid'])
export type PaymentStatus = z.infer<typeof PaymentStatus>

/** Fulfillment status; `returned`: the warehouse got the goods back after a failed delivery (M6a). */
export const FulfillmentStatus = z.enum(['not_prepared', 'preparing', 'handed_over', 'delivered', 'failed', 'returned'])
export type FulfillmentStatus = z.infer<typeof FulfillmentStatus>

/** In-stock order (via the cart) or pre-order (GLOSSARY "Đơn đặt trước"). */
export const OrderKind = z.enum(['standard', 'preorder'])
export type OrderKind = z.infer<typeof OrderKind>

/**
 * Fixed amount off, or a percentage with a maximum (GLOSSARY "Mã giảm giá"). Declared here because orders snapshot the
 * voucher kind; `vouchers.ts` imports this file.
 */
export const VoucherKind = z.enum(['fixed', 'percent'])
export type VoucherKind = z.infer<typeof VoucherKind>

/**
 * The order's pre-order part, snapshotted at order time: deposit percent and amount, remaining balance (shipping
 * included), expected delivery and days allowed to pay the remainder after arrival.
 */
export const OrderPreorder = z.object({
  /** The order's campaign; the admin page links to its detail. */
  campaignId: z.string(),
  depositPercent: z.number(),
  depositAmount: z.number(),
  remainingAmount: z.number(),
  deliveryFrom: z.string(),
  deliveryTo: z.string(),
  remainderDays: z.number(),
  /** When the deposit was paid; `null` before. */
  depositPaidAt: z.string().nullable(),
  /** Units reserved from arrivals, out of the order's total quantity (ADR 0013). */
  arrivedQuantity: z.number(),
  quantity: z.number(),
  /** Full arrival time and remaining-balance deadline; `null` until fully arrived. */
  arrivedAt: z.string().nullable(),
  remainderDueAt: z.string().nullable(),
  /** When flagged as remainder overdue; `null` if not overdue or fully paid. */
  remainderOverdueAt: z.string().nullable(),
  /**
   * The campaign's current expected delivery; differs from `deliveryFrom`/`deliveryTo` (order time) if staff changed
   * it.
   */
  currentDeliveryFrom: z.string(),
  currentDeliveryTo: z.string(),
})
export type OrderPreorder = z.infer<typeof OrderPreorder>

/** Why an unpaid order was cancelled: reservation expired, customer cancelled, or staff cancelled. */
export const OrderCancelReason = z.enum(['expired', 'customer', 'staff'])
export type OrderCancelReason = z.infer<typeof OrderCancelReason>

/**
 * Why staff cancelled a paid order (M6a): customer changed mind, remainder overdue, supply failed, delivery failed,
 * other. Only on paid orders; `cancelReason` is then `staff`.
 */
export const OrderCancelCause = z.enum([
  'changed_mind',
  'remainder_overdue',
  'supply_failed',
  'delivery_failed',
  'other',
])
export type OrderCancelCause = z.infer<typeof OrderCancelCause>

/** The paid-order cancel cause as told to customers, following "vì": shared by email and order page. */
export const ORDER_CANCEL_CAUSE_CUSTOMER_TEXT: Record<OrderCancelCause, string> = {
  changed_mind: 'theo yêu cầu của bạn',
  remainder_overdue: 'đã quá hạn trả phần còn lại',
  supply_failed: 'cửa hàng không nhập được hàng',
  delivery_failed: 'đơn vị vận chuyển không giao được hàng',
  other: 'cửa hàng không thực hiện được đơn',
}

/** An order line as at checkout. */
export const OrderLineView = z.object({
  variantId: z.string(),
  sku: z.string(),
  productName: z.string(),
  attributes: AttributeValues,
  image: PublicImage.nullable(),
  price: z.number(),
  quantity: z.number(),
  lineTotal: z.number(),
  /** The voucher discount share of this line; 0 without a voucher or when the line is out of scope. */
  discount: z.number(),
})
export type OrderLineView = z.infer<typeof OrderLineView>

/**
 * The order as customers see it: via a token link (`GET /api/orders/:code?token=…`) and in the account (ticket 11).
 * Everything is a snapshot from checkout.
 */
export const PublicOrder = z.object({
  code: z.number(),
  kind: OrderKind,
  /** Present if and only if a pre-order. */
  preorder: OrderPreorder.nullable(),
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  fulfillmentStatus: FulfillmentStatus,
  createdAt: z.string(),
  /** Reservation deadline while awaiting payment; `null` when there is none. */
  reservedUntil: z.string().nullable(),
  /** Present when `cancelled`. */
  cancelReason: OrderCancelReason.nullable(),
  /** Present when staff cancelled a paid order. */
  cancelCause: OrderCancelCause.nullable(),
  cancelledAt: z.string().nullable(),
  address: z.object({
    recipientName: z.string(),
    phone: z.string(),
    email: z.string(),
    provinceCode: z.string(),
    provinceName: z.string(),
    wardCode: z.string(),
    wardName: z.string(),
    streetAddress: z.string(),
  }),
  note: z.string(),
  lines: z.array(OrderLineView),
  subtotal: z.number(),
  /** Voucher used at checkout; `null` without one. */
  voucherCode: z.string().nullable(),
  /** Voucher discount, taken off goods; 0 without a voucher. */
  discount: z.number(),
  shippingFee: z.number(),
  total: z.number(),
  /** Returns and warranty policy versions linked to the order's products at checkout. */
  policies: z.array(z.object({ slug: z.string(), title: z.string(), version: z.number() })),
  /** A guest's privacy consent at checkout; `null` when ordered signed in. */
  privacyConsent: z.object({ policyVersion: z.number(), consentedAt: z.string() }).nullable(),
  /** Company invoice info as at checkout; `null` without a company invoice. */
  invoice: z.object({ companyName: z.string(), taxCode: z.string(), address: z.string() }).nullable(),
  /** Handover: carrier, tracking number, handover time; `null` until handed over. */
  shipment: z.object({ carrier: z.string(), trackingNumber: z.string(), handedOverAt: z.string() }).nullable(),
  /** VND, total of every payment received for the order. */
  received: z.number(),
  /** Non-failed refunds, oldest first (ADR 0014). */
  refunds: z.array(PublicRefund),
})
export type PublicOrder = z.infer<typeof PublicOrder>

/** One order in the customer's purchase history (`GET /api/account/orders`). */
export const AccountOrderSummary = z.object({
  code: z.number(),
  kind: OrderKind,
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  fulfillmentStatus: FulfillmentStatus,
  createdAt: z.string(),
  total: z.number(),
  /** Total items (sum of line quantities). */
  itemCount: z.number(),
})
export type AccountOrderSummary = z.infer<typeof AccountOrderSummary>

/** Query string of `GET /api/account/orders`, newest first. */
export const AccountOrderQuery = PageQuery.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type AccountOrderQuery = z.infer<typeof AccountOrderQuery>

export const AccountOrderPage = pageOf(AccountOrderSummary)
export type AccountOrderPage = z.infer<typeof AccountOrderPage>

/**
 * Query string of `GET /api/admin/orders`. With nothing set it is the packing queue: fully paid, not prepared, oldest
 * first. Each status filter takes `all` to disable it. `q` searches order code, phone or email.
 */
export const AdminOrderQuery = PageQuery.extend({
  status: z.union([OrderStatus, z.literal('all')]).default('processing'),
  paymentStatus: z.union([PaymentStatus, z.literal('all')]).default('paid'),
  fulfillmentStatus: z.union([FulfillmentStatus, z.literal('all')]).default('not_prepared'),
  /** In-stock order or pre-order (ticket 10). */
  kind: z.union([OrderKind, z.literal('all')]).default('all'),
  /** Pre-orders of one campaign. */
  campaignId: z.uuid().optional(),
  /** `true`: only pre-orders with an overdue remainder (deposited, not fully paid). */
  remainderOverdue: z.stringbool().optional(),
  /** Orders that used this voucher (case-insensitive). */
  voucherCode: z.string().trim().max(40).optional(),
  /** `open`: only orders with an unfinished refund (pending or gateway processing). */
  refund: z.literal('open').optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['oldest', 'newest']).default('oldest'),
})
export type AdminOrderQuery = z.infer<typeof AdminOrderQuery>

export const AdminOrderSummary = AccountOrderSummary.extend({
  recipientName: z.string(),
  phone: z.string(),
  email: z.string(),
  provinceName: z.string(),
})
export type AdminOrderSummary = z.infer<typeof AdminOrderSummary>

export const AdminOrderPage = pageOf(AdminOrderSummary)
export type AdminOrderPage = z.infer<typeof AdminOrderPage>

/** How the payment was reported (`payment_source`). */
export const PaymentSource = z.enum(['webhook', 'query', 'simulator', 'return'])
export type PaymentSource = z.infer<typeof PaymentSource>

/** What a transaction collects: in-stock full payment, pre-order deposit or remaining balance. */
export const PaymentPurpose = z.enum(['full', 'deposit', 'remainder'])
export type PaymentPurpose = z.infer<typeof PaymentPurpose>

/** Why a payment needs reconciliation. */
export const ReconciliationReason = z.enum(['amount_mismatch', 'paid_after_cancel', 'extra_payment'])
export type ReconciliationReason = z.infer<typeof ReconciliationReason>

export const ReconciliationStatus = z.enum(['open', 'resolved'])
export type ReconciliationStatus = z.infer<typeof ReconciliationStatus>

/**
 * How a reconciliation item closes: order restored, handled outside the system, a refund of the item amount
 * (`refunded`), or auto-closed when a later payment made the order whole (`settled_by_payment`, no closer).
 */
export const ReconciliationResolution = z.enum(['restored', 'handled_externally', 'settled_by_payment', 'refunded'])
export type ReconciliationResolution = z.infer<typeof ReconciliationResolution>

/** A payment's reconciliation item; `resolution`, `resolvedBy`, `resolvedAt` once closed. */
export const ReconciliationDetail = z.object({
  id: z.string(),
  reason: ReconciliationReason,
  status: ReconciliationStatus,
  resolution: ReconciliationResolution.nullable(),
  note: z.string().nullable(),
  resolvedBy: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
  resolvedAt: z.string().nullable(),
})
export type ReconciliationDetail = z.infer<typeof ReconciliationDetail>

/** A payment the gateway reported for the order; `reconciliation` when it was flagged. */
export const AdminPaymentTransaction = z.object({
  id: z.string(),
  purpose: PaymentPurpose,
  amount: z.number(),
  reference: z.string(),
  paidAt: z.string(),
  source: PaymentSource,
  reconciliation: ReconciliationDetail.nullable(),
  /** VND still refundable via the gateway: 0 when the current gateway cannot refund it (e.g. simulated on VNPAY). */
  gatewayRefundable: z.number(),
})
export type AdminPaymentTransaction = z.infer<typeof AdminPaymentTransaction>

/** Who acted in the order history. Customers have `email` when signed in; lookup link holders `null`. */
export const OrderHistoryActor = z.discriminatedUnion('type', [
  z.object({ type: z.literal('staff'), id: z.string(), name: z.string(), email: z.string() }),
  z.object({ type: z.literal('customer'), id: z.string().nullable(), email: z.string().nullable() }),
  z.object({ type: z.literal('system') }),
])
export type OrderHistoryActor = z.infer<typeof OrderHistoryActor>

/**
 * One history row, oldest first: an order event (`action` is the event kind like `paid`, `cancelled`). One row per
 * action; the staff audit entry is on the audit log page.
 */
export const OrderHistoryEntry = z.object({
  action: z.string(),
  actor: OrderHistoryActor,
  data: z.unknown(),
  at: z.string(),
})
export type OrderHistoryEntry = z.infer<typeof OrderHistoryEntry>

/** Admin order detail: everything customers see, plus payment transactions and history. */
/** Admin order line: adds the latest return-to-stock result (M6a). Internal stock figures, hidden from customers. */
export const AdminOrderLine = OrderLineView.extend({
  returnedQuantity: z.number(),
  writtenOffQuantity: z.number(),
})
export type AdminOrderLine = z.infer<typeof AdminOrderLine>

export const AdminOrder = PublicOrder.extend({
  lines: z.array(AdminOrderLine),
  /** The customer account that ordered or was linked; `null` for guest orders. */
  customerId: z.string().nullable(),
  /** The voucher as at checkout (kind, amount) with its id for the voucher page; `null` without one. */
  voucher: z
    .object({
      id: z.string(),
      code: z.string(),
      kind: VoucherKind,
      amount: z.number().nullable(),
      percent: z.number().nullable(),
      maxDiscount: z.number().nullable(),
    })
    .nullable(),
  /** Goods after discount, the base for the free-shipping threshold and the deposit. */
  subtotalAfterDiscount: z.number(),
  payments: z.array(AdminPaymentTransaction),
  /** Internal note from cancelling a paid order. */
  cancelNote: z.string().nullable(),
  /** VND: total refunded, total refunding (pending or gateway processing); received is `received`. ADR 0014. */
  refunded: z.number(),
  refunding: z.number(),
  /** Still refundable: received minus every non-failed refund. */
  refundable: z.number(),
  /**
   * Total gateway-refundable part of the transactions (pending refunds not deducted, since they would go through the
   * gateway). A pending refund larger than this can only be paid by bank transfer.
   */
  gatewayRefundable: z.number(),
  /** Every refund including failed ones, with internal details; replaces the customer's `refunds`. */
  refunds: z.array(AdminRefund),
  /** The order's support requests, newest first (M6b). */
  supportRequests: z.array(
    z.object({
      code: z.number(),
      kind: SupportRequestKind,
      status: SupportRequestStatus,
      subject: z.string(),
      createdAt: z.string(),
    }),
  ),
  history: z.array(OrderHistoryEntry),
})
export type AdminOrder = z.infer<typeof AdminOrder>

/** Body of `POST /api/admin/orders/:code/hand-over`: one order is one parcel, one tracking number. */
export const HandoverRequest = z.object({
  carrier: z.string().trim().min(1, 'Cần đơn vị vận chuyển').max(100),
  trackingNumber: z.string().trim().min(1, 'Cần mã vận đơn').max(100),
})
export type HandoverRequest = z.infer<typeof HandoverRequest>

/** Body of `POST /api/admin/orders/:code/redeliver`: redeliver a failed delivery with a new carrier and tracking. */
export const RedeliverRequest = HandoverRequest
export type RedeliverRequest = HandoverRequest

/**
 * Body of `POST /api/admin/orders/:code/return-to-stock`: per order line (by variant), units restocked and written
 * off; the two add up to the line quantity, checked by the API. Every line must appear exactly once.
 */
export const ReturnToStockRequest = z.object({
  lines: z
    .array(
      z.object({
        variantId: z.string(),
        restocked: z.number().int().min(0),
        writtenOff: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(100),
})
export type ReturnToStockRequest = z.infer<typeof ReturnToStockRequest>

/**
 * Body of `POST /api/admin/orders/:code/cancel-paid`: cause and proposed refund (0 up to the refundable amount). Less
 * than refundable needs a note; `supply_failed` always refunds in full. Checked by the API, which knows the amounts.
 */
export const CancelPaidOrderRequest = z.object({
  cause: OrderCancelCause,
  refundAmount: z.number().int().min(0, 'Số tiền hoàn không âm'),
  note: z.string().trim().max(2000).optional(),
})
export type CancelPaidOrderRequest = z.input<typeof CancelPaidOrderRequest>

/**
 * Whether the customer can request a cancel (spec M6b ticket 03): processing, paid or deposited, not handed over.
 * Unpaid orders are cancelled with the existing button; after handover only a return is possible.
 */
export function canRequestCancel(order: {
  status: OrderStatus
  paymentStatus: PaymentStatus
  fulfillmentStatus: FulfillmentStatus
}) {
  return (
    order.status === 'processing' &&
    (order.paymentStatus === 'paid' || order.paymentStatus === 'deposit_paid') &&
    (order.fulfillmentStatus === 'not_prepared' || order.fulfillmentStatus === 'preparing')
  )
}

type OrderState = { status: OrderStatus; paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus }

/**
 * Whether staff can cancel a paid order with a refund (spec M6a): processing, paid or deposited, and either not handed
 * over or a failed delivery already returned to stock. Cancelling keeps `fulfillmentStatus`, so `status` must be checked.
 */
export function canCancelPaid(order: OrderState) {
  return (
    order.status === 'processing' &&
    (order.paymentStatus === 'paid' || order.paymentStatus === 'deposit_paid') &&
    (order.fulfillmentStatus === 'not_prepared' ||
      order.fulfillmentStatus === 'preparing' ||
      order.fulfillmentStatus === 'returned')
  )
}

/** Delivered and completed: only then can the customer return, exchange or claim warranty (spec M6b). */
export function isDelivered(order: Pick<OrderState, 'status' | 'fulfillmentStatus'>) {
  return order.status === 'completed' && order.fulfillmentStatus === 'delivered'
}
