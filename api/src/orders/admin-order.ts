import {
  type AdminOrder,
  type AdminOrderPage,
  type AdminOrderQuery,
  type OrderHistoryActor,
  type OrderHistoryEntry,
} from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { ACTOR_SELECT } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { pageWindow } from '../http/pagination.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import { refundedViaGateway, summarizeRefunds } from '../payments/refunds.ts'
import { ORDER_VIEW_INCLUDE, orderNotFound, parseOrderCode, toPublicOrder } from './orders.ts'

/** Search box: exact order code, phone (accepts `+84`, spaces, dots, dashes) or email containing the text. */
function searchWhere(q: string): Prisma.OrderWhereInput {
  const or: Prisma.OrderWhereInput[] = [{ email: { contains: q.toLowerCase() } }]
  const digits = q.replace(/[\s.-]/g, '').replace(/^\+?84(?=\d{9}$)/, '0')
  if (/^\d+$/.test(digits)) or.push({ phone: { contains: digits } })
  if (/^\d{1,9}$/.test(q)) or.push({ code: Number(q) })
  return { OR: or }
}

/** Admin order list: filters, search and paging of the orders page, newest first unless `sort=oldest`. */
export async function listAdminOrders(db: DbClient, query: AdminOrderQuery): Promise<AdminOrderPage> {
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
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      include: { lines: { select: { quantity: true } } },
      // Order codes grow with order time, so sorting by code sorts by time and stays stable.
      orderBy: { code: direction },
      ...pageWindow(query),
    }),
    db.order.count({ where }),
  ])
  return {
    items: orders.map((order) => ({
      code: order.code,
      kind: order.kind,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      createdAt: order.createdAt.toISOString(),
      total: Number(order.total),
      itemCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
      recipientName: order.recipientName,
      phone: order.phone,
      email: order.email,
      provinceName: order.provinceName,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}

/**
 * Admin order detail by code (string from the URL). Order action routes (prepare, hand over, deliver…) return this
 * same shape after a change, so the detail page swaps in the response.
 */
export async function loadAdminOrder(
  db: DbClient,
  storage: Storage,
  payments: PaymentGateway,
  code: string,
): Promise<AdminOrder> {
  const order = await db.order.findUnique({
    where: { code: parseOrderCode(code) },
    include: {
      ...ORDER_VIEW_INCLUDE,
      paymentTransactions: {
        include: { reconciliationItem: { include: { resolvedBy: { select: ACTOR_SELECT } } } },
        orderBy: { createdAt: 'asc' },
      },
      events: {
        include: { staff: { select: ACTOR_SELECT }, customer: { select: { id: true, email: true } } },
        orderBy: { seq: 'asc' },
      },
      supportRequests: {
        select: { code: true, kind: true, status: true, subject: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { code: 'desc' }],
      },
      refunds: {
        include: {
          createdBy: { select: ACTOR_SELECT },
          executedBy: { select: ACTOR_SELECT },
          settledBy: { select: ACTOR_SELECT },
          retriedBy: { select: { id: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  })
  if (!order) throw orderNotFound()

  // ADR 0014: received comes from transactions, refunded and refunding from refunds; payment status is unchanged.
  const totals = summarizeRefunds(
    order.paymentTransactions.reduce((sum, t) => sum + t.amount, 0n),
    order.refunds,
  )
  const viaGateway = refundedViaGateway(order.refunds)
  const gatewayRefundableOf = (t: (typeof order.paymentTransactions)[number]) =>
    payments.canRefund({ reference: t.reference, amount: Number(t.amount), source: t.source, payload: t.payload })
      ? Math.max(0, Number(t.amount - (viaGateway.get(t.id) ?? 0n)))
      : 0

  const eventActor = (event: (typeof order.events)[number]): OrderHistoryActor => {
    if (event.actor === 'staff') return { type: 'staff', ...event.staff! }
    if (event.actor === 'customer')
      return { type: 'customer', id: event.customer?.id ?? null, email: event.customer?.email ?? null }
    return { type: 'system' }
  }
  // Order events only: every staff action records an event with its actor; its audit is in the audit log.
  const history: OrderHistoryEntry[] = order.events.map((event) => ({
    action: event.kind,
    actor: eventActor(event),
    data: event.data,
    at: event.createdAt.toISOString(),
  }))

  const view = toPublicOrder(storage, order)
  return {
    ...view,
    lines: view.lines.map((line, i) => ({
      ...line,
      returnedQuantity: order.lines[i]!.returnedQuantity,
      writtenOffQuantity: order.lines[i]!.writtenOffQuantity,
    })),
    customerId: order.customerId,
    cancelNote: order.cancelNote,
    voucher:
      order.voucherId === null
        ? null
        : {
            id: order.voucherId,
            code: order.voucherCode!,
            kind: order.voucherKind!,
            amount: order.voucherAmount === null ? null : Number(order.voucherAmount),
            percent: order.voucherPercent,
            maxDiscount: order.voucherMaxDiscount === null ? null : Number(order.voucherMaxDiscount),
          },
    subtotalAfterDiscount: Number(order.subtotal - order.discount),
    payments: order.paymentTransactions.map((t) => ({
      id: t.id,
      purpose: t.purpose,
      amount: Number(t.amount),
      reference: t.reference,
      paidAt: t.paidAt.toISOString(),
      source: t.source,
      reconciliation: t.reconciliationItem && {
        id: t.reconciliationItem.id,
        reason: t.reconciliationItem.reason,
        status: t.reconciliationItem.status,
        resolution: t.reconciliationItem.resolution,
        note: t.reconciliationItem.note,
        resolvedBy: t.reconciliationItem.resolvedBy,
        resolvedAt: t.reconciliationItem.resolvedAt?.toISOString() ?? null,
      },
      gatewayRefundable: gatewayRefundableOf(t),
    })),
    refunded: Number(totals.refunded),
    refunding: Number(totals.refunding),
    refundable: Number(totals.refundable),
    gatewayRefundable: order.paymentTransactions.reduce((sum, t) => sum + gatewayRefundableOf(t), 0),
    refunds: order.refunds.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      origin: r.origin,
      status: r.status,
      method: r.method,
      reconciliationItemId: r.reconciliationItemId,
      retryOfId: r.retryOfId,
      retriedById: r.retriedBy?.id ?? null,
      paymentTransactionId: r.paymentTransactionId,
      bankReference: r.bankReference,
      transferredOn: r.transferredOn?.toISOString().slice(0, 10) ?? null,
      note: r.note,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      executedBy: r.executedBy,
      executedAt: r.executedAt?.toISOString() ?? null,
      settledBy: r.settledBy,
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    supportRequests: order.supportRequests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    history,
  }
}
