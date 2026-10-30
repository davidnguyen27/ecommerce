// Cố định múi giờ: SSR và trình duyệt render cùng một chuỗi, và nhân viên ở đâu cũng thấy giờ Việt Nam.
const TIME_ZONE = 'Asia/Ho_Chi_Minh'

/** Thời điểm ISO thành `30/10/2026 14:05` (kèm giây khi cần đối chiếu nhật ký). */
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

/** Thời điểm ISO thành ngày `30/10/2026`. */
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { timeZone: TIME_ZONE })

/** Ngày lịch `YYYY-MM-DD` (không có giờ, như ngày hàng về) thành `30/10/2026`, không qua múi giờ nào. */
export const formatDateOnly = (date: string) => date.split('-').reverse().join('/')
