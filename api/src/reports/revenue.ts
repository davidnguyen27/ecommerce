import type { RevenueFigures, RevenueReport } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { bucketOf, inPeriod, type Period } from './period.ts'

const empty = (): RevenueFigures => ({
  deliveredOrders: 0,
  grossStandard: 0,
  grossPreorder: 0,
  gross: 0,
  returns: 0,
  net: 0,
  shippingFees: 0,
  forfeitedDeposits: 0,
})

/**
 * Doanh thu của kỳ (ADR 0016): đơn đã giao theo ngày giao, hàng trả lại theo ngày hoàn xong, mất cọc của đơn đặt trước
 * theo ngày hủy. Ba nguồn tính riêng rồi ghép theo nhãn ngày/tháng.
 */
export async function revenueReport(db: DbClient, period: Period): Promise<RevenueReport> {
  const deliveredAt = Prisma.sql`e."created_at"`
  const completedAt = Prisma.sql`r."completed_at"`
  const cancelledAt = Prisma.sql`f."cancelled_at"`
  const [delivered, returns, forfeited] = await Promise.all([
    db.$queryRaw<{ bucket: string; kind: 'standard' | 'preorder'; orders: number; gross: bigint; shipping: bigint }[]>`
      SELECT ${bucketOf(deliveredAt, period)} AS "bucket", o."kind"::text AS "kind", count(*)::int AS "orders",
        sum(o."subtotal" - o."discount")::bigint AS "gross", sum(o."shipping_fee")::bigint AS "shipping"
      FROM "order_event" e JOIN "order" o ON o."id" = e."order_id"
      WHERE e."kind" = 'delivered' AND o."status" = 'completed' AND ${inPeriod(deliveredAt, period)}
      GROUP BY 1, 2`,
    db.$queryRaw<{ bucket: string; amount: bigint }[]>`
      SELECT ${bucketOf(completedAt, period)} AS "bucket", sum(r."amount")::bigint AS "amount"
      FROM "refund" r
      WHERE r."origin" = 'return' AND r."status" = 'succeeded' AND ${inPeriod(completedAt, period)}
      GROUP BY 1`,
    // Mất cọc: tiền đã nhận trừ mọi khoản hoàn chưa thất bại (kể cả đang hoàn) của đơn đặt trước đã hủy.
    db.$queryRaw<{ bucket: string; amount: bigint }[]>`
      SELECT ${bucketOf(cancelledAt, period)} AS "bucket", sum(f."kept")::bigint AS "amount"
      FROM (
        SELECT o."cancelled_at",
          (SELECT coalesce(sum(t."amount"), 0) FROM "payment_transaction" t WHERE t."order_id" = o."id")
          - (SELECT coalesce(sum(r."amount"), 0) FROM "refund" r WHERE r."order_id" = o."id" AND r."status" <> 'failed')
          AS "kept"
        FROM "order" o
        WHERE o."kind" = 'preorder' AND o."status" = 'cancelled' AND ${inPeriod(Prisma.sql`o."cancelled_at"`, period)}
      ) f
      WHERE f."kept" > 0
      GROUP BY 1`,
  ])

  const rows = new Map(period.buckets.map((bucket) => [bucket, empty()]))
  const at = (bucket: string) => rows.get(bucket)!
  for (const d of delivered) {
    const row = at(d.bucket)
    row.deliveredOrders += d.orders
    row[d.kind === 'standard' ? 'grossStandard' : 'grossPreorder'] += Number(d.gross)
    row.shippingFees += Number(d.shipping)
  }
  for (const r of returns) at(r.bucket).returns += Number(r.amount)
  for (const f of forfeited) at(f.bucket).forfeitedDeposits += Number(f.amount)

  const total = empty()
  const items = [...rows].map(([bucket, row]) => {
    row.gross = row.grossStandard + row.grossPreorder
    row.net = row.gross - row.returns
    for (const key of Object.keys(total) as (keyof RevenueFigures)[]) total[key] += row[key]
    return { period: bucket, ...row }
  })
  return { from: period.from, to: period.to, groupBy: period.groupBy, rows: items, total }
}
