import type { SupportRequestKind, SupportRequestStatus, SupportReturnReason, WarrantyOutcome } from '@ecommerce/shared'

export const SUPPORT_KIND_LABELS: Record<SupportRequestKind, string> = {
  cancel: 'Hủy đơn',
  return: 'Trả hàng',
  exchange: 'Đổi hàng',
  warranty: 'Bảo hành',
  other: 'Khác',
}

/** Status as staff see it. */
export const SUPPORT_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  new: 'Mới',
  in_progress: 'Đang xử lý',
  waiting_customer: 'Chờ khách',
  resolved: 'Đã xong',
  rejected: 'Từ chối',
}

/** Status as customers see it: "chờ khách" says the shop is waiting for your reply. */
export const SUPPORT_STATUS_CUSTOMER_LABELS: Record<SupportRequestStatus, string> = {
  new: 'Đã gửi',
  in_progress: 'Đang xử lý',
  waiting_customer: 'Chờ bạn trả lời',
  resolved: 'Đã xong',
  rejected: 'Đã đóng',
}

export const isSupportClosed = (status: SupportRequestStatus) => status === 'resolved' || status === 'rejected'

/** Warranty outcome (spec M6b ticket 06). */
export const WARRANTY_OUTCOME_LABELS: Record<WarrantyOutcome, string> = {
  repaired: 'Đã sửa xong',
  replaced: 'Đổi sản phẩm mới',
  rejected: 'Không bảo hành',
  refunded: 'Hoàn tiền',
}

export const RETURN_REASON_LABELS: Record<SupportReturnReason, string> = {
  defective: 'Hàng lỗi',
  wrong_fit: 'Không vừa',
  not_as_described: 'Không đúng mô tả',
  other: 'Lý do khác',
}
