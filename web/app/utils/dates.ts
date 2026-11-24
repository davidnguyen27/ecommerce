// Fixed time zone: SSR and the browser render the same string, and staff anywhere see Vietnam time.
const TIME_ZONE = 'Asia/Ho_Chi_Minh'

/** ISO timestamp as `30/10/2026 14:05` (with seconds when matching logs). */
export const formatDateTime = (iso: string, options: { seconds?: boolean } = {}) =>
  new Date(iso).toLocaleString('vi-VN', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.seconds && { second: '2-digit' }),
  })

/** ISO timestamp as the day `30/10/2026`. */
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { timeZone: TIME_ZONE })

/** Calendar day `YYYY-MM-DD` (no time, like an arrival date) as `30/10/2026`, with no time zone conversion. */
export const formatDateOnly = (date: string) => date.split('-').reverse().join('/')
