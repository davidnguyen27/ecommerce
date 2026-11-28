import { ACTOR_SELECT } from '../../core/audit/audited.ts'
import type { DbClient } from '../../core/db.ts'
import { pageWindow } from '../../core/pagination.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

const ITEM_INCLUDE = {
  transaction: { select: { reference: true, source: true } },
  resolvedBy: { select: ACTOR_SELECT },
  order: { select: { id: true, code: true, status: true, paymentStatus: true, total: true, recipientName: true } },
} as const satisfies Prisma.ReconciliationItemInclude

export type ReconciliationRow = Prisma.ReconciliationItemGetPayload<{ include: typeof ITEM_INCLUDE }>

/** Reconciliation items for the accounting screen. Every method takes `db`. */
export class ReconciliationRepository {
  async page(db: DbClient, where: Prisma.ReconciliationItemWhereInput, window: { page: number; pageSize: number }) {
    const [items, total] = await Promise.all([
      db.reconciliationItem.findMany({
        where,
        include: ITEM_INCLUDE,
        // Oldest first: the longest-waiting money is handled first.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...pageWindow(window),
      }),
      db.reconciliationItem.count({ where }),
    ])
    return { items, total }
  }

  /** Money received per order (all payment transactions). */
  async receivedByOrder(db: DbClient, orderIds: string[]) {
    const sums = await db.paymentTransaction.groupBy({
      by: ['orderId'],
      where: { orderId: { in: orderIds } },
      _sum: { amount: true },
    })
    return new Map(sums.map((s) => [s.orderId, Number(s._sum.amount ?? 0n)]))
  }
}
