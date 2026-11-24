import type { CommitmentKind } from '@ecommerce/shared'

/** Commitment type names in admin. */
export const COMMITMENT_KIND_LABELS: Record<CommitmentKind, string> = {
  warranty: 'Bảo hành',
  other: 'Khác',
}

/** The label customers see next to a commitment; every commitment has documents, so "other" reads as verified. */
export const COMMITMENT_KIND_BADGES: Record<CommitmentKind, string> = {
  warranty: 'Bảo hành',
  other: 'Đã xác minh',
}
