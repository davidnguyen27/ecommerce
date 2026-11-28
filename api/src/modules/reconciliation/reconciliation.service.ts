import type { ReconciliationQuery } from '@ecommerce/shared'
import type { z } from 'zod'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import type { CustomerMail } from '../../core/jobs/queues.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { refundReconciliationItem, resolveExternally, restoreOrder } from './reconciliation-actions.ts'
import { toReconciliationItem } from './reconciliation.mapper.ts'
import type { ReconciliationRepository } from './reconciliation.repository.ts'

/** Money that needs accounting: list, restore the order, resolve by refund, close as handled outside. */
export class ReconciliationService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ReconciliationRepository,
    private readonly mail: CustomerMail,
  ) {}

  async list(query: z.output<typeof ReconciliationQuery>) {
    const where: Prisma.ReconciliationItemWhereInput = query.status === 'all' ? {} : { status: query.status }
    const { items, total } = await this.repo.page(this.prisma, where, query)
    const received = await this.repo.receivedByOrder(this.prisma, [...new Set(items.map((i) => i.orderId))])
    return { items: items.map((item) => toReconciliationItem(item, received.get(item.orderId) ?? 0)), total }
  }

  /** Each action returns the order code, for the caller to show the order. */
  restore(itemId: string, ctx: RequestContext) {
    return audited(this.prisma, ctx, (tx, audit) => restoreOrder(tx, this.mail, audit, itemId, ctx.staffId))
  }

  refund(itemId: string, ctx: RequestContext) {
    return audited(this.prisma, ctx, (tx, audit) => refundReconciliationItem(tx, audit, itemId, ctx.staffId))
  }

  resolve(itemId: string, note: string, ctx: RequestContext) {
    return audited(this.prisma, ctx, (tx, audit) => resolveExternally(tx, audit, itemId, ctx.staffId, note))
  }
}
