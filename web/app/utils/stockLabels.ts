import type { StockAdjustmentReason, StockMovementKind } from '@ecommerce/shared'

export const STOCK_REASON_LABELS: Record<StockAdjustmentReason, string> = {
  stocktake: 'Kiểm kê',
  damaged: 'Hàng hỏng',
  lost: 'Mất hàng',
  other: 'Khác',
}

/** Ngày dạng `YYYY-MM-DD` (như ngày hàng về của phiếu nhập) thành ngày tiếng Việt, theo giờ của trình duyệt. */
export const formatDateOnly = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN')

export const STOCK_KIND_LABELS: Record<StockMovementKind, string> = {
  receipt: 'Nhập kho',
  adjustment: 'Điều chỉnh',
  opening: 'Tồn đầu kỳ',
}
