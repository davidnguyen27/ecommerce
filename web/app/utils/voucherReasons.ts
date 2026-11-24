import type { VoucherReason } from '@ecommerce/shared'

/** Why a voucher does not apply, as customers read it. `disabled` shows as expired. */
export function voucherReasonText(reason: VoucherReason, shortfall?: number) {
  switch (reason) {
    case 'not_found':
      return 'Mã giảm giá không tồn tại'
    case 'not_started':
      return 'Mã giảm giá chưa tới thời gian áp dụng'
    case 'expired':
    case 'disabled':
      return 'Mã giảm giá đã hết hạn'
    case 'exhausted':
      return 'Mã giảm giá đã hết lượt'
    case 'customer_limit':
      return 'Bạn đã dùng mã giảm giá này'
    case 'below_minimum':
      return shortfall
        ? `Mua thêm ${formatVnd(shortfall)} sản phẩm áp dụng để dùng mã này`
        : 'Đơn chưa đạt giá trị tối thiểu của mã'
    case 'not_applicable':
      return 'Mã không áp dụng cho sản phẩm trong đơn'
    case 'sale_type':
      return 'Mã không áp dụng cho hình thức mua này'
    case 'changed':
      return 'Tiền giảm của mã đã thay đổi'
  }
}
