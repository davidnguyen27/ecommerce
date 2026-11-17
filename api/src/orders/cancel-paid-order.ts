import { ErrorCode, type CancelPaidOrderRequest, type OrderCancelCause } from '@ecommerce/shared'
import type { Audit } from '../audit/audited.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { createRefund, refundTotals } from '../payments/refunds.ts'
import { releaseOrderReservations } from './cancel-order.ts'
import { vnd } from './format.ts'
import { issueOrderLookupUrl, recordOrderEvent } from './orders.ts'

export type CancelPaidMail = { emails: EmailQueue; siteUrl: string }

/** Lý do hủy theo cách nói với khách, dùng trong email (trang đơn có bản riêng ở web). */
const CAUSE_FOR_CUSTOMER: Record<OrderCancelCause, string> = {
  changed_mind: 'theo yêu cầu của bạn',
  remainder_overdue: 'đã quá hạn trả phần còn lại',
  supply_failed: 'cửa hàng không nhập được hàng',
  delivery_failed: 'đơn vị vận chuyển không giao được hàng',
  other: 'cửa hàng không thực hiện được đơn',
}

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
  mail: CancelPaidMail,
  audit: Audit,
  orderId: string,
  staffId: string,
  input: CancelPaidOrderRequest,
) {
  const [locked] = await tx.$queryRaw<
    { status: string; paymentStatus: string; fulfillmentStatus: string; kind: string }[]
  >`
    SELECT "status"::text AS status, "payment_status"::text AS "paymentStatus",
      "fulfillment_status"::text AS "fulfillmentStatus", "kind"::text AS kind
    FROM "order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
  if (!locked) throw new Error(`Không có đơn ${orderId}`)
  if (locked.status !== 'processing' || !['paid', 'deposit_paid'].includes(locked.paymentStatus)) {
    throw conflict('Chỉ hủy được đơn đang xử lý đã nhận tiền; đơn chưa thanh toán dùng nút hủy thường')
  }
  if (!['not_prepared', 'preparing'].includes(locked.fulfillmentStatus)) {
    throw conflict('Đơn đã bàn giao vận chuyển, không hủy được')
  }
  if (locked.kind === 'preorder') {
    // Hàng đặt trước đã về phải chia lại cho đơn chờ kế tiếp (ADR 0013): ticket 03.
    throw conflict('Chưa hủy được đơn đặt trước')
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
    },
  })
  await queueCancelledEmail(tx, mail, order, input.cause, refundAmount)
  return order.code
}

/** Email "Đơn đã hủy": lý do theo cách nói với khách, số tiền sẽ hoàn (hoặc không hoàn), link tra cứu có token mới. */
async function queueCancelledEmail(
  tx: Prisma.TransactionClient,
  { emails, siteUrl }: CancelPaidMail,
  order: { id: string; code: number; email: string; recipientName: string },
  cause: OrderCancelCause,
  refundAmount: bigint,
) {
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  const refundText =
    refundAmount > 0n
      ? `Chúng tôi sẽ hoàn ${vnd(refundAmount)} cho bạn và gửi email khi tiền đã được chuyển.`
      : 'Đơn này không được hoàn tiền theo chính sách đã áp dụng cho đơn.'
  // Bản nháp, chờ chủ doanh nghiệp duyệt nội dung.
  await emails.sendEmail(tx, {
    to: order.email,
    subject: `Đơn hàng #${order.code} đã bị hủy`,
    text: [
      `Chào ${order.recipientName},`,
      '',
      `Đơn hàng #${order.code} đã bị hủy vì ${CAUSE_FOR_CUSTOMER[cause]}.`,
      refundText,
      '',
      `Xem đơn hàng: ${link}`,
      '',
      'Nếu cần hỗ trợ, bạn hãy trả lời email này hoặc gọi cho cửa hàng.',
    ].join('\n'),
  })
}
