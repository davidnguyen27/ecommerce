// Định dạng dùng chung cho response và email của đơn hàng, đặt trước.

const VND = new Intl.NumberFormat('vi-VN')

/** Ngày `YYYY-MM-DD` của một cột DATE (Prisma trả nửa đêm UTC), không qua múi giờ nào. */
export const isoDay = (date: Date) => date.toISOString().slice(0, 10)

/** Ngày lịch `YYYY-MM-DD` thành `30/10/2026`, như khách đọc trong email. */
export const dayVN = (day: string) => day.split('-').reverse().join('/')

/** Thời điểm thành ngày theo giờ Việt Nam, `30/10/2026` (hạn trả phần còn lại). */
export const dateVN = (date: Date) => date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })

/** Tiền VND trong email và thông báo lỗi: `1.500.000 ₫`. */
export const vnd = (amount: bigint | number) => `${VND.format(amount)} ₫`

/** Dòng mã giảm giá trong email tóm tắt đơn; không có gì khi đơn không dùng mã. */
export const voucherLines = (order: { voucherCode: string | null; discount: bigint }) =>
  order.voucherCode ? [`Mã giảm giá ${order.voucherCode}: -${vnd(order.discount)}`] : []
