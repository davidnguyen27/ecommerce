import type {
  FulfillmentStatus,
  OrderCancelReason,
  OrderStatus,
  PaymentSource,
  PaymentStatus,
  ReconciliationReason,
} from '@ecommerce/shared'

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Chờ thanh toán',
  processing: 'Đang xử lý',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Chưa thanh toán',
  paid: 'Đã thanh toán',
}

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  not_prepared: 'Chưa chuẩn bị',
  preparing: 'Đang chuẩn bị',
  handed_over: 'Đã bàn giao vận chuyển',
  delivered: 'Đã giao',
  failed: 'Giao thất bại',
}

/** Giá trị thuộc tính biến thể nối bằng " · ", không kèm đơn vị (dòng giỏ, dòng đơn không có schema thuộc tính). */
export const variantAttributesText = (attributes: Record<string, unknown> | null) =>
  attributes
    ? Object.values(attributes)
        .map((value) => (Array.isArray(value) ? value.join(', ') : String(value)))
        .join(' · ')
    : ''

export const CANCEL_REASON_LABELS: Record<OrderCancelReason, string> = {
  expired: 'Hết hạn giữ hàng',
  customer: 'Khách tự hủy',
  staff: 'Nhân viên hủy',
}

/** Sự kiện trong lịch sử đơn (`OrderEventKind` ở API). Loại chưa có ở đây thì hiện nguyên mã. */
const ORDER_EVENT_LABELS: Record<string, string> = {
  created: 'Đặt mua',
  paid: 'Đã nhận đủ tiền',
  payment_flagged: 'Khoản tiền cần đối soát',
  cancelled: 'Hủy đơn',
  preparing: 'Bắt đầu chuẩn bị',
  handed_over: 'Bàn giao vận chuyển',
}
export const orderEventLabel = (kind: string) => ORDER_EVENT_LABELS[kind] ?? kind

export const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  webhook: 'Webhook cổng',
  query: 'Truy vấn cổng',
  simulator: 'Cổng giả lập',
}

export const RECONCILIATION_REASON_LABELS: Record<ReconciliationReason, string> = {
  amount_mismatch: 'Lệch số tiền',
  paid_after_cancel: 'Tiền về sau khi hủy',
  extra_payment: 'Trả thừa',
}
