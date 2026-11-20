import type { ReportQuery } from '@ecommerce/shared'

/** Hôm nay theo lịch Việt Nam, `YYYY-MM-DD` (`en-CA` định dạng ngày đúng kiểu ISO). */
const vnToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/**
 * Kỳ báo cáo đang chọn, đọc từ query string để chia sẻ link được; mặc định từ ngày 1 tháng này tới hôm nay.
 * Mọi tab báo cáo dùng chung một kỳ.
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

/** Nhãn của một dòng báo cáo: ngày `YYYY-MM-DD` thành `30/10/2026`, tháng `YYYY-MM` thành `10/2026`. */
export const formatReportPeriod = (period: string) => period.split('-').reverse().join('/')

/** Tỷ lệ 0–1 thành `33,3%`; `null` (mẫu số bằng 0) thành `—`. */
export const formatReportRate = (rate: number | null) =>
  rate === null ? '—' : `${(rate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
