import { ErrorCode, type RefundOrigin, type SettleRefundRequest } from '@ecommerce/shared'
import type { Audit } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import type { Refund } from '../generated/prisma/client.ts'
import { AppError, conflictField } from '../http/errors.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { dateVN, vnd } from '../orders/format.ts'
import { issueOrderLookupUrl, recordOrderEvent } from '../orders/orders.ts'

/**
 * Hoàn tiền (GLOSSARY, ADR 0014): khoản trả lại cho khách gắn với một đơn, theo dõi tới khi có kết quả. Mọi thao tác
 * chạy dưới khóa đơn `FOR UPDATE` (cùng khóa với ghi nhận thanh toán, hủy đơn, đối soát), nên tổng các khoản không
 * thất bại không bao giờ vượt tổng đã nhận, kể cả khi hai yêu cầu đến cùng lúc.
 */

export type RefundMail = { emails: EmailQueue; siteUrl: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy khoản hoàn')
const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, ErrorCode.CONFLICT, message, undefined, details)

/** Khóa đơn `FOR UPDATE`. Gọi trước mọi đọc số tiền dùng để quyết định ghi hoàn tiền. */
export async function lockOrderForRefund(tx: DbClient, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
}

/** Đã nhận, đã hoàn xong, đang hoàn (chờ hoặc cổng đang xử lý) và còn hoàn được của một đơn, VND. */
export async function refundTotals(tx: DbClient, orderId: string) {
  // Tuần tự: trong transaction chỉ có một kết nối, không chạy hai truy vấn cùng lúc.
  const received = await tx.paymentTransaction.aggregate({ where: { orderId }, _sum: { amount: true } })
  const byStatus = await tx.refund.groupBy({ by: ['status'], where: { orderId }, _sum: { amount: true } })
  const sum = (...statuses: Refund['status'][]) =>
    byStatus.filter((row) => statuses.includes(row.status)).reduce((total, row) => total + (row._sum.amount ?? 0n), 0n)
  const receivedAmount = received._sum.amount ?? 0n
  const refunded = sum('succeeded')
  const refunding = sum('pending', 'processing')
  return { received: receivedAmount, refunded, refunding, refundable: receivedAmount - refunded - refunding }
}

export type NewRefund = {
  orderId: string
  amount: bigint
  origin: RefundOrigin
  reconciliationItemId?: string
  retryOfId?: string
  note?: string
  staffId: string
}

/**
 * Tạo một khoản hoàn `pending`. Gọi khi đơn đã bị khóa: số tiền phải > 0 và không vượt số còn hoàn được, vượt thì 409
 * kèm `refundable`. Ghi sự kiện đơn; audit do nơi gọi ghi cùng thao tác của nó.
 */
export async function createRefund(tx: DbClient, input: NewRefund) {
  if (input.amount <= 0n) throw conflictField('amount', 'Số tiền hoàn phải lớn hơn 0')
  const { refundable } = await refundTotals(tx, input.orderId)
  if (input.amount > refundable) {
    throw conflictField('amount', `Số tiền hoàn ${vnd(input.amount)} vượt số còn hoàn được ${vnd(refundable)}`, {
      refundable: Number(refundable),
    })
  }
  const refund = await tx.refund.create({
    data: {
      orderId: input.orderId,
      amount: input.amount,
      origin: input.origin,
      reconciliationItemId: input.reconciliationItemId ?? null,
      retryOfId: input.retryOfId ?? null,
      note: input.note?.trim() || null,
      createdById: input.staffId,
    },
  })
  await recordOrderEvent(
    tx,
    input.orderId,
    'refund_created',
    { type: 'staff', staffId: input.staffId },
    { refundId: refund.id, amount: Number(refund.amount), origin: refund.origin },
  )
  return refund
}

/** Khóa đơn của khoản hoàn rồi đọc lại khoản dưới khóa; id lạ thì 404. */
async function lockRefund(tx: DbClient, refundId: string) {
  if (!UUID.test(refundId)) throw notFound()
  const found = await tx.refund.findUnique({ where: { id: refundId }, select: { orderId: true } })
  if (!found) throw notFound()
  await lockOrderForRefund(tx, found.orderId)
  return tx.refund.findUniqueOrThrow({
    where: { id: refundId },
    include: { order: { select: { id: true, code: true, email: true, recipientName: true } } },
  })
}

const joinNotes = (...notes: (string | null | undefined)[]) =>
  notes
    .map((n) => n?.trim())
    .filter(Boolean)
    .join('\n') || null

const auditView = (refund: Refund) => ({
  refundId: refund.id,
  amount: Number(refund.amount),
  status: refund.status,
  method: refund.method,
})

/**
 * Kế toán đã chuyển khoản ngoài hệ thống: khoản `pending` thành `succeeded` với mã giao dịch ngân hàng và ngày chuyển.
 * Không lưu số tài khoản của khách. Xếp email "Đã hoàn tiền". Trả mã đơn.
 */
export async function executeManualRefund(
  tx: DbClient,
  mail: RefundMail,
  audit: Audit,
  refundId: string,
  staffId: string,
  input: { bankReference: string; transferredOn: string; note?: string },
) {
  const refund = await lockRefund(tx, refundId)
  if (refund.status !== 'pending') throw conflict('Khoản hoàn này đã được thực hiện')
  const now = new Date()
  const updated = await tx.refund.update({
    where: { id: refund.id },
    data: {
      status: 'succeeded',
      method: 'manual',
      bankReference: input.bankReference,
      transferredOn: new Date(`${input.transferredOn}T00:00:00Z`),
      note: joinNotes(refund.note, input.note),
      executedById: staffId,
      executedAt: now,
      completedAt: now,
    },
  })
  await recordOrderEvent(
    tx,
    refund.orderId,
    'refund_succeeded',
    { type: 'staff', staffId },
    { refundId: refund.id, amount: Number(refund.amount), method: 'manual' },
  )
  await audit({
    action: 'refund.execute_manual',
    entityType: 'order',
    entityId: refund.orderId,
    before: auditView(refund),
    after: { ...auditView(updated), bankReference: input.bankReference, transferredOn: input.transferredOn },
  })
  await queueRefundSucceededEmail(tx, mail, refund.order, updated)
  return refund.order.code
}

/**
 * Chốt bằng tay một khoản cổng đang xử lý (ADR 0014: không có job theo dõi), sau khi kế toán kiểm trên cổng merchant.
 * Đã hoàn thì xếp email "Đã hoàn tiền". Trả mã đơn.
 */
export async function settleRefund(
  tx: DbClient,
  mail: RefundMail,
  audit: Audit,
  refundId: string,
  staffId: string,
  input: SettleRefundRequest,
) {
  const refund = await lockRefund(tx, refundId)
  if (refund.status !== 'processing') throw conflict('Chỉ chốt được khoản cổng đang xử lý')
  const updated = await tx.refund.update({
    where: { id: refund.id },
    data: {
      status: input.outcome,
      note: joinNotes(refund.note, input.note),
      settledById: staffId,
      completedAt: new Date(),
    },
  })
  await recordOrderEvent(
    tx,
    refund.orderId,
    input.outcome === 'succeeded' ? 'refund_succeeded' : 'refund_failed',
    { type: 'staff', staffId },
    { refundId: refund.id, amount: Number(refund.amount), note: input.note },
  )
  await audit({
    action: 'refund.settle',
    entityType: 'order',
    entityId: refund.orderId,
    before: auditView(refund),
    after: { ...auditView(updated), note: input.note },
  })
  if (input.outcome === 'succeeded') await queueRefundSucceededEmail(tx, mail, refund.order, updated)
  return refund.order.code
}

/**
 * Tạo lại một khoản thất bại thành khoản `pending` mới (`origin = retry`). Mỗi khoản thất bại tạo lại được một lần; số
 * tiền không vượt khoản thất bại và không vượt số còn hoàn được. Trả mã đơn.
 */
export async function retryRefund(
  tx: DbClient,
  audit: Audit,
  refundId: string,
  staffId: string,
  input: { amount: number; note?: string },
) {
  const failed = await lockRefund(tx, refundId)
  if (failed.status !== 'failed') throw conflict('Chỉ tạo lại được khoản hoàn thất bại')
  const retried = await tx.refund.findUnique({ where: { retryOfId: failed.id }, select: { id: true } })
  if (retried) throw conflict('Khoản hoàn này đã được tạo lại')
  const amount = BigInt(input.amount)
  if (amount > failed.amount) {
    throw conflictField('amount', `Số tiền tạo lại không vượt khoản thất bại ${vnd(failed.amount)}`)
  }
  const refund = await createRefund(tx, {
    orderId: failed.orderId,
    amount,
    origin: 'retry',
    retryOfId: failed.id,
    note: input.note,
    staffId,
  })
  await audit({
    action: 'refund.retry',
    entityType: 'order',
    entityId: failed.orderId,
    before: auditView(failed),
    after: { ...auditView(refund), retryOfId: failed.id },
  })
  return failed.order.code
}

/** Xếp email "Đã hoàn tiền" (số tiền, ngày, link tra cứu có token mới) trong transaction của thay đổi trạng thái. */
export async function queueRefundSucceededEmail(
  tx: DbClient,
  { emails, siteUrl }: RefundMail,
  order: { id: string; code: number; email: string; recipientName: string },
  refund: Refund,
) {
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  const day = refund.transferredOn ?? refund.completedAt ?? new Date()
  // Bản nháp, chờ chủ doanh nghiệp duyệt nội dung.
  await emails.sendEmail(tx, {
    to: order.email,
    subject: `Đã hoàn tiền đơn hàng #${order.code}`,
    text: [
      `Chào ${order.recipientName},`,
      '',
      `Chúng tôi đã hoàn ${vnd(refund.amount)} cho đơn hàng #${order.code} ngày ${dateVN(day)}.`,
      'Tùy ngân hàng, tiền có thể cần vài ngày làm việc để về tới tài khoản của bạn.',
      '',
      `Xem đơn hàng: ${link}`,
    ].join('\n'),
  })
}
