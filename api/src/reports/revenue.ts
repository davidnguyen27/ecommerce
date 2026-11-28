import { REVENUE_TOP_SKUS, type ProductType, type RevenueFigures, type RevenueReport } from '@ecommerce/shared'
import type { DbClient } from '../core/db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { bucketOf, inPeriod, type Period } from './period.ts'
import { REFUND_ROOTS, deliveredInPeriod } from './sql.ts'

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
 * Period revenue (ADR 0016): delivered orders by delivery date, returns by refund completion date, forfeited pre-order
 * deposits by cancel date. The three sources are computed apart, then merged by day/month label.
 */
export async function revenueReport(db: DbClient, period: Period): Promise<RevenueReport> {
  const deliveredAt = Prisma.sql`e."created_at"`
  const completedAt = Prisma.sql`r."completed_at"`
  const cancelledAt = Prisma.sql`f."cancelled_at"`
  const [breakdown, delivered, returns, forfeited] = await Promise.all([
    salesBreakdown(db, period),
    db.$queryRaw<{ bucket: string; kind: 'standard' | 'preorder'; orders: number; gross: bigint; shipping: bigint }[]>`
      SELECT ${bucketOf(deliveredAt, period)} AS "bucket", o."kind"::text AS "kind", count(*)::int AS "orders",
        sum(o."subtotal" - o."discount")::bigint AS "gross", sum(o."shipping_fee")::bigint AS "shipping"
      FROM "order_event" e JOIN "order" o ON o."id" = e."order_id"
      WHERE ${deliveredInPeriod(period)}
      GROUP BY 1, 2`,
    // Returns include refunds recreated after a failed return refund (origin `return`).
    db.$queryRaw<{ bucket: string; amount: bigint }[]>`
      ${REFUND_ROOTS}
      SELECT ${bucketOf(completedAt, period)} AS "bucket", sum(r."amount")::bigint AS "amount"
      FROM "refund" r JOIN "root" ON "root"."id" = r."id"
      WHERE "root"."origin" = 'return' AND r."status" = 'succeeded' AND ${inPeriod(completedAt, period)}
      GROUP BY 1`,
    // Forfeited deposit: received minus every non-failed refund (refunding included) of a cancelled pre-order.
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
  return { from: period.from, to: period.to, groupBy: period.groupBy, rows: items, total, ...breakdown }
}

type Sales = { quantity: number; gross: bigint }
const figures = ({ quantity, gross }: Sales) => ({ quantity, gross: Number(gross) })

/**
 * Revenue by product type, brand and SKU, from lines of orders delivered in the period (line amount minus line
 * discount). Type, brand, SKU and name are current values since lines do not snapshot the brand; returns are not
 * split down here (spec M7).
 */
async function salesBreakdown(db: DbClient, period: Period) {
  const lines = Prisma.sql`
    WITH "sold" AS (
      SELECT l."variant_id", l."quantity", l."price" * l."quantity" - l."discount" AS "gross"
      FROM "order_event" e
      JOIN "order" o ON o."id" = e."order_id"
      JOIN "order_line" l ON l."order_id" = o."id"
      WHERE ${deliveredInPeriod(period)}
    )`
  const from = Prisma.sql`
    FROM "sold" s
    JOIN "product_variant" v ON v."id" = s."variant_id"
    JOIN "product" p ON p."id" = v."product_id"`
  const totals = Prisma.sql`sum(s."quantity")::int AS "quantity", sum(s."gross")::bigint AS "gross"`
  const [byType, byBrand, topSkus] = await Promise.all([
    db.$queryRaw<(Sales & { productType: ProductType })[]>`${lines}
      SELECT p."product_type"::text AS "productType", ${totals} ${from}
      GROUP BY p."product_type" ORDER BY "gross" DESC, "productType"`,
    db.$queryRaw<(Sales & { brandId: string; brandName: string })[]>`${lines}
      SELECT b."id"::text AS "brandId", b."name" AS "brandName", ${totals} ${from}
      JOIN "brand" b ON b."id" = p."brand_id"
      GROUP BY b."id" ORDER BY "gross" DESC, b."name"`,
    db.$queryRaw<(Sales & { variantId: string; sku: string; productName: string })[]>`${lines}
      SELECT v."id"::text AS "variantId", v."sku", p."name" AS "productName", ${totals} ${from}
      GROUP BY v."id", p."id" ORDER BY "gross" DESC, "quantity" DESC, v."sku"
      LIMIT ${REVENUE_TOP_SKUS}`,
  ])
  return {
    byProductType: byType.map((row) => ({ productType: row.productType, ...figures(row) })),
    byBrand: byBrand.map((row) => ({ brandId: row.brandId, brandName: row.brandName, ...figures(row) })),
    topSkus: topSkus.map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      productName: row.productName,
      ...figures(row),
    })),
  }
}
