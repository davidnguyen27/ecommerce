import type { Db, DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { dateVN, vnd, voucherLines } from '../orders/format.ts'
import { DEPOSITED_PREORDER, issueOrderLookupUrl, recordOrderEvent, remainingOf } from '../orders/orders.ts'

/** Remind when this much or less remains before the remaining-balance deadline. */
export const REMINDER_WINDOW_MS = 2 * 24 * 60 * 60_000

export type DeadlineDeps = { prisma: Db; emails: EmailQueue; siteUrl: string }

/** Deposited, arrived pre-orders with the remainder unpaid: still within the payment window. */
const AWAITING_REMAINDER = {
  ...DEPOSITED_PREORDER,
  arrivedAt: { not: null },
} as const satisfies Prisma.OrderWhereInput

/**
 * Hourly job for the remaining-balance deadline (ticket 08): one reminder email for orders ≤ 2 days from the deadline,
 * and an overdue flag for orders past it. Overdue does not cancel, release stock or forfeit the deposit: the customer
 * can still pay and staff follow up (M6 decides the rest). Each order runs in its own transaction, locking the order
 * and rechecking, so repeated or concurrent runs (even with a payment in flight) give one result. `now` lets tests run
 * in the future.
 */
export async function processRemainderDeadlines(deps: DeadlineDeps, now = new Date()) {
  const remindBefore = new Date(now.getTime() + REMINDER_WINDOW_MS)
  const dueSoon = await deps.prisma.order.findMany({
    where: { ...AWAITING_REMAINDER, remainderRemindedAt: null, remainderDueAt: { gt: now, lte: remindBefore } },
    select: { id: true },
    orderBy: { remainderDueAt: 'asc' },
  })
  let reminded = 0
  for (const { id } of dueSoon) {
    const done = await deps.prisma.$transaction(async (tx) => {
      const order = await lockAwaiting(tx, id)
      if (!order || order.remainderRemindedAt || !order.remainderDueAt) return false
      if (order.remainderDueAt <= now || order.remainderDueAt > remindBefore) return false
      await tx.order.update({ where: { id }, data: { remainderRemindedAt: now } })
      await recordOrderEvent(tx, id, 'remainder_reminded', { type: 'system' })
      await queueReminderEmail(tx, deps, order)
      return true
    })
    if (done) reminded += 1
  }

  const overdue = await deps.prisma.order.findMany({
    where: { ...AWAITING_REMAINDER, remainderOverdueAt: null, remainderDueAt: { lte: now } },
    select: { id: true },
    orderBy: { remainderDueAt: 'asc' },
  })
  let flagged = 0
  for (const { id } of overdue) {
    const done = await deps.prisma.$transaction(async (tx) => {
      const order = await lockAwaiting(tx, id)
      if (!order || order.remainderOverdueAt || !order.remainderDueAt || order.remainderDueAt > now) return false
      await tx.order.update({ where: { id }, data: { remainderOverdueAt: now } })
      await recordOrderEvent(
        tx,
        id,
        'remainder_overdue',
        { type: 'system' },
        {
          remainderDueAt: order.remainderDueAt.toISOString(),
        },
      )
      return true
    })
    if (done) flagged += 1
  }
  return { reminded, flagged }
}

/** Locks the order (same lock as payment recording) and rereads it; `null` when it no longer awaits the remainder. */
async function lockAwaiting(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "order" WHERE "id" = ${id}::uuid FOR UPDATE`
  return tx.order.findFirst({
    where: { id, ...AWAITING_REMAINDER },
    include: { lines: { orderBy: { position: 'asc' } } },
  })
}

/** Remaining-balance reminder: amount, deadline, order page link (new token). Draft awaiting owner approval. */
async function queueReminderEmail(
  tx: DbClient,
  { emails, siteUrl }: Pick<DeadlineDeps, 'emails' | 'siteUrl'>,
  order: Prisma.OrderGetPayload<{ include: { lines: true } }>,
) {
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  await emails.sendEmail(tx, {
    to: order.email,
    subject: `Nhắc trả phần còn lại đơn đặt trước #${order.code}`,
    text: [
      `Chào ${order.recipientName},`,
      '',
      `Hàng của đơn đặt trước #${order.code} đã về và đang được giữ cho bạn.`,
      ...voucherLines(order),
      `Phần còn lại cần trả: ${vnd(remainingOf(order))}, hạn ${dateVN(order.remainderDueAt!)}.`,
      '',
      `Trả phần còn lại tại trang đơn hàng: ${link}`,
    ].join('\n'),
  })
}
