import {
  STOCK_REPORT_PAGE_SIZE,
  type ProductType,
  type StockFigures,
  type StockReport,
  type StockReportQuery,
} from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { inPeriod, utcBound, type Period } from './period.ts'

type Row = {
  opening: bigint
  received: bigint
  sold: bigint
  returned: bigint
  adjustedUp: bigint
  adjustedDown: bigint
  closing: bigint
}

const figures = (row: Row): StockFigures => ({
  opening: Number(row.opening),
  received: Number(row.received),
  sold: Number(row.sold),
  returned: Number(row.returned),
  adjustedUp: Number(row.adjustedUp),
  adjustedDown: Number(row.adjustedDown),
  closing: Number(row.closing),
})

/**
 * Xuất nhập tồn theo biến thể (spec M7). Tồn đầu/tồn cuối là `on_hand_after` của dòng sổ cuối cùng (theo `seq`) trước
 * đầu kỳ / trước hết kỳ; biến động trong kỳ cộng theo loại. Hiện mọi biến thể đã có dòng sổ tới hết kỳ.
 */
export async function stockReport(
  db: DbClient,
  period: Period,
  query: StockReportQuery,
  /** Mọi dòng, không phân trang (xuất Excel). */
  options: { all?: boolean } = {},
): Promise<StockReport> {
  const page = options.all
    ? Prisma.empty
    : Prisma.sql`LIMIT ${STOCK_REPORT_PAGE_SIZE} OFFSET ${(query.page - 1) * STOCK_REPORT_PAGE_SIZE}`
  const start = utcBound(period.start)
  const end = utcBound(period.end)
  const lastBefore = (bound: Prisma.Sql) => Prisma.sql`coalesce((
    SELECT x."on_hand_after" FROM "stock_movement" x
    WHERE x."variant_id" = v."id" AND x."created_at" < ${bound}
    ORDER BY x."seq" DESC LIMIT 1), 0)::bigint`
  const filters = [
    Prisma.sql`EXISTS (SELECT 1 FROM "stock_movement" x WHERE x."variant_id" = v."id" AND x."created_at" < ${end})`,
    ...(query.productType ? [Prisma.sql`p."product_type" = ${query.productType}::"product_type"`] : []),
    ...(query.brandId ? [Prisma.sql`p."brand_id" = ${query.brandId}::uuid`] : []),
  ]
  const sum = (condition: Prisma.Sql, sign = 1) =>
    Prisma.sql`coalesce(${Prisma.raw(sign < 0 ? '-' : '')}sum(m."quantity") FILTER (WHERE ${condition}), 0)::bigint`
  const perVariant = Prisma.sql`
    WITH "per" AS (
      SELECT v."id"::text AS "variantId", v."sku", p."name" AS "productName", b."name" AS "brandName",
        p."product_type"::text AS "productType",
        ${lastBefore(start)} AS "opening",
        ${sum(Prisma.sql`m."kind" IN ('receipt', 'opening')`)} AS "received",
        ${sum(Prisma.sql`m."kind" = 'sale'`, -1)} AS "sold",
        ${sum(Prisma.sql`m."kind" = 'return'`)} AS "returned",
        ${sum(Prisma.sql`m."kind" = 'adjustment' AND m."quantity" > 0`)} AS "adjustedUp",
        ${sum(Prisma.sql`m."kind" = 'adjustment' AND m."quantity" < 0`, -1)} AS "adjustedDown",
        ${lastBefore(end)} AS "closing",
        count(m."id")::int AS "moves"
      FROM "product_variant" v
      JOIN "product" p ON p."id" = v."product_id"
      JOIN "brand" b ON b."id" = p."brand_id"
      LEFT JOIN "stock_movement" m ON m."variant_id" = v."id" AND ${inPeriod(Prisma.sql`m."created_at"`, period)}
      WHERE ${Prisma.join(filters, ' AND ')}
      GROUP BY v."id", p."id", b."id"
    )`
  const shown = query.movedOnly ? Prisma.sql`WHERE "moves" > 0` : Prisma.empty

  const [brands, items, [totals]] = await Promise.all([
    db.$queryRaw<{ id: string; name: string }[]>`
      SELECT b."id"::text AS "id", b."name" FROM "brand" b
      WHERE EXISTS (
        SELECT 1 FROM "stock_movement" m
        JOIN "product_variant" v ON v."id" = m."variant_id"
        JOIN "product" p ON p."id" = v."product_id"
        WHERE p."brand_id" = b."id"
      )
      ORDER BY b."name"`,
    db.$queryRaw<
      (Row & { variantId: string; sku: string; productName: string; brandName: string; productType: ProductType })[]
    >`
      ${perVariant}
      SELECT * FROM "per" ${shown}
      ORDER BY "sku"
      ${page}`,
    db.$queryRaw<(Row & { count: number })[]>`
      ${perVariant}
      SELECT count(*)::int AS "count",
        coalesce(sum("opening"), 0)::bigint AS "opening", coalesce(sum("received"), 0)::bigint AS "received",
        coalesce(sum("sold"), 0)::bigint AS "sold", coalesce(sum("returned"), 0)::bigint AS "returned",
        coalesce(sum("adjustedUp"), 0)::bigint AS "adjustedUp",
        coalesce(sum("adjustedDown"), 0)::bigint AS "adjustedDown", coalesce(sum("closing"), 0)::bigint AS "closing"
      FROM "per" ${shown}`,
  ])
  return {
    from: period.from,
    to: period.to,
    items: items.map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      productName: row.productName,
      brandName: row.brandName,
      productType: row.productType,
      ...figures(row),
    })),
    totals: figures(totals!),
    brands,
    total: totals!.count,
    page: query.page,
    pageSize: STOCK_REPORT_PAGE_SIZE,
  }
}
