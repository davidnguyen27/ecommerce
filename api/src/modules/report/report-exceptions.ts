import type { ExceptionsReport } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { DEPOSITED_PREORDER, remainingOf } from '../order/index.ts'
import { REPORT_TIME_ZONE } from './report-period.ts'

/** Refunds unfinished after this many days count as stuck (pending owner confirmation). */
export const STALE_REFUND_DAYS = 3
/** Variants with at most this many sellable units count as running low (pending owner confirmation). */
export const LOW_STOCK_THRESHOLD = 2
/** Rows per section; the dashboard only needs to show what to do first. */
const LIMIT = 10

const DAY = 24 * 60 * 60_000

/** Today's Vietnam-time calendar day, as 00:00 UTC to compare with `DATE` columns. */
const vnToday = (now: Date) =>
  new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TIME_ZONE }).format(now)}T00:00:00Z`)

/** Exceptions board (spec M7): six sections of pending decisions, as of `now`. */
export async function exceptionsReport(db: DbClient, now = new Date()): Promise<ExceptionsReport> {
  const staleBefore = new Date(now.getTime() - STALE_REFUND_DAYS * DAY)
  const openSupport = {
    status: { in: ['new', 'in_progress', 'waiting_customer'] },
    assigneeId: null,
  } satisfies Prisma.SupportRequestWhereInput
  const staleRefund = {
    status: { in: ['pending', 'processing'] },
    createdAt: { lt: staleBefore },
  } satisfies Prisma.RefundWhereInput
  const overdue = { ...DEPOSITED_PREORDER, remainderOverdueAt: { not: null } } satisfies Prisma.OrderWhereInput
  // Deposited (processing) orders only: pending deposits are no commitment yet and expire on their own.
  const late = {
    kind: 'preorder',
    status: 'processing',
    fulfillmentStatus: { not: 'delivered' },
    deliveryTo: { lt: vnToday(now) },
  } satisfies Prisma.OrderWhereInput

  const [
    reconciliationCount,
    reconciliation,
    staleRefundCount,
    staleRefunds,
    overdueCount,
    overdueOrders,
    lateCount,
    lateOrders,
    supportCount,
    support,
    lowStock,
  ] = await Promise.all([
    db.reconciliationItem.count({ where: { status: 'open' } }),
    db.reconciliationItem.findMany({
      where: { status: 'open' },
      include: { order: { select: { code: true } } },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: LIMIT,
    }),
    db.refund.count({ where: staleRefund }),
    db.refund.findMany({
      where: staleRefund,
      include: { order: { select: { code: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LIMIT,
    }),
    db.order.count({ where: overdue }),
    db.order.findMany({ where: overdue, orderBy: [{ remainderDueAt: 'asc' }, { code: 'asc' }], take: LIMIT }),
    db.order.count({ where: late }),
    db.order.findMany({
      where: late,
      include: { lines: { orderBy: { position: 'asc' }, take: 1 } },
      orderBy: [{ deliveryTo: 'asc' }, { code: 'asc' }],
      take: LIMIT,
    }),
    db.supportRequest.count({ where: openSupport }),
    db.supportRequest.findMany({ where: openSupport, orderBy: [{ createdAt: 'asc' }, { code: 'asc' }], take: LIMIT }),
    db.$queryRaw<{ variantId: string; sku: string; productName: string; available: number }[]>`
      SELECT v."id"::text AS "variantId", v."sku", p."name" AS "productName",
        (v."on_hand" - v."reserved")::int AS "available"
      FROM "product_variant" v JOIN "product" p ON p."id" = v."product_id"
      WHERE v."status" = 'active' AND p."status" = 'published' AND v."on_hand" - v."reserved" <= ${LOW_STOCK_THRESHOLD}
      ORDER BY "available", v."sku"`,
  ])

  return {
    thresholds: { staleRefundDays: STALE_REFUND_DAYS, lowStock: LOW_STOCK_THRESHOLD },
    reconciliation: {
      count: reconciliationCount,
      items: reconciliation.map((item) => ({
        id: item.id,
        orderCode: item.order.code,
        reason: item.reason,
        amount: Number(item.amount),
        receivedAt: item.receivedAt.toISOString(),
      })),
    },
    staleRefunds: {
      count: staleRefundCount,
      items: staleRefunds.map((refund) => ({
        id: refund.id,
        orderCode: refund.order.code,
        amount: Number(refund.amount),
        status: refund.status,
        createdAt: refund.createdAt.toISOString(),
      })),
    },
    overdueRemainders: {
      count: overdueCount,
      items: overdueOrders.map((order) => ({
        orderCode: order.code,
        remainingAmount: Number(remainingOf(order)),
        remainderDueAt: order.remainderDueAt!.toISOString(),
      })),
    },
    latePreorders: {
      count: lateCount,
      items: lateOrders.map((order) => ({
        orderCode: order.code,
        productName: order.lines[0]!.productName,
        deliveryTo: order.deliveryTo!.toISOString().slice(0, 10),
      })),
    },
    unassignedSupport: {
      count: supportCount,
      items: support.map((request) => ({
        code: request.code,
        kind: request.kind,
        subject: request.subject,
        createdAt: request.createdAt.toISOString(),
      })),
    },
    lowStock: { count: lowStock.length, items: lowStock.slice(0, LIMIT) },
  }
}
