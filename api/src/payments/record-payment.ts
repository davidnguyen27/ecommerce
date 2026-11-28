import type { Db, DbClient } from '../core/db.ts'
import {
  Prisma,
  type PaymentPurpose,
  type PaymentSource,
  type ReconciliationReason,
} from '../generated/prisma/client.ts'
import type { EmailQueue } from '../core/jobs/jobs.ts'
import { dayVN, isoDay, vnd, voucherLines } from '../orders/format.ts'
import { issueOrderLookupUrl, recordOrderEvent, remainingOf } from '../orders/orders.ts'
import type { PaymentGateway } from './gateway.ts'

/** Money the gateway reports, from a callback (`webhook` source), a query or the simulator. */
export type PaymentReceipt = {
  orderCode: number
  /** VND. */
  amount: number
  /** Gateway transaction reference; the same payment has the same reference whichever way it arrives. */
  reference: string
  /**
   * Gateway reference of the link this payment came through (VNPAY `vnp_TxnRef`); decides the transaction's purpose.
   * Missing, or no link of the order with it (old orders), counts as full payment.
   */
  gatewayReference?: string
  paidAt: Date
  source: PaymentSource
  /** Raw data, kept for matching. */
  payload: Prisma.InputJsonValue
}

/**
 * `paid`: the order just became fully paid. `deposit_paid`: a pre-order just got its full deposit. `flagged`: needs
 * reconciliation. `duplicate`: already recorded. `unknown_order`: no order with this code.
 */
export type RecordPaymentOutcome = 'paid' | 'deposit_paid' | 'flagged' | 'duplicate' | 'unknown_order'

export type RecordPaymentDeps = { prisma: Db; emails: EmailQueue; siteUrl: string }

/**
 * The single place recording money for an order (ADR 0009), idempotent. Locks the order so a callback and a query
 * arriving together see each other's write. When the order awaits a payment (`awaitedPayment`) and the transactions of
 * that purpose add up to exactly what is due, it advances one step: in-stock orders become paid, pending pre-orders
 * deposited, arrived pre-orders paid. Anything else is flagged for reconciliation without changing the order status.
 */
export async function recordPayment(deps: RecordPaymentDeps, receipt: PaymentReceipt): Promise<RecordPaymentOutcome> {
  try {
    return await deps.prisma.$transaction((tx) => recordInTransaction(tx, deps, receipt))
  } catch (err) {
    // The same reference is being recorded for another order concurrently: the unique index blocks it; treat as
    // recorded.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate'
    throw err
  }
}

async function recordInTransaction(
  tx: DbClient,
  { emails, siteUrl }: RecordPaymentDeps,
  receipt: PaymentReceipt,
): Promise<RecordPaymentOutcome> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "order" WHERE "code" = ${receipt.orderCode} FOR UPDATE`
  if (locked.length === 0) return 'unknown_order'
  if (await tx.paymentTransaction.findUnique({ where: { reference: receipt.reference }, select: { id: true } })) {
    return 'duplicate'
  }

  const order = await tx.order.findUniqueOrThrow({
    where: { id: locked[0]!.id },
    include: { lines: { orderBy: { position: 'asc' } } },
  })
  const link = receipt.gatewayReference
    ? await tx.paymentLink.findFirst({
        where: { orderId: order.id, gatewayReference: receipt.gatewayReference },
        select: { purpose: true },
      })
    : null
  const transaction = await tx.paymentTransaction.create({
    data: {
      orderId: order.id,
      purpose: link?.purpose ?? 'full',
      amount: receipt.amount,
      reference: receipt.reference,
      paidAt: receipt.paidAt,
      source: receipt.source,
      payload: receipt.payload,
    },
  })
  // What the order awaits now, if anything: pending in-stock orders full payments matching the total; pending
  // pre-orders deposit payments matching the deposit; deposited, arrived pre-orders remainder payments matching the
  // remainder (ticket 07). Each step settles only with payments of its own purpose.
  const awaiting = awaitedPayment(order)
  const eventData = { amount: receipt.amount, reference: receipt.reference, source: receipt.source }

  if (awaiting) {
    const { _sum } = await tx.paymentTransaction.aggregate({
      where: { orderId: order.id, purpose: awaiting.purpose },
      _sum: { amount: true },
    })
    if ((_sum.amount ?? 0n) === awaiting.due) {
      await tx.order.update({
        where: { id: order.id },
        data:
          awaiting.purpose === 'deposit'
            ? { status: 'processing', paymentStatus: 'deposit_paid', depositPaidAt: new Date(), reservedUntil: null }
            : // Paying the remainder clears the overdue flag (ticket 08); in-stock orders never have it.
              { status: 'processing', paymentStatus: 'paid', reservedUntil: null, remainderOverdueAt: null },
      })
      // Earlier payments flagged as mismatched now add up: those items need nothing more from accounting.
      const settled = await tx.reconciliationItem.findMany({
        where: { orderId: order.id, status: 'open', reason: 'amount_mismatch' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })
      const settledReconciliationItemIds = settled.map((item) => item.id)
      await tx.reconciliationItem.updateMany({
        where: { id: { in: settledReconciliationItemIds } },
        data: { status: 'resolved', resolution: 'settled_by_payment', resolvedAt: new Date() },
      })
      const outcome = awaiting.purpose === 'deposit' ? 'deposit_paid' : 'paid'
      await recordOrderEvent(
        tx,
        order.id,
        outcome,
        { type: 'system' },
        settledReconciliationItemIds.length ? { ...eventData, settledReconciliationItemIds } : eventData,
      )
      if (outcome === 'deposit_paid') await queueDepositReceivedEmail(tx, { emails, siteUrl }, order)
      else await queuePaymentReceivedEmail(tx, { emails, siteUrl }, order)
      return outcome
    }
  }

  // Awaiting this payment but the amount is off: mismatch. Awaiting nothing (already paid, or remainder paid before
  // arrival): overpayment.
  const transactionPurpose = link?.purpose ?? 'full'
  const reason: ReconciliationReason =
    order.status === 'cancelled'
      ? 'paid_after_cancel'
      : awaiting?.purpose === transactionPurpose
        ? 'amount_mismatch'
        : order.paymentStatus === 'unpaid'
          ? 'amount_mismatch'
          : 'extra_payment'
  await tx.reconciliationItem.create({
    data: {
      orderId: order.id,
      transactionId: transaction.id,
      reason,
      amount: receipt.amount,
      receivedAt: receipt.paidAt,
    },
  })
  await recordOrderEvent(tx, order.id, 'payment_flagged', { type: 'system' }, { ...eventData, reason })
  return 'flagged'
}

/**
 * Asks the gateway for payments on every link of the order, oldest first, and records each (`query` source), in case a
 * callback is late or missing. No links, no query. Gateway errors throw; the caller decides to log and move on.
 */
export async function recordGatewayPayments(
  deps: RecordPaymentDeps & { payments: PaymentGateway },
  order: { code: number },
) {
  const links = await deps.prisma.paymentLink.findMany({
    where: { order: { code: order.code } },
    select: { gatewayReference: true },
    orderBy: { createdAt: 'asc' },
  })
  for (const { gatewayReference } of links) {
    const info = await deps.payments.getPayment(gatewayReference)
    for (const t of info.transactions) {
      await recordPayment(deps, {
        orderCode: order.code,
        amount: t.amount,
        reference: t.reference,
        gatewayReference,
        paidAt: t.paidAt,
        source: 'query',
        payload: t.payload ?? { reference: t.reference, amount: t.amount, paidAt: t.paidAt.toISOString() },
      })
    }
  }
}

/** Gateway references of every link of the order, oldest first: to cancel links on order cancel. */
export const PAYMENT_LINK_REFERENCES = {
  select: { gatewayReference: true },
  orderBy: { createdAt: 'asc' },
} as const satisfies Prisma.Order$paymentLinksArgs

type OrderWithLines = Prisma.OrderGetPayload<{ include: { lines: true } }>

/** What the order awaits: purpose and amount due; `null` when it awaits nothing. */
function awaitedPayment(order: Prisma.OrderGetPayload<object>): { purpose: PaymentPurpose; due: bigint } | null {
  if (order.kind === 'standard') {
    return order.status === 'pending_payment' ? { purpose: 'full', due: order.total } : null
  }
  if (order.status === 'pending_payment') return { purpose: 'deposit', due: order.depositAmount! }
  if (order.status === 'processing' && order.paymentStatus === 'deposit_paid' && order.arrivedAt) {
    return { purpose: 'remainder', due: remainingOf(order) }
  }
  return null
}

/**
 * Queues the "payment received" email (order summary, total, lookup link with a new token) in the state change's
 * transaction. Shared by normal payments and reconciliation restores. `order.lines` sorted by `position`.
 */
export async function queuePaymentReceivedEmail(
  tx: DbClient,
  { emails, siteUrl }: Pick<RecordPaymentDeps, 'emails' | 'siteUrl'>,
  order: OrderWithLines,
) {
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  const lines = order.lines.map((line) => {
    const attributes = Object.values(line.attributes as Record<string, unknown>)
      .map((v) => (Array.isArray(v) ? v.join(', ') : String(v)))
      .join(' · ')
    const name = attributes ? `${line.productName} (${attributes})` : line.productName
    return `- ${name} x ${line.quantity}: ${vnd(line.price * BigInt(line.quantity))}`
  })
  // Draft, awaiting the owner's approval of the wording.
  await emails.sendEmail(tx, {
    to: order.email,
    subject: `Đã nhận thanh toán đơn hàng #${order.code}`,
    text: [
      `Chào ${order.recipientName},`,
      '',
      `Chúng tôi đã nhận đủ thanh toán cho đơn hàng #${order.code}.`,
      '',
      ...lines,
      ...voucherLines(order),
      `Phí giao: ${vnd(order.shippingFee)}`,
      `Tổng cộng: ${vnd(order.total)}`,
      '',
      `Xem đơn hàng: ${link}`,
      '',
      'Chúng tôi sẽ báo cho bạn khi đơn được giao cho đơn vị vận chuyển.',
    ].join('\n'),
  })
}

/**
 * Queues the pre-order "deposit received" email (deposit, remaining balance, expected delivery, lookup link with a new
 * token) in the state change's transaction. Shared by normal deposits and reconciliation restores.
 */
export async function queueDepositReceivedEmail(
  tx: DbClient,
  { emails, siteUrl }: Pick<RecordPaymentDeps, 'emails' | 'siteUrl'>,
  order: OrderWithLines,
) {
  const { depositAmount, deliveryFrom, deliveryTo, remainderDays } = order
  if (depositAmount === null || deliveryFrom === null || deliveryTo === null || remainderDays === null) {
    throw new Error(`Đơn ${order.code} không phải đơn đặt trước`)
  }
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  const line = order.lines[0]!
  // Draft, awaiting the owner's approval of the wording.
  await emails.sendEmail(tx, {
    to: order.email,
    subject: `Đã nhận tiền cọc đơn đặt trước #${order.code}`,
    text: [
      `Chào ${order.recipientName},`,
      '',
      `Chúng tôi đã nhận tiền cọc cho đơn đặt trước #${order.code}: ${line.productName} x ${line.quantity}.`,
      '',
      ...voucherLines(order),
      `Tiền cọc đã nhận: ${vnd(depositAmount)}`,
      `Phần còn lại (gồm phí giao): ${vnd(remainingOf(order))}`,
      `Thời gian giao dự kiến: ${dayVN(isoDay(deliveryFrom))} – ${dayVN(isoDay(deliveryTo))}`,
      '',
      `Khi hàng về, chúng tôi sẽ gửi email để bạn trả phần còn lại trong ${remainderDays} ngày.`,
      '',
      `Xem đơn hàng: ${link}`,
    ].join('\n'),
  })
}
