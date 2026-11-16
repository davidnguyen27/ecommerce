import type { OrderKind, Voucher, VoucherStatus } from '@ecommerce/shared'

export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  upcoming: 'Sắp tới',
  active: 'Đang chạy',
  expired: 'Hết hạn',
  disabled: 'Đã tắt',
}

export const VOUCHER_STATUS_BADGES: Record<VoucherStatus, string> = {
  upcoming: 'badge-draft',
  active: 'badge-published',
  expired: 'badge-archived',
  disabled: 'badge-archived',
}

export const SALE_TYPE_LABELS: Record<OrderKind, string> = {
  standard: 'Hàng sẵn',
  preorder: 'Đặt trước',
}

/** Mức giảm một dòng, ví dụ `10%, tối đa 500.000 ₫` hoặc `200.000 ₫`. */
export function voucherValueLabel(voucher: Pick<Voucher, 'kind' | 'amount' | 'percent' | 'maxDiscount'>) {
  return voucher.kind === 'fixed'
    ? formatVnd(voucher.amount ?? 0)
    : `${voucher.percent}%, tối đa ${formatVnd(voucher.maxDiscount ?? 0)}`
}
