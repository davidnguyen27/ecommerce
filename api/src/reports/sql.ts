import { Prisma } from '../generated/prisma/client.ts'
import { inPeriod, type Period } from './period.ts'

// SQL fragments shared by reports.

/**
 * CTE `"root"` (`id`, `origin`): each refund with the origin of the first refund in its retry chain. A `retry` refund
 * carries the origin of the one it replaced, so reports split only by cancel, reconciliation and return.
 */
export const REFUND_ROOTS = Prisma.sql`
  WITH RECURSIVE "root" AS (
    SELECT "id", "origin" FROM "refund" WHERE "retry_of_id" IS NULL
    UNION ALL
    SELECT c."id", "root"."origin" FROM "refund" c JOIN "root" ON c."retry_of_id" = "root"."id"
  )`

/**
 * Condition "order delivered in the period" (ADR 0016) on order event `e` and order `o`: a completed order with a
 * `delivered` event in the period; that event's time is the delivery date.
 */
export const deliveredInPeriod = (period: Period) =>
  Prisma.sql`e."kind" = 'delivered' AND o."status" = 'completed' AND ${inPeriod(Prisma.sql`e."created_at"`, period)}`
