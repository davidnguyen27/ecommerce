import {
  OrderCancelCause,
  OrderCancelReason,
  type CancellationReport,
  type OrderKind,
  type RefundStatus,
  type ReportRefundOrigin,
} from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import { Prisma } from '../../generated/prisma/client.ts'
import { REFUND_ROOTS } from './report-sql.ts'
import { inPeriod, type Period } from './report-period.ts'

type KindCounts = { standard: number; preorder: number; total: number }
const counts = (): KindCounts => ({ standard: 0, preorder: 0, total: 0 })
const add = (target: KindCounts, kind: OrderKind, n: number) => {
  target[kind] += n
  target.total += n
}
const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole)

/**
 * Cancellations and refunds (spec M7). Orders created in the period split into confirmed (ever paid: a `paid`,
 * `deposit_paid` or `restored` event) and abandoned (cancelled without `cancelCause`, i.e. never paid). The cancel rate
 * uses confirmed orders only.
 */
export async function cancellationReport(db: DbClient, period: Period): Promise<CancellationReport> {
  const [orders, refunds] = await Promise.all([
    db.$queryRaw<
      {
        kind: OrderKind
        cancelled: boolean
        cause: OrderCancelCause | null
        reason: OrderCancelReason | null
        confirmed: boolean
        count: number
      }[]
    >`
      SELECT o."kind"::text AS "kind", o."status" = 'cancelled' AS "cancelled", o."cancel_cause"::text AS "cause",
        o."cancel_reason"::text AS "reason",
        EXISTS (
          SELECT 1 FROM "order_event" e
          WHERE e."order_id" = o."id" AND e."kind" IN ('paid', 'deposit_paid', 'restored')
        ) AS "confirmed",
        count(*)::int AS "count"
      FROM "order" o
      WHERE ${inPeriod(Prisma.sql`o."created_at"`, period)}
      GROUP BY 1, 2, 3, 4, 5`,
    db.$queryRaw<{ origin: ReportRefundOrigin; status: RefundStatus; count: number; amount: bigint }[]>`
      ${REFUND_ROOTS}
      SELECT "root"."origin"::text AS "origin", r."status"::text AS "status", count(*)::int AS "count",
        sum(r."amount")::bigint AS "amount"
      FROM "refund" r JOIN "root" ON "root"."id" = r."id"
      WHERE ${inPeriod(Prisma.sql`r."created_at"`, period)}
      GROUP BY 1, 2
      ORDER BY 1, 2`,
  ])

  const confirmed = counts()
  const cancelled = counts()
  const byCause = new Map(OrderCancelCause.options.map((cause) => [cause, counts()]))
  const abandoned = new Map(OrderCancelReason.options.map((reason) => [reason, 0]))
  for (const row of orders) {
    if (row.confirmed) add(confirmed, row.kind, row.count)
    if (row.confirmed && row.cancelled && row.cause) {
      add(cancelled, row.kind, row.count)
      add(byCause.get(row.cause)!, row.kind, row.count)
    }
    if (row.cancelled && !row.cause && row.reason) abandoned.set(row.reason, abandoned.get(row.reason)! + row.count)
  }

  return {
    from: period.from,
    to: period.to,
    confirmed,
    cancelled,
    rate: {
      standard: ratio(cancelled.standard, confirmed.standard),
      preorder: ratio(cancelled.preorder, confirmed.preorder),
      total: ratio(cancelled.total, confirmed.total),
    },
    byCause: [...byCause].map(([cause, c]) => ({ cause, ...c })),
    abandoned: [...abandoned].map(([reason, count]) => ({ reason, count })),
    abandonedTotal: [...abandoned.values()].reduce((sum, n) => sum + n, 0),
    refunds: refunds.map((row) => ({ ...row, amount: Number(row.amount) })),
  }
}
