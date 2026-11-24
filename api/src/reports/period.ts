import type { ReportGroupBy, ReportQuery } from '@ecommerce/shared'
import { Prisma } from '../generated/prisma/client.ts'

/** Report calendar; Vietnam has no DST, so day boundaries are always UTC+7. */
export const REPORT_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const OFFSET_MS = 7 * 60 * 60_000
const DAY = 24 * 60 * 60_000

/** A period as UTC bounds `[start, end)`, with its day/month labels in order. */
export type Period = { from: string; to: string; groupBy: ReportGroupBy; start: Date; end: Date; buckets: string[] }

/** Start of calendar day `YYYY-MM-DD` in Vietnam time. */
export const startOfDay = (date: string) => new Date(Date.parse(date) - OFFSET_MS)

/** Vietnam-time calendar day `YYYY-MM-DD` of a timestamp. */
export const vnDate = (at: Date) => new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10)

export function periodOf(query: ReportQuery): Period {
  const start = startOfDay(query.from)
  const end = new Date(startOfDay(query.to).getTime() + DAY)
  const days: string[] = []
  for (let t = Date.parse(query.from); t <= Date.parse(query.to); t += DAY)
    days.push(new Date(t).toISOString().slice(0, 10))
  const buckets = query.groupBy === 'day' ? days : [...new Set(days.map((day) => day.slice(0, 7)))]
  return { ...query, start, end, buckets }
}

/**
 * A bound to compare with zone-less `TIMESTAMP` columns. Prisma stores them in UTC, so bounds convert to zone-less UTC
 * too, independent of the DB session's `TimeZone`.
 */
export const utcBound = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`

/** Condition "timestamp column within `[start, end)`". */
export const inPeriod = (column: Prisma.Sql, period: Period) =>
  Prisma.sql`${column} >= ${utcBound(period.start)} AND ${column} < ${utcBound(period.end)}`

/** Vietnam-time day (`YYYY-MM-DD`) or month (`YYYY-MM`) label of a timestamp column. */
export const bucketOf = (column: Prisma.Sql, period: Period) =>
  Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${Prisma.raw(`'${REPORT_TIME_ZONE}'`)}, ${
    period.groupBy === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'
  })`
