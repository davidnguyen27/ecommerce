import type { CommitmentKind } from '@ecommerce/shared'

/** Tên loại cam kết trong trang quản trị. */
export const COMMITMENT_KIND_LABELS: Record<CommitmentKind, string> = {
  warranty: 'Bảo hành',
  other: 'Khác',
}

/** Nhãn khách thấy cạnh cam kết trên trang sản phẩm; mọi cam kết đều đã có chứng từ nên loại "khác" ghi là đã xác minh. */
export const COMMITMENT_KIND_BADGES: Record<CommitmentKind, string> = {
  warranty: 'Bảo hành',
  other: 'Đã xác minh',
}
