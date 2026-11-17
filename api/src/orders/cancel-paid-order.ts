import {
  ErrorCode,
  ORDER_CANCEL_CAUSE_CUSTOMER_TEXT,
  type CancelPaidOrderRequest,
  type FulfillmentStatus,
  type OrderCancelCause,
  type OrderKind,
  type OrderStatus,
  type PaymentStatus,
} from '@ecommerce/shared'
import type { Audit } from '../audit/audited.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import type { CustomerMail } from '../jobs/jobs.ts'
import { createRefund, refundTotals } from '../payments/refunds.ts'
import { applyArrivals, planArrivals } from '../preorders/arrivals.ts'
import { releaseOrderReservations } from './cancel-order.ts'
import { vnd } from './format.ts'
import { issueOrderLookupUrl, recordOrderEvent } from './orders.ts'

const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)

/**
 * Nhân viên hủy một đơn đã nhận tiền (GLOSSARY "Hủy đơn", spec M6a) trong transaction của `audited()`: khóa đơn
 * `FOR UPDATE` (cùng khóa với ghi nhận thanh toán, xử lý giao hàng, hoàn tiền), kiểm đơn đang xử lý, đã trả đủ hoặc đã
 * cọc, chưa bàn giao vận chuyển. Nhả hàng đang giữ, đặt đơn `cancelled` (lý do `staff` kèm `cancel_cause`), tạo một
 * khoản hoàn chờ thực hiện khi số hoàn > 0, ghi sự kiện, audit và xếp email "Đơn đã hủy".
 *
 * Số hoàn: 0 tới số còn hoàn được; thấp hơn thì ghi chú bắt buộc; không nhập được hàng thì phải hoàn đủ. Sai thì 400.
 * Trạng thái thanh toán giữ nguyên (ADR 0014). Lượt mã giảm giá tự trống vì lượt tính trên đơn chưa hủy (M5).
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
  if (locked.status !== 'processing' || !(['paid', 'deposit_paid'] as PaymentStatus[]).includes(locked.paymentStatus)) {
    throw conflict('Chỉ hủy được đơn đang xử lý đã nhận tiền; đơn chưa thanh toán dùng nút hủy thường')
  }
  // `returned`: giao thất bại và kho đã nhận hàng hoàn về, không còn hàng giữ cho đơn. `failed` thì nhận hàng về trước.
  if (!(['not_prepared', 'preparing', 'returned'] as FulfillmentStatus[]).includes(locked.fulfillmentStatus)) {
    throw conflict('Đơn đã bàn giao vận chuyển, không hủy được; giao thất bại thì nhận hàng hoàn về trước')
  }
  const { refundable } = await refundTotals(tx, orderId)
  const refundAmount = BigInt(input.refundAmount)
  const note = input.note?.trim() || null
  if (refundAmount > refundable) {
    throw invalidField('refundAmount', `Số tiền hoàn vượt số còn hoàn được ${vnd(refundable)}`)
  }
  if (input.cause === 'supply_failed' && refundAmount !== refundable) {
    throw invalidField('refundAmount', `Không nhập được hàng thì hoàn đủ ${vnd(refundable)}`)
  }
  if (refundAmount < refundable && !note) {
    throw invalidField('note', 'Hoàn ít hơn số còn hoàn được thì cần ghi lý do')
  }

  // Hàng đặt trước đang giữ cho đơn (đã về đủ hay mới về một phần) đi tiếp cho đơn chờ kế tiếp theo thứ tự cọc (ADR 0013),
  // nên nhớ số đã nhả trước khi nhả.
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
  // Sau khi đơn đã `cancelled`: `planArrivals` chỉ chọn đơn đặt trước đang chờ, nên không chia lại cho chính đơn này.
  // `reallocate: false` (hủy hàng loạt khi đợt không nhập được hàng): phần đã giữ thành hàng sẵn, không chuyền qua các
  // đơn cùng đợt sắp bị hủy.
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
  await queueCancelledEmail(tx, mail, order, input.cause, refundAmount, refundable)
  return order.code
}

/**
 * Email "Đơn đã hủy": lý do theo cách nói với khách, số tiền sẽ hoàn, phần không hoàn (mất cọc, khấu trừ) kèm nhắc chính
 * sách đã áp dụng cho đơn, và link tra cứu có token mới. `refundable` là số còn hoàn được lúc hủy.
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
  // Bản nháp, chờ chủ doanh nghiệp duyệt nội dung.
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
