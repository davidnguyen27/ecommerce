import type {
  OrderCancelCause,
  OrderCancelReason,
  ProductType,
  RefundStatus,
  ReportRefundOrigin,
  ReturnKind,
  SupportReturnReason,
  VoucherKind,
  WarrantyReportOutcome,
} from '@ecommerce/shared'

// Nhãn tiếng Việt cho file Excel báo cáo; giữ khớp với nhãn trang quản trị ở `web/app/utils/*Labels.ts`.

export const PRODUCT_TYPE: Record<ProductType, string> = {
  footwear: 'Giày dép',
  apparel: 'Quần áo',
  watch: 'Đồng hồ',
  bag: 'Túi xách',
  fragrance: 'Nước hoa',
}

export const CANCEL_REASON: Record<OrderCancelReason, string> = {
  expired: 'Hết hạn giữ hàng',
  customer: 'Khách tự hủy',
  staff: 'Nhân viên hủy',
}

export const CANCEL_CAUSE: Record<OrderCancelCause, string> = {
  changed_mind: 'Khách đổi ý',
  remainder_overdue: 'Quá hạn trả phần còn lại',
  supply_failed: 'Không nhập được hàng',
  delivery_failed: 'Giao thất bại',
  other: 'Khác',
}

export const REFUND_STATUS: Record<RefundStatus, string> = {
  pending: 'Chờ hoàn',
  processing: 'Cổng đang xử lý',
  succeeded: 'Đã hoàn',
  failed: 'Thất bại',
}

export const REFUND_ORIGIN: Record<ReportRefundOrigin, string> = {
  cancellation: 'Hủy đơn',
  reconciliation: 'Đối soát',
  return: 'Trả hàng',
}

export const RETURN_KIND: Record<ReturnKind, string> = { return: 'Trả hàng', exchange: 'Đổi hàng' }

export const RETURN_REASON: Record<SupportReturnReason, string> = {
  defective: 'Hàng lỗi',
  wrong_fit: 'Không vừa',
  not_as_described: 'Không đúng mô tả',
  other: 'Lý do khác',
}

export const WARRANTY_OUTCOME: Record<WarrantyReportOutcome, string> = {
  repaired: 'Đã sửa xong',
  replaced: 'Đổi sản phẩm mới',
  rejected: 'Không bảo hành',
  refunded: 'Hoàn tiền',
  declined: 'Từ chối tiếp nhận',
  in_progress: 'Đang xử lý',
}

export const VOUCHER_KIND: Record<VoucherKind, string> = { fixed: 'Số tiền cố định', percent: 'Theo tỷ lệ' }
