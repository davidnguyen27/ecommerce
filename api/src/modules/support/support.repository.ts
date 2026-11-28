import type { DbClient } from '../../core/db.ts'
import { pageWindow } from '../../core/pagination.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { SUPPORT_INCLUDE } from './support-request.ts'

/**
 * Support request reads for the admin and customer screens. Writes under the request lock live in `support-*.ts`.
 * Every method takes `db`.
 */
export class SupportRepository {
  async adminPage(db: DbClient, where: Prisma.SupportRequestWhereInput, window: { page: number; pageSize: number }) {
    const [requests, total] = await Promise.all([
      db.supportRequest.findMany({
        where,
        include: SUPPORT_INCLUDE,
        // Oldest first: the customer waiting longest is served first.
        orderBy: [{ createdAt: 'asc' }, { code: 'asc' }],
        ...pageWindow(window),
      }),
      db.supportRequest.count({ where }),
    ])
    return { requests, total }
  }

  /** A viewer's requests (account, order link or contact token), newest first, capped at 100. */
  customerList(db: DbClient, where: Prisma.SupportRequestWhereInput) {
    return db.supportRequest.findMany({
      where,
      include: SUPPORT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { code: 'desc' }],
      take: 100,
    })
  }

  findByCode(db: DbClient, code: number) {
    return db.supportRequest.findUnique({ where: { code }, include: SUPPORT_INCLUDE })
  }

  findFirst(db: DbClient, where: Prisma.SupportRequestWhereInput) {
    return db.supportRequest.findFirst({ where, include: SUPPORT_INCLUDE })
  }

  findIdByCode(db: DbClient, code: number) {
    return db.supportRequest.findUnique({ where: { code }, select: { id: true } })
  }

  /** The chatbot conversation the request came from (M8), with its messages in order. */
  chatConversation(db: DbClient, requestId: string) {
    return db.chatConversation.findUnique({
      where: { supportRequestId: requestId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
  }

  orderIdByCode(db: DbClient, code: number) {
    return db.order.findUnique({ where: { code }, select: { id: true } })
  }

  /** The order fields a new request copies (contact, account). */
  orderForRequest(db: DbClient, code: number) {
    return db.order.findUnique({
      where: { code },
      select: { id: true, code: true, email: true, recipientName: true, customerId: true },
    })
  }
}
