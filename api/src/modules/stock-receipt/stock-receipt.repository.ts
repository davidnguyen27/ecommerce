import { ACTOR_SELECT } from '../../core/audit/audited.ts'
import type { DbClient } from '../../core/db.ts'
import { pageWindow } from '../../core/pagination.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

export const RECEIPT_DETAIL_INCLUDE = {
  createdBy: { select: ACTOR_SELECT },
  movements: {
    include: { variant: { select: { id: true, sku: true, product: { select: { name: true } } } } },
    orderBy: { seq: 'asc' },
  },
} as const satisfies Prisma.StockReceiptInclude

const RECEIPT_LIST_INCLUDE = {
  createdBy: { select: ACTOR_SELECT },
  movements: { select: { quantity: true } },
} as const satisfies Prisma.StockReceiptInclude

export type ReceiptDetailRow = Prisma.StockReceiptGetPayload<{ include: typeof RECEIPT_DETAIL_INCLUDE }>
export type ReceiptListRow = Prisma.StockReceiptGetPayload<{ include: typeof RECEIPT_LIST_INCLUDE }>

/** Stock receipts (header rows; their lines are `receipt` stock movements). Every method takes `db`. */
export class StockReceiptRepository {
  async page(db: DbClient, window: { page: number; pageSize: number }) {
    const [receipts, total] = await Promise.all([
      db.stockReceipt.findMany({ include: RECEIPT_LIST_INCLUDE, orderBy: { seq: 'desc' }, ...pageWindow(window) }),
      db.stockReceipt.count(),
    ])
    return { receipts, total }
  }

  find(db: DbClient, id: string) {
    return db.stockReceipt.findUnique({ where: { id }, include: RECEIPT_DETAIL_INCLUDE })
  }

  create(tx: Prisma.TransactionClient, data: Prisma.StockReceiptUncheckedCreateInput) {
    return tx.stockReceipt.create({ data })
  }

  variantIdsBySku(db: DbClient, skus: string[]) {
    return db.productVariant.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } })
  }
}
