import { ErrorCode, type Voucher, type VoucherStatus } from '@ecommerce/shared'
import { ACTOR_SELECT } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'

/** Trạng thái hiển thị của mã; đã tắt thắng mọi thứ khác. */
export function voucherStatus(
  voucher: { disabledAt: Date | null; startsAt: Date; endsAt: Date },
  now = new Date(),
): VoucherStatus {
  if (voucher.disabledAt) return 'disabled'
  if (now < voucher.startsAt) return 'upcoming'
  if (now >= voucher.endsAt) return 'expired'
  return 'active'
}

/** Điều kiện Prisma theo trạng thái, cùng định nghĩa với `voucherStatus`. */
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
 * Số lượt đã dùng của từng mã (GLOSSARY "Lượt dùng"): số đơn chưa hủy có mã đó. Tính khi cần, không lưu bộ đếm; mã chưa
 * có đơn thì không có trong kết quả (tức là 0).
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
 * Số lượt một khách đã dùng một mã: đơn chưa hủy có email trùng (đơn lưu email chữ thường) **hoặc** số điện thoại trùng.
 * Thiếu cả hai thì không đếm được, trả 0; nơi gọi quyết định có cần kiểm hay không.
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

export const VOUCHER_INCLUDE = {
  createdBy: { select: ACTOR_SELECT },
  brands: { include: { brand: { select: { id: true, name: true } } } },
  categories: { include: { category: { select: { id: true, name: true } } } },
} satisfies Prisma.VoucherInclude

type VoucherRow = Prisma.VoucherGetPayload<{ include: typeof VOUCHER_INCLUDE }>

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

export function toVoucher(row: VoucherRow, used: number, now = new Date()): Voucher {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    kind: row.kind,
    amount: row.amount === null ? null : Number(row.amount),
    percent: row.percent,
    maxDiscount: row.maxDiscount === null ? null : Number(row.maxDiscount),
    minSubtotal: Number(row.minSubtotal),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    saleTypes: [...row.saleTypes].sort(),
    totalLimit: row.totalLimit,
    perCustomerLimit: row.perCustomerLimit,
    brands: row.brands.map((b) => b.brand).sort(byName),
    categories: row.categories.map((c) => c.category).sort(byName),
    status: voucherStatus(row, now),
    used,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  }
}

export const voucherNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy mã giảm giá')

export async function loadVoucher(db: DbClient, id: string): Promise<Voucher> {
  const row = await db.voucher.findUnique({ where: { id }, include: VOUCHER_INCLUDE })
  if (!row) throw voucherNotFound()
  return toVoucher(row, (await usedRedemptions(db, [id])).get(id) ?? 0)
}
