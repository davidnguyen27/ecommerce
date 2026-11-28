// Shared formatting for money and dates in responses and emails.

const VND = new Intl.NumberFormat('vi-VN')

/** `YYYY-MM-DD` of a DATE column (Prisma returns UTC midnight), with no time zone conversion. */
export const isoDay = (date: Date) => date.toISOString().slice(0, 10)

/** Calendar day `YYYY-MM-DD` as `30/10/2026`, as customers read it in emails. */
export const dayVN = (day: string) => day.split('-').reverse().join('/')

/** A timestamp as a Vietnam-time day, `30/10/2026` (remaining-balance deadline). */
export const dateVN = (date: Date) => date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })

/** VND in emails and error messages: `1.500.000 ₫`. */
export const vnd = (amount: bigint | number) => `${VND.format(amount)} ₫`

/** Voucher line in the order summary email; nothing when no voucher was used. */
export const voucherLines = (order: { voucherCode: string | null; discount: bigint }) =>
  order.voucherCode ? [`Mã giảm giá ${order.voucherCode}: -${vnd(order.discount)}`] : []
