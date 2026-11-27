import { ErrorCode } from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { AuditedRun } from '../audit/audited.ts'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import { PAYMENT_LINK_REFERENCES, recordGatewayPayments, type RecordPaymentDeps } from '../payments/record-payment.ts'
import { releaseStock } from '../stock/stock.ts'
import { recordOrderEvent, type OrderEventActor } from './orders.ts'

/**
 * Who cancels and why. Expiry from a job carries `overdueAt`: cancel only if the reservation had expired by then; the
 * "Giả lập hết hạn" button leaves it empty to cancel at once.
 */
export type Cancellation =
  | { reason: 'expired'; overdueAt?: Date }
  | { reason: 'customer'; customerId?: string }
  | { reason: 'staff'; staffId: string }

/**
 * `cancelled`: just cancelled. `already_cancelled`: cancelled before, nothing changed. `not_pending`: already paid (not
 * cancellable here). `not_due`: reservation not expired yet (only with `overdueAt`).
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
 * Cancels an unpaid order in the caller's transaction (admin audits in the same one): locks the order like
 * `recordPayment`, so a concurrent payment and cancel each see the other's result; releases the reservation and records
 * an event. Rerunning on a cancelled order changes nothing. Payment links are cancelled after commit.
 */
async function cancelInTransaction(
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

  // A pending pre-order only holds allocation, not stock, so there is nothing to release; the allocation frees itself
  // (ADR 0013).
  await releaseOrderReservations(tx, orderId)
  await tx.order.update({
    where: { id: orderId },
    data: { status: 'cancelled', cancelReason: cancellation.reason, cancelledAt: new Date(), reservedUntil: null },
  })
  await recordOrderEvent(tx, orderId, 'cancelled', actorOf(cancellation), { reason: cancellation.reason })
  return 'cancelled'
}

/** Releases each line's reserved quantity and sets it to 0. Call under the order lock. */
export async function releaseOrderReservations(tx: Prisma.TransactionClient, orderId: string) {
  const lines = await tx.orderLine.findMany({
    where: { orderId, reservedQuantity: { gt: 0 } },
    select: { variantId: true, reservedQuantity: true },
  })
  if (lines.length === 0) return
  await releaseStock(
    tx,
    lines.map((l) => ({ variantId: l.variantId, quantity: l.reservedQuantity })),
  )
  await tx.orderLine.updateMany({ where: { orderId }, data: { reservedQuantity: 0 } })
}

/**
 * Cancels every payment link of a just-cancelled order (picked by `PAYMENT_LINK_REFERENCES`); no links, no-op. Call
 * after commit. Errors are logged and the next link is tried: the order is cancelled, so later money needs
 * reconciliation.
 */
export async function cancelOrderPaymentLinks({ prisma, payments, logger }: CancelDeps, orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { code: true, paymentLinks: PAYMENT_LINK_REFERENCES },
  })
  for (const { gatewayReference } of order.paymentLinks) {
    try {
      await payments.cancelLink(gatewayReference)
    } catch (err) {
      logger.error({ err, orderCode: order.code, gatewayReference }, 'Không hủy được link thanh toán')
    }
  }
}

/** Shared cancel for expiry and customer cancels (no audit). */
export async function cancelOrder(deps: CancelDeps, orderId: string, cancellation: Cancellation) {
  const outcome = await deps.prisma.$transaction((tx) => cancelInTransaction(tx, orderId, cancellation))
  if (outcome === 'cancelled') await cancelOrderPaymentLinks(deps, orderId)
  return outcome
}

/**
 * Staff cancel of an unpaid order (the customer called): the same cancel as expiry and self-cancel, audited in the same
 * transaction only when something changed. A paid order gives 409; an already cancelled one changes nothing.
 */
export async function cancelOrderByStaff(deps: CancelDeps, run: AuditedRun, orderId: string, staffId: string) {
  const outcome = await run(async (tx, audit) => {
    const result = await cancelInTransaction(tx, orderId, { reason: 'staff', staffId })
    if (result === 'cancelled') {
      await audit({
        action: 'order.cancel',
        entityType: 'order',
        entityId: orderId,
        before: { status: 'pending_payment' },
        after: { status: 'cancelled', cancelReason: 'staff' },
      })
    }
    return result
  })
  assertCancellable(outcome)
  if (outcome === 'cancelled') await cancelOrderPaymentLinks(deps, orderId)
  return outcome
}

/** Expiry cancels must be able to record money the gateway reports. */
export type ExpireDeps = CancelDeps & Pick<RecordPaymentDeps, 'emails' | 'siteUrl'>

/**
 * Cancels an order whose reservation expired (timed job, sweep job, simulate button). With `overdueAt`, only if expired
 * by then; otherwise at once. Asks the gateway once first (ADR 0009: merchant queries when no callback arrives): if
 * paid, records it and keeps the order; if the gateway errors, logs and cancels anyway (later money needs
 * reconciliation).
 */
export async function expireOrder(deps: ExpireDeps, orderId: string, overdueAt?: Date) {
  const order = await deps.prisma.order.findUnique({
    where: { id: orderId },
    select: { code: true, status: true, reservedUntil: true },
  })
  const due =
    order?.status === 'pending_payment' && !(overdueAt && order.reservedUntil && order.reservedUntil > overdueAt)
  if (order && due) {
    try {
      await recordGatewayPayments(deps, order)
    } catch (err) {
      deps.logger.error({ err, orderCode: order.code }, 'Không hỏi được cổng trước khi hủy đơn hết hạn')
    }
  }
  return cancelOrder(deps, orderId, { reason: 'expired', overdueAt })
}

/** For HTTP callers: a paid order gives 409. */
export function assertCancellable(outcome: CancelOutcome) {
  if (outcome === 'not_pending') {
    // Paid or deposited orders need a refund on cancel: use `cancel-paid` (M6a), which needs `order.cancel_paid`.
    throw new AppError(409, ErrorCode.CONFLICT, 'Đơn đã thanh toán hoặc đã cọc, không hủy được')
  }
}

/** Sweep job every minute: cancels every pending order overdue by `now`, in case a per-order job was lost. */
export async function expireOverdueOrders(deps: ExpireDeps, now = new Date()) {
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
