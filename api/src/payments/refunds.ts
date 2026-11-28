import { ErrorCode, type RefundOrigin, type SettleRefundRequest } from '@ecommerce/shared'
import type { Audit } from '../core/audit/audited.ts'
import type { DbClient } from '../core/db.ts'
import type { Refund } from '../generated/prisma/client.ts'
import { AppError, conflictField } from '../core/errors.ts'
import type { CustomerMail } from '../core/jobs/jobs.ts'
import { dateVN, vnd } from '../core/utils/format.ts'
import { issueOrderLookupUrl, recordOrderEvent } from '../modules/order/index.ts'

/**
 * Refunds (GLOSSARY "Hoàn tiền", ADR 0014): money returned to a customer for an order, tracked until it resolves. Every
 * operation runs under the order lock (same lock as payment, cancel, reconciliation), so non-failed refunds never
 * exceed what was received, even with concurrent requests.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy khoản hoàn')
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, ErrorCode.CONFLICT, message, undefined, details)

/** Locks the order. Call before reading any amount used to decide a refund write. */
export async function lockOrderForRefund(tx: DbClient, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
}

/** Enough of a refund to compute totals. */
type RefundAmount = Pick<Refund, 'amount' | 'status' | 'paymentTransactionId'>

/**
 * Refunded, refunding (pending or gateway processing) and still refundable, from total received and the order's refunds
 * (ADR 0014). Pure: the admin order detail and every write share one calculation.
 */
export function summarizeRefunds(received: bigint, refunds: readonly RefundAmount[]) {
  const sum = (...statuses: Refund['status'][]) =>
    refunds.filter((r) => statuses.includes(r.status)).reduce((total, r) => total + r.amount, 0n)
  const refunded = sum('succeeded')
  const refunding = sum('pending', 'processing')
  return { received, refunded, refunding, refundable: received - refunded - refunding }
}

/** Amount refunded (or refunding) via the gateway per original transaction; manual refunds link to none. */
export function refundedViaGateway(refunds: readonly RefundAmount[]) {
  const used = new Map<string, bigint>()
  for (const r of refunds) {
    if (r.paymentTransactionId && r.status !== 'failed') {
      used.set(r.paymentTransactionId, (used.get(r.paymentTransactionId) ?? 0n) + r.amount)
    }
  }
  return used
}

/** Received, refunded, refunding and refundable for an order, VND. Call under the order lock when deciding a write. */
export async function refundTotals(tx: DbClient, orderId: string) {
  // Sequential: a transaction has one connection, so no parallel queries.
  const received = await tx.paymentTransaction.aggregate({ where: { orderId }, _sum: { amount: true } })
  const refunds = await tx.refund.findMany({
    where: { orderId },
    select: { amount: true, status: true, paymentTransactionId: true },
  })
  return summarizeRefunds(received._sum.amount ?? 0n, refunds)
}

export type NewRefund = {
  orderId: string
  amount: bigint
  origin: RefundOrigin
  reconciliationItemId?: string
  retryOfId?: string
  /** Return request; required when `origin = return` (M6b). */
  supportRequestId?: string
  note?: string
  staffId: string
}

/**
 * Creates a `pending` refund. Call with the order locked: the amount must be > 0 and within the refundable amount,
 * else 409 with `refundable`. Records an order event; the caller writes the audit with its own action.
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
      supportRequestId: input.supportRequestId ?? null,
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

/** Locks the refund's order, then rereads the refund under the lock; unknown id gives 404. */
export async function lockRefund(tx: DbClient, refundId: string) {
  if (!UUID.test(refundId)) throw notFound()
  const found = await tx.refund.findUnique({ where: { id: refundId }, select: { orderId: true } })
  if (!found) throw notFound()
  await lockOrderForRefund(tx, found.orderId)
  return tx.refund.findUniqueOrThrow({
    where: { id: refundId },
    include: { order: { select: { id: true, code: true, email: true, recipientName: true } } },
  })
}

/** Joins non-empty notes, one per line; nothing left gives `null`. */
export const joinNotes = (...notes: (string | null | undefined)[]) =>
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
 * Accounting paid outside the system: a `pending` refund becomes `succeeded` with the bank transaction ref and date.
 * The customer's account number is not stored. Queues the "Đã hoàn tiền" email. Returns the order code.
 */
export async function executeManualRefund(
  tx: DbClient,
  mail: CustomerMail,
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
 * Settles a gateway-processing refund by hand (ADR 0014: no tracking job), after accounting checks the merchant portal.
 * If refunded, queues the "Đã hoàn tiền" email. Returns the order code.
 */
export async function settleRefund(
  tx: DbClient,
  mail: CustomerMail,
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
 * Recreates a failed refund as a new `pending` one (`origin = retry`). Each failed refund can be recreated once; the
 * amount is at most the failed one and within the refundable amount. Returns the order code.
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
    // A recreated return refund still belongs to that return request.
    supportRequestId: failed.supportRequestId ?? undefined,
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

/** Queues the "Đã hoàn tiền" email (amount, date, lookup link with a new token) in the state change's transaction. */
export async function queueRefundSucceededEmail(
  tx: DbClient,
  { emails, siteUrl }: CustomerMail,
  order: { id: string; code: number; email: string; recipientName: string },
  refund: Refund,
) {
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  const day = refund.transferredOn ?? refund.completedAt ?? new Date()
  // Draft, awaiting the owner's approval of the wording.
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
