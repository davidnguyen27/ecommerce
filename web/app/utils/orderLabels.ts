import type { FulfillmentStatus, OrderStatus, PaymentStatus } from '@ecommerce/shared'

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
