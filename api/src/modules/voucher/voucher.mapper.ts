import type { Voucher, VoucherOrderPage } from '@ecommerce/shared'
import { ACTOR_SELECT } from '../../core/audit/audited.ts'
import type { Order, Prisma } from '../../generated/prisma/client.ts'
import { voucherStatus } from './voucher.query.ts'

export const VOUCHER_INCLUDE = {
  createdBy: { select: ACTOR_SELECT },
  brands: { include: { brand: { select: { id: true, name: true } } } },
  categories: { include: { category: { select: { id: true, name: true } } } },
} satisfies Prisma.VoucherInclude

export type VoucherRow = Prisma.VoucherGetPayload<{ include: typeof VOUCHER_INCLUDE }>

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

/** An order that used the voucher; cancelled ones are listed but take no use. */
export function toVoucherOrder(o: Order): VoucherOrderPage['items'][number] {
  return {
    code: o.code,
    kind: o.kind,
    recipientName: o.recipientName,
    email: o.email,
    status: o.status,
    paymentStatus: o.paymentStatus,
    discount: Number(o.discount),
    total: Number(o.total),
    createdAt: o.createdAt.toISOString(),
    counted: o.status !== 'cancelled',
  }
}
