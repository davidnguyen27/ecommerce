import type { ReportQuery } from '@ecommerce/shared'

/** Today in Vietnam time, `YYYY-MM-DD` (`en-CA` formats dates ISO-style). */
const vnToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/**
 * The selected report period, read from the query string so links can be shared; defaults to the 1st of this month
 * through today. Every report tab shares one period.
 */
export function useReportPeriod() {
  const route = useRoute()
  return computed<ReportQuery>(() => {
    const today = vnToday()
    return {
      from: text(route.query.from) ?? `${today.slice(0, 8)}01`,
      to: text(route.query.to) ?? today,
      groupBy: route.query.groupBy === 'month' ? 'month' : 'day',
    }
  })
}

/** Label of a report row: day `YYYY-MM-DD` as `30/10/2026`, month `YYYY-MM` as `10/2026`. */
export const formatReportPeriod = (period: string) => period.split('-').reverse().join('/')

/** A 0–1 ratio as `33,3%`; `null` (zero denominator) as `—`. */
export const formatReportRate = (rate: number | null) =>
  rate === null ? '—' : `${(rate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
