import { ErrorCode } from '@ecommerce/shared'
import type { Request } from 'express'
import { audited } from '../audit/audited.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { vnd } from '../orders/format.ts'
import { recordOrderEvent } from '../orders/orders.ts'
import { PaymentGatewayError, type PaymentGateway, type RefundResult, type StoredTransaction } from './gateway.ts'
import { lockOrderForRefund, queueRefundSucceededEmail, type RefundMail } from './refunds.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)
const joinNotes = (...notes: (string | null | undefined)[]) =>
  notes
    .map((n) => n?.trim())
    .filter(Boolean)
    .join('\n') || null

/** Một phần của khoản hoàn gửi tới cổng: một giao dịch gốc, một lệnh hoàn. */
type Piece = { refundId: string; amount: number; full: boolean; transaction: StoredTransaction }

export type GatewayRefundDeps = { prisma: Db; payments: PaymentGateway; mail: RefundMail }

/**
 * Hoàn một khoản `pending` qua cổng (ADR 0014), ba bước:
 * 1. Trong transaction dưới khóa đơn: chia số tiền theo các giao dịch cổng hoàn được, giao dịch mới nhất trước, mỗi
 *    giao dịch tới phần chưa hoàn qua cổng của nó; cần nhiều giao dịch thì tách khoản thành nhiều khoản. Mọi phần sang
 *    `processing` (cách `vnpay`, gắn giao dịch gốc) trước khi gọi cổng: lỗi giữa chừng thì khoản nằm ở "cổng đang xử
 *    lý" để kế toán kiểm và chốt tay, không bị gửi hai lần.
 * 2. Sau khi commit: gửi từng lệnh hoàn. Cổng không trả lời thì coi như đang xử lý, kèm lý do.
 * 3. Trong transaction mới: ghi kết quả từng phần (đã hoàn: email; bị từ chối: thất bại, tạo lại được).
 * Trả mã đơn.
 */
export async function executeGatewayRefund(deps: GatewayRefundDeps, req: Request, refundId: string, staffId: string) {
  const { prisma, payments, mail } = deps
  if (!UUID.test(refundId)) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy khoản hoàn')

  const { orderCode, orderId, pieces } = await audited(prisma, req, async (tx, audit) => {
    const found = await tx.refund.findUnique({ where: { id: refundId }, select: { orderId: true } })
    if (!found) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy khoản hoàn')
    await lockOrderForRefund(tx, found.orderId)
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { order: { select: { code: true } } },
    })
    if (refund.status !== 'pending') throw conflict('Khoản hoàn này đã được thực hiện')

    const transactions = await tx.paymentTransaction.findMany({
      where: { orderId: refund.orderId },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    })
    const used = await tx.refund.groupBy({
      by: ['paymentTransactionId'],
      where: { orderId: refund.orderId, paymentTransactionId: { not: null }, status: { not: 'failed' } },
      _sum: { amount: true },
    })
    const usedOf = new Map(used.map((u) => [u.paymentTransactionId!, Number(u._sum.amount ?? 0n)]))

    let left = Number(refund.amount)
    const plan: { transactionId: string; amount: number; full: boolean; stored: StoredTransaction }[] = []
    for (const t of transactions) {
      if (left === 0) break
      const stored = { reference: t.reference, amount: Number(t.amount), source: t.source, payload: t.payload }
      if (!payments.canRefund(stored)) continue
      const already = usedOf.get(t.id) ?? 0
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
    // Khoản sinh từ đối soát hay tạo lại trỏ về đúng một mục/khoản gốc (unique), không tách được.
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
      // Cổng không trả lời hay trả dữ liệu không tin được: không biết lệnh đã tới chưa, nên để kế toán kiểm và chốt tay.
      const message = err instanceof PaymentGatewayError ? err.message : 'Lỗi khi gọi cổng'
      req.log?.error({ err, orderCode, refundId: piece.refundId }, 'Không gửi được lệnh hoàn tới cổng')
      results.push({ piece, result: { status: 'processing', message, payload: { error: message } } })
    }
  }

  await audited(prisma, req, async (tx, audit) => {
    await lockOrderForRefund(tx, orderId)
    for (const { piece, result } of results) {
      const before = await tx.refund.findUniqueOrThrow({ where: { id: piece.refundId } })
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
        })),
      },
    })
  })
  return orderCode
}
