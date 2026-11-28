import {
  ErrorCode,
  ORDER_CANCEL_CAUSE_CUSTOMER_TEXT,
  canCancelPaid,
  type CancelPaidOrderRequest,
  type FulfillmentStatus,
  type OrderCancelCause,
  type OrderKind,
  type OrderStatus,
  type PaymentStatus,
} from '@ecommerce/shared'
import type { Audit, AuditedRun } from '../core/audit/audited.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../core/errors.ts'
import type { CustomerMail } from '../core/jobs/jobs.ts'
import { createRefund, refundTotals } from '../payments/refunds.ts'
import { applyArrivals, planArrivals } from '../preorders/arrivals.ts'
import { resolveCancelRequests } from '../support/support.ts'
import { cancelOrderPaymentLinks, releaseOrderReservations, type CancelDeps } from './cancel-order.ts'
import { vnd } from './format.ts'
import { issueOrderLookupUrl, recordOrderEvent } from './orders.ts'

const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)

/**
 * Staff cancel of a paid order (GLOSSARY "Hủy đơn", spec M6a) in the `audited()` transaction: locks the order (same
 * lock as payment, fulfillment and refunds) and checks it is processing, paid or deposited, and not handed over.
 * Releases reservations, sets `cancelled` (reason `staff` with `cancel_cause`), creates a pending refund when the
 * amount is > 0, records the event and audit, and queues the "Đơn đã hủy" email.
 * Refund: 0 up to the refundable amount; less needs a note; supply failure needs a full refund. Otherwise 400. Payment
 * status is unchanged (ADR 0014). Voucher uses free up since uses count only uncancelled orders (M5).
 */
export async function cancelPaidOrder(
  tx: Prisma.TransactionClient,
  mail: CustomerMail,
  audit: Audit,
  orderId: string,
  staffId: string,
  input: CancelPaidOrderRequest,
  { reallocate = true }: { reallocate?: boolean } = {},
) {
  const [locked] = await tx.$queryRaw<
    { status: OrderStatus; paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus; kind: OrderKind }[]
  >`
    SELECT "status"::text AS status, "payment_status"::text AS "paymentStatus",
      "fulfillment_status"::text AS "fulfillmentStatus", "kind"::text AS kind
    FROM "order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
  if (!locked) throw new Error(`Không có đơn ${orderId}`)
  // The rule lives in `canCancelPaid` (the admin page uses it too); the branches below only pick the message.
  if (!canCancelPaid(locked)) {
    const paid = locked.status === 'processing' && ['paid', 'deposit_paid'].includes(locked.paymentStatus)
    // `returned`: delivery failed and the warehouse got the goods back. `failed` must be returned first.
    throw conflict(
      paid
        ? 'Đơn đã bàn giao vận chuyển, không hủy được; giao thất bại thì nhận hàng hoàn về trước'
        : 'Chỉ hủy được đơn đang xử lý đã nhận tiền; đơn chưa thanh toán dùng nút hủy thường',
    )
  }
  const { refundable } = await refundTotals(tx, orderId)
  const refundAmount = BigInt(input.refundAmount)
  const note = input.note?.trim() || null
  if (refundAmount > refundable) {
    throw invalidField('refundAmount', `Số tiền hoàn vượt số còn hoàn được ${vnd(refundable)}`)
  }
  // Only pre-orders have a remaining balance; for regular orders the customer would read a meaningless reason.
  if (input.cause === 'remainder_overdue' && locked.kind !== 'preorder') {
    throw invalidField('cause', 'Đơn thường không có phần còn lại phải trả; chọn lý do khác')
  }
  if (input.cause === 'supply_failed' && refundAmount !== refundable) {
    throw invalidField('refundAmount', `Không nhập được hàng thì hoàn đủ ${vnd(refundable)}`)
  }
  if (refundAmount < refundable && !note) {
    throw invalidField('note', 'Hoàn ít hơn số còn hoàn được thì cần ghi lý do')
  }

  // Pre-order stock held for this order (fully or partly arrived) passes to the next waiting order by deposit order
  // (ADR 0013), so remember what is released before releasing it.
  const released =
    locked.kind === 'preorder'
      ? await tx.orderLine.findMany({
          where: { orderId, reservedQuantity: { gt: 0 } },
          select: { variantId: true, reservedQuantity: true },
        })
      : []
  await releaseOrderReservations(tx, orderId)
  const order = await tx.order.update({
    where: { id: orderId },
    data: {
      status: 'cancelled',
      cancelReason: 'staff',
      cancelCause: input.cause,
      cancelNote: note,
      cancelledAt: new Date(),
      reservedUntil: null,
    },
  })
  await recordOrderEvent(
    tx,
    orderId,
    'cancelled',
    { type: 'staff', staffId },
    { reason: 'staff', cause: input.cause, refundAmount: Number(refundAmount) },
  )
  // The order is now `cancelled`, so `planArrivals` (waiting pre-orders only) never reallocates to it. `reallocate:
  // false` (bulk cancel when a campaign cannot be supplied): held stock becomes regular stock instead of passing to
  // orders about to be cancelled.
  const plans =
    reallocate && released.length
      ? await planArrivals(
          tx,
          released.map((l) => ({ variantId: l.variantId, quantity: l.reservedQuantity })),
          { lock: true },
        )
      : []
  const arrivedOrderCodes = plans.length ? await applyArrivals(tx, mail, plans, { fromOrderCode: order.code }) : []
  const reallocated = plans.flatMap((p) =>
    p.allocations.map((a) => ({ orderCode: a.orderCode, variantId: p.variantId, quantity: a.take })),
  )
  const refund =
    refundAmount > 0n
      ? await createRefund(tx, {
          orderId,
          amount: refundAmount,
          origin: 'cancellation',
          note: note ?? undefined,
          staffId,
        })
      : null
  await audit({
    action: 'order.cancel_paid',
    entityType: 'order',
    entityId: orderId,
    before: { status: locked.status, paymentStatus: locked.paymentStatus, fulfillmentStatus: locked.fulfillmentStatus },
    after: {
      status: 'cancelled',
      cancelReason: 'staff',
      cancelCause: input.cause,
      cancelNote: note,
      refundAmount: Number(refundAmount),
      refundId: refund?.id ?? null,
      ...(reallocated.length && { reallocated, arrivedOrderCodes }),
    },
  })
  // The customer's cancel requests (M6b) are resolved with the cancel.
  const resolvedRequestCodes = await resolveCancelRequests(tx, orderId)
  if (resolvedRequestCodes.length) {
    await recordOrderEvent(
      tx,
      orderId,
      'support_resolved',
      { type: 'staff', staffId },
      { requestCodes: resolvedRequestCodes },
    )
  }
  await queueCancelledEmail(tx, mail, order, input.cause, refundAmount, refundable)
  return order.code
}

/**
 * "Đơn đã hủy" email: the reason as told to customers, the refund amount, the non-refunded part (forfeited deposit,
 * deduction) with a pointer to the order's policy, and a lookup link with a new token. `refundable` is as of cancel.
 */
async function queueCancelledEmail(
  tx: Prisma.TransactionClient,
  { emails, siteUrl }: CustomerMail,
  order: { id: string; code: number; kind: string; email: string; recipientName: string },
  cause: OrderCancelCause,
  refundAmount: bigint,
  refundable: bigint,
) {
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  const policy = order.kind === 'preorder' ? 'chính sách đặt trước' : 'chính sách'
  const kept = refundable - refundAmount
  const refundText = [
    refundAmount > 0n
      ? `Chúng tôi sẽ hoàn ${vnd(refundAmount)} cho bạn và gửi email khi tiền đã được chuyển.`
      : `Đơn này không được hoàn tiền theo ${policy} đã áp dụng cho đơn.`,
    ...(refundAmount > 0n && kept > 0n ? [`Phần không hoàn: ${vnd(kept)}, theo ${policy} đã áp dụng cho đơn.`] : []),
  ]
  // Draft, awaiting the owner's approval of the wording.
  await emails.sendEmail(tx, {
    to: order.email,
    subject: `Đơn hàng #${order.code} đã bị hủy`,
    text: [
      `Chào ${order.recipientName},`,
      '',
      `Đơn hàng #${order.code} đã bị hủy vì ${ORDER_CANCEL_CAUSE_CUSTOMER_TEXT[cause]}.`,
      ...refundText,
      '',
      `Xem đơn hàng: ${link}`,
      '',
      'Nếu cần hỗ trợ, bạn hãy trả lời email này hoặc gọi cho cửa hàng.',
    ].join('\n'),
  })
}

/**
 * Staff cancel of a paid order from the admin page: `cancelPaidOrder` in the audited transaction, then cancels payment
 * links after commit. Pre-orders may still have a remaining-balance link; money arriving later needs reconciliation.
 * Cancelling an in-stock order's already-paid link is harmless: errors are only logged.
 */
export async function cancelPaidOrderByStaff(
  deps: CancelDeps & CustomerMail,
  run: AuditedRun,
  orderId: string,
  staffId: string,
  input: CancelPaidOrderRequest,
) {
  await run((tx, audit) => cancelPaidOrder(tx, deps, audit, orderId, staffId, input))
  await cancelOrderPaymentLinks(deps, orderId)
}
