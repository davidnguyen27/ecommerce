import type { DbClient } from '../../core/db.ts'
import { pageWindow } from '../../core/pagination.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { VOUCHER_INCLUDE } from './voucher.mapper.ts'

type Window = { page: number; pageSize: number }

/** Voucher reads for the admin screens; writes live in `voucher.admin.ts`. Every method takes `db`. */
export class VoucherRepository {
  async page(db: DbClient, where: Prisma.VoucherWhereInput, window: Window) {
    const [rows, total] = await Promise.all([
      db.voucher.findMany({
        where,
        include: VOUCHER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageWindow(window),
      }),
      db.voucher.count({ where }),
    ])
    return { rows, total }
  }

  findWithScope(db: DbClient, id: string) {
    return db.voucher.findUnique({ where: { id }, include: VOUCHER_INCLUDE })
  }

  async exists(db: DbClient, id: string) {
    return (await db.voucher.findUnique({ where: { id }, select: { id: true } })) !== null
  }

  /** Orders that used the voucher, cancelled ones too; newest first. */
  async orders(db: DbClient, voucherId: string, window: Window) {
    const where = { voucherId }
    const [orders, total] = await Promise.all([
      db.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { code: 'desc' }], ...pageWindow(window) }),
      db.order.count({ where }),
    ])
    return { orders, total }
  }
}
