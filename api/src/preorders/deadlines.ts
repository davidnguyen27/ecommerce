import type { Db, DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { dateVN, vnd, voucherLines } from '../orders/format.ts'
import { DEPOSITED_PREORDER, issueOrderLookupUrl, recordOrderEvent, remainingOf } from '../orders/orders.ts'

/** Nhắc khi còn từ chừng này tới hạn trả phần còn lại trở xuống. */
export const REMINDER_WINDOW_MS = 2 * 24 * 60 * 60_000

export type DeadlineDeps = { prisma: Db; emails: EmailQueue; siteUrl: string }

/** Đơn đặt trước đã cọc, đã về hàng, chưa trả phần còn lại: còn đang trong hạn trả. */
const AWAITING_REMAINDER = {
  ...DEPOSITED_PREORDER,
  arrivedAt: { not: null },
} as const satisfies Prisma.OrderWhereInput

/**
 * Job mỗi giờ cho hạn trả phần còn lại (ticket 08): gửi email nhắc một lần cho đơn còn ≤ 2 ngày tới hạn, và gắn cờ quá
 * hạn cho đơn đã qua hạn. Quá hạn không hủy đơn, không nhả hàng, không mất cọc: khách vẫn trả được, nhân viên liên hệ
 * (M6 quyết định phần còn lại). Mỗi đơn xử lý trong transaction riêng, khóa đơn rồi kiểm lại điều kiện, nên chạy nhiều
 * lần hay chạy song song với khách đang trả tiền vẫn cho một kết quả. `now` để test chạy ở tương lai.
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

/** Khóa đơn `FOR UPDATE` (cùng khóa với ghi nhận thanh toán) rồi đọc lại; `null` khi đơn không còn chờ phần còn lại. */
async function lockAwaiting(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "order" WHERE "id" = ${id}::uuid FOR UPDATE`
  return tx.order.findFirst({
    where: { id, ...AWAITING_REMAINDER },
    include: { lines: { orderBy: { position: 'asc' } } },
  })
}

/** Email nhắc trả phần còn lại: số tiền, hạn trả, link trang đơn (token mới). Bản nháp chờ chủ doanh nghiệp duyệt. */
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
