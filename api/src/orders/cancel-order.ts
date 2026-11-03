import { ErrorCode } from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import { releaseStock } from '../stock/stock.ts'
import { recordOrderEvent, type OrderEventActor } from './orders.ts'

/**
 * Ai hủy và vì sao. Hết hạn có `overdueAt` khi do job chạy: chỉ hủy nếu hạn giữ hàng đã qua tính tới lúc đó;
 * nút "Giả lập hết hạn" bỏ trống để hủy ngay.
 */
export type Cancellation =
  | { reason: 'expired'; overdueAt?: Date }
  | { reason: 'customer'; customerId?: string }
  | { reason: 'staff'; staffId: string }

/**
 * `cancelled`: vừa hủy. `already_cancelled`: đã hủy từ trước, không đổi gì. `not_pending`: đơn đã trả (không hủy được
 * ở mốc này). `not_due`: chưa tới hạn giữ hàng (chỉ khi có `overdueAt`).
 */
export type CancelOutcome = 'cancelled' | 'already_cancelled' | 'not_pending' | 'not_due'

export type CancelDeps = { prisma: Db; payments: PaymentGateway; logger: Logger }

function actorOf(cancellation: Cancellation): OrderEventActor {
  switch (cancellation.reason) {
    case 'expired':
      return { type: 'system' }
    case 'customer':
      return { type: 'customer', customerId: cancellation.customerId }
    case 'staff':
      return { type: 'staff', staffId: cancellation.staffId }
  }
}

/**
 * Hủy đơn chưa thanh toán trong transaction của nơi gọi (admin cần ghi audit cùng transaction): khóa đơn `FOR UPDATE`
 * như `recordPayment` nên tiền về cùng lúc thì một bên thấy kết quả của bên kia; nhả giữ hàng, ghi sự kiện đơn.
 * Chạy lại trên đơn đã hủy thì không đổi gì. Hủy link thanh toán làm sau khi commit (`cancelPaymentLink`).
 */
export async function cancelInTransaction(
  tx: Prisma.TransactionClient,
  orderId: string,
  cancellation: Cancellation,
): Promise<CancelOutcome> {
  const [locked] = await tx.$queryRaw<{ status: string; reservedUntil: Date | null }[]>`
    SELECT "status"::text AS status, "reserved_until" AS "reservedUntil" FROM "order" WHERE "id" = ${orderId}::uuid
    FOR UPDATE`
  if (!locked) throw new Error(`Không có đơn ${orderId}`)
  if (locked.status === 'cancelled') return 'already_cancelled'
  if (locked.status !== 'pending_payment') return 'not_pending'
  if (
    cancellation.reason === 'expired' &&
    cancellation.overdueAt &&
    locked.reservedUntil &&
    locked.reservedUntil > cancellation.overdueAt
  ) {
    return 'not_due'
  }

  const lines = await tx.orderLine.findMany({ where: { orderId }, select: { variantId: true, quantity: true } })
  await releaseStock(tx, lines)
  await tx.order.update({
    where: { id: orderId },
    data: { status: 'cancelled', cancelReason: cancellation.reason, cancelledAt: new Date(), reservedUntil: null },
  })
  await recordOrderEvent(tx, orderId, 'cancelled', actorOf(cancellation), { reason: cancellation.reason })
  return 'cancelled'
}

/** Hủy link thanh toán của đơn vừa hủy. Lỗi chỉ log: đơn đã hủy, tiền về sau đó thành cần đối soát. */
export async function cancelPaymentLink({ payments, logger }: Omit<CancelDeps, 'prisma'>, orderCode: number) {
  try {
    await payments.cancelLink(orderCode)
  } catch (err) {
    logger.error({ err, orderCode }, 'Không hủy được link thanh toán')
  }
}

/** Hàm hủy dùng chung cho hết hạn, khách hủy và nhân viên hủy (không cần audit). */
export async function cancelOrder(deps: CancelDeps, orderId: string, cancellation: Cancellation) {
  const outcome = await deps.prisma.$transaction((tx) => cancelInTransaction(tx, orderId, cancellation))
  if (outcome === 'cancelled') {
    const { code } = await deps.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { code: true } })
    await cancelPaymentLink(deps, code)
  }
  return outcome
}

/** Nơi gọi qua HTTP: đơn đã trả thì 409. */
export function assertCancellable(outcome: CancelOutcome) {
  if (outcome === 'not_pending') {
    throw new AppError(409, ErrorCode.CONFLICT, 'Đơn đã thanh toán, không hủy được')
  }
}

/** Job `expire-order` của một đơn: hủy nếu đã quá hạn tính tới `now`. */
export function expireOrder(deps: CancelDeps, orderId: string, now = new Date()) {
  return cancelOrder(deps, orderId, { reason: 'expired', overdueAt: now })
}

/** Job quét mỗi phút: hủy mọi đơn chờ thanh toán đã quá hạn tính tới `now`, phòng khi job của từng đơn bị mất. */
export async function expireOverdueOrders(deps: CancelDeps, now = new Date()) {
  const overdue = await deps.prisma.order.findMany({
    where: { status: 'pending_payment', reservedUntil: { lte: now } },
    select: { id: true },
    orderBy: { reservedUntil: 'asc' },
  })
  let expired = 0
  for (const { id } of overdue) {
    if ((await expireOrder(deps, id, now)) === 'cancelled') expired++
  }
  return expired
}
