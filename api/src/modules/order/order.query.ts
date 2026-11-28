import type {
  AccountOrderPage,
  AccountOrderQuery,
  AdminOrder,
  AdminOrderPage,
  AdminOrderQuery,
} from '@ecommerce/shared'
import { hashOpaqueToken } from '../../core/auth/opaque-token.ts'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { orderNotFound, parseOrderCode, type OrderForView } from './order.constant.ts'
import type { IOrderQuery, OrderPorts, OrderQueryDeps } from './order.interface.ts'
import { toAccountOrderSummary, toAdminOrder, toAdminOrderSummary } from './order.mapper.ts'
import type { OrderRepository } from './order.repository.ts'

/** Search box: exact order code, phone (accepts `+84`, spaces, dots, dashes) or email containing the text. */
function searchWhere(q: string): Prisma.OrderWhereInput {
  const or: Prisma.OrderWhereInput[] = [{ email: { contains: q.toLowerCase() } }]
  const digits = q.replace(/[\s.-]/g, '').replace(/^\+?84(?=\d{9}$)/, '0')
  if (/^\d+$/.test(digits)) or.push({ phone: { contains: digits } })
  if (/^\d{1,9}$/.test(q)) or.push({ code: Number(q) })
  return { OR: or }
}

/** Order views: customer lookups, the signed-in customer's list, the admin list and detail. */
export class OrderQuery implements IOrderQuery {
  constructor(
    private readonly deps: OrderQueryDeps,
    private readonly repo: OrderRepository,
    private readonly refunds: Pick<OrderPorts['refunds'], 'summarize' | 'viaGateway'>,
  ) {}

  /**
   * Order by code and lookup token. Unknown code, missing or wrong token are all the same 404, so no order's existence
   * leaks. `code` is the URL string.
   */
  async findByToken(db: DbClient, code: string, token: string | undefined): Promise<OrderForView> {
    if (!token) throw orderNotFound()
    const order = await this.repo.findByToken(db, parseOrderCode(code), hashOpaqueToken(token))
    if (!order) throw orderNotFound()
    return order
  }

  /**
   * Order by code for the signed-in customer. Someone else's order is also 404, like an unknown code, so nothing
   * leaks. `code` is the URL string.
   */
  async findCustomerOrder(db: DbClient, code: string, customerId: string): Promise<OrderForView> {
    const order = await this.repo.findCustomerOrder(db, parseOrderCode(code), customerId)
    if (!order) throw orderNotFound()
    return order
  }

  /** The signed-in customer's orders, newest first. */
  async listCustomerOrders(customerId: string, query: AccountOrderQuery): Promise<AccountOrderPage> {
    const { orders, total } = await this.repo.page(this.deps.prisma, { customerId }, 'desc', query)
    return { items: orders.map(toAccountOrderSummary), total, page: query.page, pageSize: query.pageSize }
  }

  /** Admin order list: filters, search and paging of the orders page, newest first unless `sort=oldest`. */
  async listAdminOrders(query: AdminOrderQuery): Promise<AdminOrderPage> {
    const where: Prisma.OrderWhereInput = {
      ...(query.status !== 'all' && { status: query.status }),
      ...(query.paymentStatus !== 'all' && { paymentStatus: query.paymentStatus }),
      ...(query.fulfillmentStatus !== 'all' && { fulfillmentStatus: query.fulfillmentStatus }),
      ...(query.kind !== 'all' && { kind: query.kind }),
      ...(query.campaignId && { preorderCampaignId: query.campaignId }),
      // Remaining balance overdue: the flag means not fully paid yet (paying clears it, ticket 08).
      ...(query.remainderOverdue !== undefined && {
        remainderOverdueAt: query.remainderOverdue ? { not: null } : null,
      }),
      ...(query.q && searchWhere(query.q)),
      ...(query.voucherCode && { voucherCode: query.voucherCode.toUpperCase() }),
      ...(query.refund === 'open' && { refunds: { some: { status: { in: ['pending', 'processing'] } } } }),
    }
    const direction = query.sort === 'oldest' ? 'asc' : 'desc'
    const { orders, total } = await this.repo.page(this.deps.prisma, where, direction, query)
    return { items: orders.map(toAdminOrderSummary), total, page: query.page, pageSize: query.pageSize }
  }

  /**
   * Admin order detail by code (string from the URL). Order action routes (prepare, hand over, deliver…) return this
   * same shape after a change, so the detail page swaps in the response.
   */
  async loadAdminOrder(code: string): Promise<AdminOrder> {
    const order = await this.repo.findAdminView(this.deps.prisma, parseOrderCode(code))
    if (!order) throw orderNotFound()
    return toAdminOrder(this.deps.storage, this.deps.payments, this.refunds, order)
  }
}
