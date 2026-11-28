import { ErrorCode, type VoucherStatus } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { AppError } from '../../core/errors.ts'

/** A voucher's display status; disabled beats everything else. */
export function voucherStatus(
  voucher: { disabledAt: Date | null; startsAt: Date; endsAt: Date },
  now = new Date(),
): VoucherStatus {
  if (voucher.disabledAt) return 'disabled'
  if (now < voucher.startsAt) return 'upcoming'
  if (now >= voucher.endsAt) return 'expired'
  return 'active'
}

/** Prisma condition per status, matching `voucherStatus`. */
export function voucherStatusWhere(status: VoucherStatus, now = new Date()): Prisma.VoucherWhereInput {
  switch (status) {
    case 'disabled':
      return { disabledAt: { not: null } }
    case 'upcoming':
      return { disabledAt: null, startsAt: { gt: now } }
    case 'expired':
      return { disabledAt: null, endsAt: { lte: now } }
    case 'active':
      return { disabledAt: null, startsAt: { lte: now }, endsAt: { gt: now } }
  }
}

/**
 * Uses per voucher (GLOSSARY "Lượt dùng"): uncancelled orders with that voucher. Computed on demand, not stored;
 * vouchers without orders are absent (i.e. 0).
 */
export async function usedRedemptions(db: DbClient, voucherIds: readonly string[]) {
  const used = new Map<string, number>()
  if (voucherIds.length === 0) return used
  const rows = await db.order.groupBy({
    by: ['voucherId'],
    where: { voucherId: { in: [...voucherIds] }, status: { not: 'cancelled' } },
    _count: { _all: true },
  })
  for (const row of rows) used.set(row.voucherId!, row._count._all)
  return used
}

/**
 * Uses of a voucher by one customer: uncancelled orders with the same email (stored lowercase) **or** the same phone.
 * With neither, nothing can be counted and it returns 0; the caller decides whether to check.
 */
export async function customerRedemptions(
  db: DbClient,
  voucherId: string,
  customer: { email?: string | null; phone?: string | null },
) {
  const or: Prisma.OrderWhereInput[] = []
  if (customer.email) or.push({ email: customer.email.toLowerCase() })
  if (customer.phone) or.push({ phone: customer.phone })
  if (or.length === 0) return 0
  return db.order.count({ where: { voucherId, status: { not: 'cancelled' }, OR: or } })
}

export const voucherNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy mã giảm giá')
