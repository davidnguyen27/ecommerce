import {
  ProductType,
  ReturnKind,
  WarrantyReportOutcome,
  type ReturnsReport,
  type SupportReturnReason,
  type WarrantyOutcome,
} from '@ecommerce/shared'
import type { DbClient } from '../core/db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { inPeriod, type Period } from './period.ts'
import { deliveredInPeriod } from './sql.ts'

/**
 * Returns, exchanges and warranty (spec M7): requests created in the period. The return rate's numerator is accepted
 * returns created in the period, its denominator orders delivered in the period, by the line's product type.
 */
export async function returnsReport(db: DbClient, period: Period): Promise<ReturnsReport> {
  const createdAt = inPeriod(Prisma.sql`s."created_at"`, period)
  const [requests, lines, delivered, warranty] = await Promise.all([
    db.$queryRaw<{ kind: ReturnKind; decision: 'accepted' | 'rejected' | null; count: number }[]>`
      SELECT s."kind"::text AS "kind", s."decision"::text AS "decision", count(*)::int AS "count"
      FROM "support_request" s
      WHERE s."kind" IN ('return', 'exchange') AND ${createdAt}
      GROUP BY 1, 2`,
    db.$queryRaw<
      {
        kind: ReturnKind
        reason: SupportReturnReason | null
        productType: ProductType
        accepted: boolean
        quantity: number
      }[]
    >`
      SELECT s."kind"::text AS "kind", sl."reason"::text AS "reason", p."product_type"::text AS "productType",
        s."decision" IS NOT DISTINCT FROM 'accepted' AS "accepted", sum(sl."quantity")::int AS "quantity"
      FROM "support_request" s
      JOIN "support_request_line" sl ON sl."request_id" = s."id"
      JOIN "order_line" l ON l."id" = sl."order_line_id"
      JOIN "product_variant" v ON v."id" = l."variant_id"
      JOIN "product" p ON p."id" = v."product_id"
      WHERE s."kind" IN ('return', 'exchange') AND ${createdAt}
      GROUP BY 1, 2, 3, 4`,
    db.$queryRaw<{ productType: ProductType; quantity: number }[]>`
      SELECT p."product_type"::text AS "productType", sum(l."quantity")::int AS "quantity"
      FROM "order_event" e
      JOIN "order" o ON o."id" = e."order_id"
      JOIN "order_line" l ON l."order_id" = o."id"
      JOIN "product_variant" v ON v."id" = l."variant_id"
      JOIN "product" p ON p."id" = v."product_id"
      WHERE ${deliveredInPeriod(period)}
      GROUP BY 1`,
    db.$queryRaw<{ outcome: WarrantyOutcome | null; declined: boolean; count: number }[]>`
      SELECT s."warranty_outcome"::text AS "outcome", s."decision" IS NOT DISTINCT FROM 'rejected' AS "declined",
        count(*)::int AS "count"
      FROM "support_request" s
      WHERE s."kind" = 'warranty' AND ${createdAt}
      GROUP BY 1, 2`,
  ])

  const byKind = new Map(ReturnKind.options.map((kind) => [kind, { accepted: 0, rejected: 0, pending: 0, total: 0 }]))
  for (const row of requests) {
    const target = byKind.get(row.kind)!
    target[row.decision ?? 'pending'] += row.count
    target.total += row.count
  }

  // Several groups (accepted or not) share reason × product type: merge them for the row table.
  const lineTotals = new Map<string, ReturnsReport['lines'][number]>()
  const returned = new Map<ProductType, number>()
  for (const row of lines) {
    const key = `${row.kind}|${row.reason}|${row.productType}`
    const line = lineTotals.get(key) ?? {
      kind: row.kind,
      reason: row.reason,
      productType: row.productType,
      quantity: 0,
    }
    line.quantity += row.quantity
    lineTotals.set(key, line)
    if (row.kind === 'return' && row.accepted)
      returned.set(row.productType, (returned.get(row.productType) ?? 0) + row.quantity)
  }

  const deliveredBy = new Map(delivered.map((row) => [row.productType, row.quantity]))
  const returnRate = ProductType.options
    .filter((type) => returned.has(type) || deliveredBy.has(type))
    .map((productType) => {
      const returnedQty = returned.get(productType) ?? 0
      const deliveredQty = deliveredBy.get(productType) ?? 0
      return {
        productType,
        returned: returnedQty,
        delivered: deliveredQty,
        rate: deliveredQty === 0 ? null : returnedQty / deliveredQty,
      }
    })

  const warrantyBy = new Map(WarrantyReportOutcome.options.map((outcome) => [outcome, 0]))
  for (const row of warranty) {
    const outcome = row.outcome ?? (row.declined ? 'declined' : 'in_progress')
    warrantyBy.set(outcome, warrantyBy.get(outcome)! + row.count)
  }

  return {
    from: period.from,
    to: period.to,
    requests: [...byKind].map(([kind, counts]) => ({ kind, ...counts })),
    lines: [...lineTotals.values()].sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        String(a.reason).localeCompare(String(b.reason)) ||
        a.productType.localeCompare(b.productType),
    ),
    returnRate,
    warranty: [...warrantyBy].map(([outcome, count]) => ({ outcome, count })),
    warrantyTotal: [...warrantyBy.values()].reduce((sum, n) => sum + n, 0),
  }
}
