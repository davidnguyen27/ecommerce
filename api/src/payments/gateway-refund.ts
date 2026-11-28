import type { Request } from 'express'
import { audited } from '../core/audit/audited.ts'
import type { Db } from '../core/db.ts'
import type { CustomerMail } from '../core/jobs/jobs.ts'
import { vnd } from '../orders/format.ts'
import { recordOrderEvent } from '../orders/orders.ts'
import { PaymentGatewayError, type PaymentGateway, type RefundResult, type StoredTransaction } from './gateway.ts'
import {
  conflict,
  joinNotes,
  lockOrderForRefund,
  lockRefund,
  queueRefundSucceededEmail,
  refundedViaGateway,
} from './refunds.ts'
import { contextOf } from '../core/context/request-context.ts'

/** One part of a refund sent to the gateway: one original transaction, one refund command. */
type Piece = { refundId: string; amount: number; full: boolean; transaction: StoredTransaction }

export type GatewayRefundDeps = { prisma: Db; payments: PaymentGateway; mail: CustomerMail }

/**
 * Refunds a `pending` refund via the gateway (ADR 0014), in three steps:
 * 1. In a transaction under the order lock: split the amount over refundable gateway transactions, newest first, each
 *    up to its unrefunded part; several transactions split the refund into several. Every part moves to `processing`
 *    (method `vnpay`, linked transaction) before calling the gateway: a crash leaves it "gateway processing" for
 *    accounting to check and settle, never sent twice.
 * 2. After commit: send each refund command. No reply counts as processing, with the reason.
 * 3. In a new transaction: record each part's result (refunded: email; rejected: failed, can be recreated).
 * Returns the order code.
 */
export async function executeGatewayRefund(deps: GatewayRefundDeps, req: Request, refundId: string, staffId: string) {
  const { prisma, payments, mail } = deps

  const { orderCode, orderId, pieces } = await audited(prisma, contextOf(req), async (tx, audit) => {
    const refund = await lockRefund(tx, refundId)
    if (refund.status !== 'pending') throw conflict('Khoản hoàn này đã được thực hiện')

    const transactions = await tx.paymentTransaction.findMany({
      where: { orderId: refund.orderId },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    })
    const usedOf = refundedViaGateway(
      await tx.refund.findMany({
        where: { orderId: refund.orderId },
        select: { amount: true, status: true, paymentTransactionId: true },
      }),
    )

    let left = Number(refund.amount)
    const plan: { transactionId: string; amount: number; full: boolean; stored: StoredTransaction }[] = []
    for (const t of transactions) {
      if (left === 0) break
      const stored = { reference: t.reference, amount: Number(t.amount), source: t.source, payload: t.payload }
      if (!payments.canRefund(stored)) continue
      const already = Number(usedOf.get(t.id) ?? 0n)
      const take = Math.min(left, stored.amount - already)
      if (take <= 0) continue
      plan.push({ transactionId: t.id, amount: take, full: already === 0 && take === stored.amount, stored })
      left -= take
    }
    if (left > 0) {
      throw conflict(
        `Giao dịch qua cổng chỉ còn hoàn được ${vnd(Number(refund.amount) - left)}; hãy hoàn bằng chuyển khoản`,
      )
    }
    // Refunds from reconciliation or retries point to exactly one source item/refund (unique), so they cannot be split.
    if (plan.length > 1 && refund.origin !== 'cancellation') {
      throw conflict('Khoản này cần hoàn qua nhiều giao dịch; hãy hoàn bằng chuyển khoản')
    }

    const now = new Date()
    const execution = {
      status: 'processing' as const,
      method: 'vnpay' as const,
      executedById: staffId,
      executedAt: now,
    }
    const pieces: Piece[] = []
    for (const [i, p] of plan.entries()) {
      const row =
        i === 0
          ? await tx.refund.update({
              where: { id: refund.id },
              data: { ...execution, amount: BigInt(p.amount), paymentTransactionId: p.transactionId },
            })
          : await tx.refund.create({
              data: {
                ...execution,
                orderId: refund.orderId,
                amount: BigInt(p.amount),
                origin: refund.origin,
                note: refund.note,
                createdById: refund.createdById,
                paymentTransactionId: p.transactionId,
              },
            })
      pieces.push({ refundId: row.id, amount: p.amount, full: p.full, transaction: p.stored })
    }
    await audit({
      action: 'refund.execute_vnpay',
      entityType: 'order',
      entityId: refund.orderId,
      before: { refundId: refund.id, amount: Number(refund.amount), status: 'pending' },
      after: {
        status: 'processing',
        pieces: pieces.map((p) => ({ refundId: p.refundId, amount: p.amount, reference: p.transaction.reference })),
      },
    })
    return { orderCode: refund.order.code, orderId: refund.orderId, pieces }
  })

  const results: { piece: Piece; result: RefundResult }[] = []
  for (const piece of pieces) {
    try {
      results.push({
        piece,
        result: await payments.refund({ ...piece, orderCode, createdBy: staffId }),
      })
    } catch (err) {
      // No reply or untrustworthy data: we cannot know whether the command arrived, so accounting checks and settles.
      const message = err instanceof PaymentGatewayError ? err.message : 'Lỗi khi gọi cổng'
      req.log?.error({ err, orderCode, refundId: piece.refundId }, 'Không gửi được lệnh hoàn tới cổng')
      results.push({ piece, result: { status: 'processing', message, payload: { error: message } } })
    }
  }

  await audited(prisma, contextOf(req), async (tx, audit) => {
    await lockOrderForRefund(tx, orderId)
    const applied: typeof results = []
    for (const { piece, result } of results) {
      const before = await tx.refund.findUniqueOrThrow({ where: { id: piece.refundId } })
      // Accounting may have settled (and recreated) this refund while we waited: a late result does not overwrite, so
      // non-failed refunds never exceed what was received. Ignored results stay in the audit.
      if (before.status !== 'processing') continue
      applied.push({ piece, result })
      const done = result.status !== 'processing'
      const updated = await tx.refund.update({
        where: { id: piece.refundId },
        data: {
          status: result.status === 'rejected' ? 'failed' : result.status,
          gatewayPayload: result.payload,
          completedAt: done ? new Date() : null,
          note: result.status === 'succeeded' ? before.note : joinNotes(before.note, result.message),
        },
      })
      if (done) {
        await recordOrderEvent(
          tx,
          orderId,
          result.status === 'succeeded' ? 'refund_succeeded' : 'refund_failed',
          { type: 'staff', staffId },
          { refundId: piece.refundId, amount: piece.amount, method: 'vnpay', message: result.message },
        )
      }
      if (result.status === 'succeeded') {
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { id: true, code: true, email: true, recipientName: true },
        })
        await queueRefundSucceededEmail(tx, mail, order, updated)
      }
    }
    await audit({
      action: 'refund.gateway_result',
      entityType: 'order',
      entityId: orderId,
      after: {
        results: results.map(({ piece, result }) => ({
          refundId: piece.refundId,
          amount: piece.amount,
          status: result.status,
          message: result.message,
          ...(!applied.some((a) => a.piece === piece) && { ignored: 'Khoản đã được chốt trước khi cổng trả lời' }),
        })),
      },
    })
  })
  return orderCode
}
