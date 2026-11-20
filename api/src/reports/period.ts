import type { ReportGroupBy, ReportQuery } from '@ecommerce/shared'
import { Prisma } from '../generated/prisma/client.ts'

/** Lịch của báo cáo; Việt Nam không đổi giờ mùa hè nên mốc ngày luôn là UTC+7. */
export const REPORT_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const OFFSET_MS = 7 * 60 * 60_000
const DAY = 24 * 60 * 60_000

/** Kỳ đã đổi ra mốc UTC: `[start, end)`, cùng danh sách nhãn ngày/tháng của kỳ theo thứ tự. */
export type Period = { from: string; to: string; groupBy: ReportGroupBy; start: Date; end: Date; buckets: string[] }

/** Đầu ngày lịch `YYYY-MM-DD` theo giờ Việt Nam. */
const startOfDay = (date: string) => new Date(Date.parse(date) - OFFSET_MS)

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
 * Mốc thời điểm để so với cột `TIMESTAMP` không múi giờ. Prisma lưu các cột này theo giờ UTC, nên mốc cũng đổi về UTC
 * không múi giờ, không phụ thuộc `TimeZone` của phiên DB.
 */
export const utcBound = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`

/** Điều kiện "cột thời điểm nằm trong kỳ" `[start, end)`. */
export const inPeriod = (column: Prisma.Sql, period: Period) =>
  Prisma.sql`${column} >= ${utcBound(period.start)} AND ${column} < ${utcBound(period.end)}`

/** Nhãn ngày (`YYYY-MM-DD`) hay tháng (`YYYY-MM`) theo giờ Việt Nam của một cột thời điểm. */
export const bucketOf = (column: Prisma.Sql, period: Period) =>
  Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${Prisma.raw(`'${REPORT_TIME_ZONE}'`)}, ${
    period.groupBy === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'
  })`
