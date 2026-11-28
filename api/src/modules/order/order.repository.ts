import type { FulfillmentStatus, OrderKind, OrderStatus, PaymentStatus } from '@ecommerce/shared'
import { ACTOR_SELECT } from '../../core/audit/audited.ts'
import { hashOpaqueToken, newOpaqueToken } from '../../core/auth/opaque-token.ts'
import type { DbClient } from '../../core/db.ts'
import { pageWindow } from '../../core/pagination.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
// Payment links are the payment module's table; it owns their select shape.
import { PAYMENT_LINK_REFERENCES } from '../payment/index.ts'
import { ORDER_VIEW_INCLUDE, orderLookupUrl, parseOrderCode } from './order.constant.ts'
import type { OrderEventActor, OrderEventKind } from './order.interface.ts'

/** The order row's state, read under its lock. */
export type LockedOrder = {
  status: OrderStatus
  paymentStatus: PaymentStatus
  fulfillmentStatus: FulfillmentStatus
  kind: OrderKind
  reservedUntil: Date | null
}

/** Appends an event to the order history. Call in the state change's transaction. */
export async function recordOrderEvent(
  db: DbClient,
  orderId: string,
  kind: OrderEventKind,
  actor: OrderEventActor,
  data: Prisma.InputJsonObject = {},
) {
  await db.orderEvent.create({
    data: {
      orderId,
      kind,
      actor: actor.type,
      staffId: actor.type === 'staff' ? actor.staffId : null,
      customerId: actor.type === 'customer' ? (actor.customerId ?? null) : null,
      data,
    },
  })
}

/** Issues another lookup token for the order (hash stored) and returns the link, for emails. */
export async function issueOrderLookupUrl(db: DbClient, siteUrl: string, order: { id: string; code: number }) {
  const token = newOpaqueToken()
  await db.orderLookupToken.create({ data: { orderId: order.id, tokenHash: hashOpaqueToken(token) } })
  return orderLookupUrl(siteUrl, order.code, token)
}

/** Admin order detail: the customer view plus payments, reconciliation, refunds, support requests and history. */
const ADMIN_ORDER_INCLUDE = {
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
} as const satisfies Prisma.OrderInclude

export type AdminOrderRow = Prisma.OrderGetPayload<{ include: typeof ADMIN_ORDER_INCLUDE }>

/**
 * Data access for orders, their lines, events and lookup tokens. Every method takes `db` (the caller's transaction
 * for writes); repositories never open transactions (ADR 0018).
 */
export class OrderRepository {
  /**
   * Locks the order row until the transaction ends (the same lock as payment, fulfillment, cancel and refunds) and
   * reads its state; check state only after this. `undefined` when there is no such order.
   */
  async lockState(tx: Prisma.TransactionClient, orderId: string): Promise<LockedOrder | undefined> {
    const [locked] = await tx.$queryRaw<LockedOrder[]>`
      SELECT "status"::text AS status, "payment_status"::text AS "paymentStatus",
        "fulfillment_status"::text AS "fulfillmentStatus", "kind"::text AS kind, "reserved_until" AS "reservedUntil"
      FROM "order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
    return locked
  }

  recordEvent = recordOrderEvent
  issueLookupUrl = issueOrderLookupUrl

  findIdByCode(db: DbClient, code: string) {
    return db.order.findUnique({ where: { code: parseOrderCode(code) }, select: { id: true } })
  }

  findByToken(db: DbClient, code: number, tokenHash: string) {
    return db.order.findFirst({
      where: { code, OR: [{ lookupTokenHash: tokenHash }, { lookupTokens: { some: { tokenHash } } }] },
      include: ORDER_VIEW_INCLUDE,
    })
  }

  findCustomerOrder(db: DbClient, code: number, customerId: string) {
    return db.order.findFirst({ where: { code, customerId }, include: ORDER_VIEW_INCLUDE })
  }

  findAdminView(db: DbClient, code: number) {
    return db.order.findUnique({ where: { code }, include: ADMIN_ORDER_INCLUDE })
  }

  /** A page of orders with line quantities, by code (codes grow with order time, so this sorts by time and is stable). */
  async page(
    db: DbClient,
    where: Prisma.OrderWhereInput,
    direction: 'asc' | 'desc',
    window: { page: number; pageSize: number },
  ) {
    const [orders, total] = await Promise.all([
      db.order.findMany({
        where,
        include: { lines: { select: { quantity: true } } },
        orderBy: { code: direction },
        ...pageWindow(window),
      }),
      db.order.count({ where }),
    ])
    return { orders, total }
  }

  findExpiryState(db: DbClient, orderId: string) {
    return db.order.findUnique({ where: { id: orderId }, select: { code: true, status: true, reservedUntil: true } })
  }

  async findOverdueIds(db: DbClient, now: Date) {
    const overdue = await db.order.findMany({
      where: { status: 'pending_payment', reservedUntil: { lte: now } },
      select: { id: true },
      orderBy: { reservedUntil: 'asc' },
    })
    return overdue.map((o) => o.id)
  }

  findPaymentLinks(db: DbClient, orderId: string) {
    return db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { code: true, paymentLinks: PAYMENT_LINK_REFERENCES },
    })
  }

  findShipment(db: DbClient, orderId: string) {
    return db.order.findUniqueOrThrow({ where: { id: orderId }, select: { carrier: true, trackingNumber: true } })
  }

  update(tx: Prisma.TransactionClient, orderId: string, data: Prisma.OrderUncheckedUpdateInput) {
    return tx.order.update({ where: { id: orderId }, data })
  }

  /** The order's lines in display order. */
  lines(db: DbClient, orderId: string) {
    return db.orderLine.findMany({ where: { orderId }, orderBy: { position: 'asc' } })
  }

  reservedLines(db: DbClient, orderId: string) {
    return db.orderLine.findMany({
      where: { orderId, reservedQuantity: { gt: 0 } },
      select: { variantId: true, reservedQuantity: true },
    })
  }

  async clearReservations(tx: Prisma.TransactionClient, orderId: string) {
    await tx.orderLine.updateMany({ where: { orderId }, data: { reservedQuantity: 0 } })
  }

  async updateLine(tx: Prisma.TransactionClient, lineId: string, data: Prisma.OrderLineUncheckedUpdateInput) {
    await tx.orderLine.update({ where: { id: lineId }, data })
  }
}
