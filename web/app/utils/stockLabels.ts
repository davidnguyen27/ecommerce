import type { StockAdjustmentReason, StockMovementKind } from '@ecommerce/shared'

export const STOCK_REASON_LABELS: Record<StockAdjustmentReason, string> = {
  stocktake: 'Kiểm kê',
  damaged: 'Hàng hỏng',
  lost: 'Mất hàng',
  other: 'Khác',
}

export const STOCK_KIND_LABELS: Record<StockMovementKind, string> = {
  receipt: 'Nhập kho',
  adjustment: 'Điều chỉnh',
  opening: 'Tồn đầu kỳ',
  sale: 'Xuất bán',
}
