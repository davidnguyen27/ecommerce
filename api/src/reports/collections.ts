import type { CollectionsFigures, CollectionsReport, CollectionsSnapshot } from '@ecommerce/shared'
import type { DbClient } from '../core/db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { DEPOSITED_PREORDER } from '../modules/order/index.ts'
import { bucketOf, inPeriod, type Period } from './period.ts'
import { REFUND_ROOTS } from './sql.ts'

const empty = (): CollectionsFigures => ({
  receivedFull: 0,
  receivedDeposit: 0,
  receivedRemainder: 0,
  received: 0,
  refundedCancellation: 0,
  refundedReconciliation: 0,
  refundedReturn: 0,
  refunded: 0,
  net: 0,
})

const RECEIVED = { full: 'receivedFull', deposit: 'receivedDeposit', remainder: 'receivedRemainder' } as const
const REFUNDED = {
  cancellation: 'refundedCancellation',
  reconciliation: 'refundedReconciliation',
  return: 'refundedReturn',
} as const

/**
 * Period collections (GLOSSARY "Tiền thu", ADR 0016): gateway transactions by `paidAt`, minus completed refunds by
 * `completedAt`. Plus point-in-time figures.
 */
export async function collectionsReport(db: DbClient, period: Period): Promise<CollectionsReport> {
  const paidAt = Prisma.sql`t."paid_at"`
  const completedAt = Prisma.sql`r."completed_at"`
  const [received, refunded, snapshot] = await Promise.all([
    db.$queryRaw<{ bucket: string; purpose: keyof typeof RECEIVED; amount: bigint }[]>`
      SELECT ${bucketOf(paidAt, period)} AS "bucket", t."purpose"::text AS "purpose", sum(t."amount")::bigint AS "amount"
      FROM "payment_transaction" t
      WHERE ${inPeriod(paidAt, period)}
      GROUP BY 1, 2`,
    db.$queryRaw<{ bucket: string; origin: keyof typeof REFUNDED; amount: bigint }[]>`
      ${REFUND_ROOTS}
      SELECT ${bucketOf(completedAt, period)} AS "bucket", "root"."origin"::text AS "origin",
        sum(r."amount")::bigint AS "amount"
      FROM "refund" r JOIN "root" ON "root"."id" = r."id"
      WHERE r."status" = 'succeeded' AND ${inPeriod(completedAt, period)}
      GROUP BY 1, 2`,
    collectionsSnapshot(db),
  ])

  const rows = new Map(period.buckets.map((bucket) => [bucket, empty()]))
  for (const row of received) rows.get(row.bucket)![RECEIVED[row.purpose]] += Number(row.amount)
  for (const row of refunded) rows.get(row.bucket)![REFUNDED[row.origin]] += Number(row.amount)

  const total = empty()
  const items = [...rows].map(([bucket, row]) => {
    row.received = row.receivedFull + row.receivedDeposit + row.receivedRemainder
    row.refunded = row.refundedCancellation + row.refundedReconciliation + row.refundedReturn
    row.net = row.received - row.refunded
    for (const key of Object.keys(total) as (keyof CollectionsFigures)[]) total[key] += row[key]
    return { period: bucket, ...row }
  })
  return { from: period.from, to: period.to, groupBy: period.groupBy, rows: items, total, snapshot }
}

/** Point-in-time figures: no per-period history (spec M7). */
async function collectionsSnapshot(db: DbClient): Promise<CollectionsSnapshot> {
  const [held, outstanding, refunding, reconciliation] = await Promise.all([
    // Money held for undelivered pre-orders: deposits, plus remainders paid before delivery.
    db.$queryRaw<{ count: number; amount: bigint }[]>`
      SELECT count(*)::int AS "count", coalesce(sum(h."held"), 0)::bigint AS "amount"
      FROM (
        SELECT
          (SELECT coalesce(sum(t."amount"), 0) FROM "payment_transaction" t WHERE t."order_id" = o."id")
          - (SELECT coalesce(sum(r."amount"), 0) FROM "refund" r WHERE r."order_id" = o."id" AND r."status" = 'succeeded')
          AS "held"
        FROM "order" o
        WHERE o."kind" = 'preorder' AND o."status" <> 'cancelled' AND o."fulfillment_status" <> 'delivered'
      ) h
      WHERE h."held" > 0`,
    db.order.aggregate({
      where: DEPOSITED_PREORDER,
      _count: true,
      _sum: { total: true, depositAmount: true },
    }),
    db.refund.aggregate({ where: { status: { in: ['pending', 'processing'] } }, _count: true, _sum: { amount: true } }),
    db.reconciliationItem.aggregate({ where: { status: 'open' }, _count: true, _sum: { amount: true } }),
  ])
  return {
    depositsHeld: { count: held[0]!.count, amount: Number(held[0]!.amount) },
    outstanding: {
      count: outstanding._count,
      amount: Number((outstanding._sum.total ?? 0n) - (outstanding._sum.depositAmount ?? 0n)),
    },
    refunding: { count: refunding._count, amount: Number(refunding._sum.amount ?? 0n) },
    reconciliation: { count: reconciliation._count, amount: Number(reconciliation._sum.amount ?? 0n) },
  }
}
