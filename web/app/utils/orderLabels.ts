import type {
  FulfillmentStatus,
  OrderCancelReason,
  OrderStatus,
  PaymentPurpose,
  PaymentSource,
  PaymentStatus,
  ReconciliationReason,
  ReconciliationResolution,
  RefundOrigin,
  RefundStatus,
} from '@ecommerce/shared'

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Chờ thanh toán',
  processing: 'Đang xử lý',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Chưa thanh toán',
  // Đã cọc không có nghĩa là đã trả đủ (GLOSSARY "Tiền cọc").
  deposit_paid: 'Đã cọc',
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
  deposit_paid: 'Đã nhận tiền cọc',
  stock_allocated: 'Giữ hàng nhập về cho đơn',
  arrived: 'Hàng đã về đủ',
  remainder_reminded: 'Nhắc trả phần còn lại',
  remainder_overdue: 'Quá hạn trả phần còn lại',
  delivery_changed: 'Đổi thời gian giao dự kiến',
  payment_flagged: 'Khoản tiền cần đối soát',
  cancelled: 'Hủy đơn',
  restored: 'Khôi phục đơn sau đối soát',
  reconciliation_resolved: 'Đóng mục cần đối soát',
  refund_created: 'Tạo khoản hoàn tiền',
  refund_succeeded: 'Đã hoàn tiền',
  refund_failed: 'Hoàn tiền thất bại',
  preparing: 'Bắt đầu chuẩn bị',
  handed_over: 'Bàn giao vận chuyển',
  delivered: 'Đã giao',
  delivery_failed: 'Giao thất bại',
}
export const orderEventLabel = (kind: string) => ORDER_EVENT_LABELS[kind] ?? kind

export const PAYMENT_PURPOSE_LABELS: Record<PaymentPurpose, string> = {
  full: 'Trả đủ',
  deposit: 'Tiền cọc',
  remainder: 'Phần còn lại',
}

export const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  webhook: 'Webhook cổng',
  query: 'Truy vấn cổng',
  simulator: 'Cổng giả lập',
  return: 'Trang quay về',
}

export const RECONCILIATION_RESOLUTION_LABELS: Record<ReconciliationResolution, string> = {
  restored: 'Đã khôi phục đơn',
  handled_externally: 'Đã xử lý ngoài hệ thống',
  settled_by_payment: 'Đã đủ tiền nhờ khoản sau',
  refunded: 'Đã tạo khoản hoàn tiền',
}

export const RECONCILIATION_REASON_LABELS: Record<ReconciliationReason, string> = {
  amount_mismatch: 'Lệch số tiền',
  paid_after_cancel: 'Tiền về sau khi hủy',
  extra_payment: 'Trả thừa',
}

/** Trạng thái một khoản hoàn (ADR 0014). */
export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: 'Chờ hoàn',
  processing: 'Cổng đang xử lý',
  succeeded: 'Đã hoàn',
  failed: 'Thất bại',
}

export const REFUND_ORIGIN_LABELS: Record<RefundOrigin, string> = {
  cancellation: 'Hủy đơn',
  reconciliation: 'Đối soát',
  retry: 'Tạo lại',
}
