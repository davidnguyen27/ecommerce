import type { AdminOrder, AdminOrderPage, AdminOrderQuery, CancelPaidOrderRequest } from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { AppDeps } from '../../app.ts'
import type { Audit, AuditEntry } from '../../core/audit/audited.ts'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
// Ports to code not moved into modules yet: typed by the current functions, wired in order.module.ts.
import type { recordGatewayPayments } from '../payment/index.ts'
import type { createRefund, refundTotals, refundedViaGateway, summarizeRefunds } from '../refund/index.ts'
import type { IPreorderApi } from '../preorder-campaign/index.ts'
import type { resolveCancelRequests } from '../../support/support.ts'
import type { IStockLedger } from '../stock/index.ts'
import type { OrderForView } from './order.constant.ts'

/**
 * Order history event kinds: `paid` when fully paid, `payment_flagged` when a payment needs reconciliation, `cancelled`
 * when an unpaid order is cancelled (`data.reason` is `OrderCancelReason`, expiry included), `preparing` when packing
 * starts, `handed_over` at handover (`data` has `carrier`, `trackingNumber`), `delivered` when delivered (order
 * complete), `delivery_failed` when delivery fails (still processing).
 */
export type OrderEventKind =
  | 'created'
  | 'paid'
  /** A pre-order received its full deposit (M4). */
  | 'deposit_paid'
  /** A receipt reserved part of the arrived stock for a pre-order (`data`: variant, quantity, receipt; ADR 0013). */
  | 'stock_allocated'
  /** A pre-order is fully reserved: the remaining-balance deadline starts. */
  | 'arrived'
  /** Remaining-balance reminder email sent (ticket 08). */
  | 'remainder_reminded'
  /** Remaining balance overdue: flagged, not cancelled (`data.remainderDueAt`). */
  | 'remainder_overdue'
  /**
   * Staff changed the campaign's expected delivery and the customer was told (`data.before`, `data.after`; ticket 09).
   */
  | 'delivery_changed'
  | 'payment_flagged'
  | 'cancelled'
  | 'preparing'
  | 'handed_over'
  /** Accounting restored a cancelled order once the money arrived in full (reconciliation). */
  | 'restored'
  /**
   * Accounting closed a reconciliation item: handled outside the system, or by refund (`data.resolution = refunded`).
   */
  | 'reconciliation_resolved'
  /** A refund was created, awaiting accounting (`data`: `refundId`, `amount`, `origin`; ADR 0014). */
  | 'refund_created'
  /** A refund completed: manually, gateway success, or settled by accounting. */
  | 'refund_succeeded'
  /** A refund failed; it can be recreated. */
  | 'refund_failed'
  | 'delivered'
  | 'delivery_failed'
  /** A failed delivery was redelivered with a new tracking number (`data.previous`: the old one; M6a). */
  | 'redelivered'
  /** The warehouse received returned goods: per line restocked or written off (`data.lines`). */
  | 'returned_to_stock'
  /** Redelivery from stock: reserved again for the order, back to not prepared. */
  | 'restocked_for_redelivery'
  /** Cancelling the order closed the customer's cancel requests (`data.requestCodes`; M6b). */
  | 'support_resolved'

/** Who acted: staff, customer (with id when signed in) or the system. */
export type OrderEventActor =
  { type: 'staff'; staffId: string } | { type: 'customer'; customerId?: string } | { type: 'system' }

/**
 * Who cancels and why. Expiry from a job carries `overdueAt`: cancel only if the reservation had expired by then; the
 * "Giả lập hết hạn" button leaves it empty to cancel at once.
 */
export type Cancellation =
  | { reason: 'expired'; overdueAt?: Date }
  | { reason: 'customer'; customerId?: string }
  | { reason: 'staff'; staffId: string }

/**
 * `cancelled`: just cancelled. `already_cancelled`: cancelled before, nothing changed. `not_pending`: already paid (not
 * cancellable here). `not_due`: reservation not expired yet (only with `overdueAt`).
 */
export type CancelOutcome = 'cancelled' | 'already_cancelled' | 'not_pending' | 'not_due'

/** Audit entry of one fulfillment transition; the transition knows its source and target, so it declares them. */
export type FulfillmentAudit = Pick<AuditEntry, 'action' | 'before' | 'after'>

/** What the module needs from code not moved into modules yet (stock, payments, refunds, pre-orders, support). */
export type OrderPorts = {
  stock: Pick<IStockLedger, 'release' | 'change' | 'reserve'>
  gatewayPayments: { record: typeof recordGatewayPayments }
  refunds: {
    totals: typeof refundTotals
    create: typeof createRefund
    summarize: typeof summarizeRefunds
    viaGateway: typeof refundedViaGateway
  }
  arrivals: { plan: IPreorderApi['planArrivals']; apply: IPreorderApi['applyArrivals'] }
  support: { resolveCancelRequests: typeof resolveCancelRequests }
  remainder: { createLink: IPreorderApi['createRemainderLink'] }
}

/** Dependencies of the order commands: DB, gateway, mail queue, website URL, logger for after-commit errors. */
export type OrderDeps = Pick<AppDeps, 'prisma' | 'payments' | 'emails' | 'siteUrl'> & { logger: Logger }

/** Dependencies of the order views. */
export type OrderQueryDeps = Pick<AppDeps, 'prisma' | 'storage' | 'payments'>

/** Order commands other code may call (expiry jobs, gateway callbacks, pre-order campaigns). */
export interface IOrderService {
  /**
   * Cancels an unpaid order: expiry, customer, or staff without audit. Payment links are cancelled after commit; `log`
   * gets errors from that step (the request's logger when there is one).
   */
  cancel(orderId: string, cancellation: Cancellation, log?: Logger): Promise<CancelOutcome>
  /**
   * Cancels an order whose reservation expired (timed job, sweep job, simulate button). With `overdueAt`, only if
   * expired by then. Asks the gateway once first (ADR 0009).
   */
  expire(orderId: string, overdueAt?: Date): Promise<CancelOutcome>
  /** Sweep job: cancels every pending order overdue by `now`; returns how many. */
  expireOverdue(now?: Date): Promise<number>
  /** Staff cancel of a paid order in the caller's audited transaction; returns the order code. */
  cancelPaidInTransaction(
    tx: Prisma.TransactionClient,
    audit: Audit,
    orderId: string,
    staffId: string,
    input: CancelPaidOrderRequest,
    options?: { reallocate?: boolean },
  ): Promise<number>
}

/** Order views other code may read. */
export interface IOrderQuery {
  /** By code and lookup token; any mismatch is the same 404. */
  findByToken(db: DbClient, code: string, token: string | undefined): Promise<OrderForView>
  /** By code for the signed-in customer; someone else's order is 404. */
  findCustomerOrder(db: DbClient, code: string, customerId: string): Promise<OrderForView>
  /** Admin detail by code (string from the URL). */
  loadAdminOrder(code: string): Promise<AdminOrder>
  listAdminOrders(query: AdminOrderQuery): Promise<AdminOrderPage>
}
