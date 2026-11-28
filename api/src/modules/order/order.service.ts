import {
  ErrorCode,
  ORDER_CANCEL_CAUSE_CUSTOMER_TEXT,
  canCancelPaid,
  type CancelPaidOrderRequest,
  type FulfillmentStatus,
  type HandoverRequest,
  type OrderCancelCause,
  type RedeliverRequest,
  type ReturnToStockRequest,
} from '@ecommerce/shared'
import type { Logger } from 'pino'
import { audited, type Audit } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import { AppError, invalidField } from '../../core/errors.ts'
import { vnd } from '../../core/utils/format.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type {
  CancelOutcome,
  Cancellation,
  FulfillmentAudit,
  IOrderService,
  OrderDeps,
  OrderEventActor,
  OrderPorts,
} from './order.interface.ts'
import type { OrderRepository } from './order.repository.ts'

const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)

function actorOf(cancellation: Cancellation): OrderEventActor {
  switch (cancellation.reason) {
    case 'expired':
      return { type: 'system' }
    case 'customer':
      return { type: 'customer', customerId: cancellation.customerId }
    case 'staff':
      return { type: 'staff', staffId: cancellation.staffId }
  }
}

/** For HTTP callers: a paid order gives 409. */
export function assertCancellable(outcome: CancelOutcome) {
  if (outcome === 'not_pending') {
    // Paid or deposited orders need a refund on cancel: use `cancel-paid` (M6a), which needs `order.cancel_paid`.
    throw new AppError(409, ErrorCode.CONFLICT, 'Đơn đã thanh toán hoặc đã cọc, không hủy được')
  }
}

/**
 * Order commands: cancel (unpaid and paid), expiry, and the fulfillment transitions. Every state change locks the
 * order row first (the same lock as payment and refunds), then checks; staff changes are audited in that transaction.
 */
export class OrderService implements IOrderService {
  constructor(
    private readonly deps: OrderDeps,
    private readonly repo: OrderRepository,
    private readonly ports: OrderPorts,
  ) {}

  // ===== Cancel an unpaid order =====

  /**
   * Cancels an unpaid order in the caller's transaction: locks the order like `recordPayment`, so a concurrent payment
   * and cancel each see the other's result; releases the reservation and records an event. Rerunning on a cancelled
   * order changes nothing. Payment links are cancelled after commit.
   */
  private async cancelInTransaction(
    tx: Prisma.TransactionClient,
    orderId: string,
    cancellation: Cancellation,
  ): Promise<CancelOutcome> {
    const locked = await this.repo.lockState(tx, orderId)
    if (!locked) throw new Error(`Không có đơn ${orderId}`)
    if (locked.status === 'cancelled') return 'already_cancelled'
    if (locked.status !== 'pending_payment') return 'not_pending'
    if (
      cancellation.reason === 'expired' &&
      cancellation.overdueAt &&
      locked.reservedUntil &&
      locked.reservedUntil > cancellation.overdueAt
    ) {
      return 'not_due'
    }

    // A pending pre-order only holds allocation, not stock, so there is nothing to release; the allocation frees
    // itself (ADR 0013).
    await this.releaseReservations(tx, orderId)
    await this.repo.update(tx, orderId, {
      status: 'cancelled',
      cancelReason: cancellation.reason,
      cancelledAt: new Date(),
      reservedUntil: null,
    })
    await this.repo.recordEvent(tx, orderId, 'cancelled', actorOf(cancellation), { reason: cancellation.reason })
    return 'cancelled'
  }

  /** Releases each line's reserved quantity and sets it to 0. Call under the order lock. */
  private async releaseReservations(tx: Prisma.TransactionClient, orderId: string) {
    const lines = await this.repo.reservedLines(tx, orderId)
    if (lines.length === 0) return
    await this.ports.stock.release(
      tx,
      lines.map((l) => ({ variantId: l.variantId, quantity: l.reservedQuantity })),
    )
    await this.repo.clearReservations(tx, orderId)
  }

  /**
   * Cancels every payment link of a just-cancelled order; no links, no-op. Call after commit. Errors are logged and the
   * next link is tried: the order is cancelled, so later money needs reconciliation.
   */
  private async cancelPaymentLinks(orderId: string, log: Logger) {
    const order = await this.repo.findPaymentLinks(this.deps.prisma, orderId)
    for (const { gatewayReference } of order.paymentLinks) {
      try {
        await this.deps.payments.cancelLink(gatewayReference)
      } catch (err) {
        log.error({ err, orderCode: order.code, gatewayReference }, 'Không hủy được link thanh toán')
      }
    }
  }

  async cancel(orderId: string, cancellation: Cancellation, log: Logger = this.deps.logger) {
    const outcome = await this.deps.prisma.$transaction((tx) => this.cancelInTransaction(tx, orderId, cancellation))
    if (outcome === 'cancelled') await this.cancelPaymentLinks(orderId, log)
    return outcome
  }

  /**
   * Staff cancel of an unpaid order (the customer called): the same cancel as expiry and self-cancel, audited in the
   * same transaction only when something changed. A paid order gives 409; an already cancelled one changes nothing.
   */
  async cancelByStaff(orderId: string, ctx: RequestContext, log: Logger) {
    const outcome = await audited(this.deps.prisma, ctx, async (tx, audit) => {
      const result = await this.cancelInTransaction(tx, orderId, { reason: 'staff', staffId: ctx.staffId })
      if (result === 'cancelled') {
        await audit({
          action: 'order.cancel',
          entityType: 'order',
          entityId: orderId,
          before: { status: 'pending_payment' },
          after: { status: 'cancelled', cancelReason: 'staff' },
        })
      }
      return result
    })
    assertCancellable(outcome)
    if (outcome === 'cancelled') await this.cancelPaymentLinks(orderId, log)
    return outcome
  }

  async expire(orderId: string, overdueAt?: Date) {
    const order = await this.repo.findExpiryState(this.deps.prisma, orderId)
    const due =
      order?.status === 'pending_payment' && !(overdueAt && order.reservedUntil && order.reservedUntil > overdueAt)
    if (order && due) {
      // ADR 0009: merchant queries when no callback arrives. Paid: recorded and the order stays. Gateway error: logged,
      // cancelled anyway (later money needs reconciliation).
      try {
        await this.ports.gatewayPayments.record(this.deps, order)
      } catch (err) {
        this.deps.logger.error({ err, orderCode: order.code }, 'Không hỏi được cổng trước khi hủy đơn hết hạn')
      }
    }
    return this.cancel(orderId, { reason: 'expired', overdueAt })
  }

  async expireOverdue(now = new Date()) {
    let expired = 0
    for (const id of await this.repo.findOverdueIds(this.deps.prisma, now)) {
      if ((await this.expire(id, now)) === 'cancelled') expired++
    }
    return expired
  }

  // ===== Cancel a paid order (M6a) =====

  /**
   * Staff cancel of a paid order (GLOSSARY "Hủy đơn", spec M6a) in the caller's audited transaction: locks the order and
   * checks it is processing, paid or deposited, and not handed over. Releases reservations, sets `cancelled` (reason
   * `staff` with `cancel_cause`), creates a pending refund when the amount is > 0, records the event and audit, and
   * queues the "Đơn đã hủy" email. Refund: 0 up to the refundable amount; less needs a note; supply failure needs a
   * full refund. Otherwise 400. Payment status is unchanged (ADR 0014). Voucher uses free up since uses count only
   * uncancelled orders (M5).
   */
  async cancelPaidInTransaction(
    tx: Prisma.TransactionClient,
    audit: Audit,
    orderId: string,
    staffId: string,
    input: CancelPaidOrderRequest,
    { reallocate = true }: { reallocate?: boolean } = {},
  ) {
    const locked = await this.repo.lockState(tx, orderId)
    if (!locked) throw new Error(`Không có đơn ${orderId}`)
    // The rule lives in `canCancelPaid` (the admin page uses it too); the branches below only pick the message.
    if (!canCancelPaid(locked)) {
      const paid = locked.status === 'processing' && ['paid', 'deposit_paid'].includes(locked.paymentStatus)
      // `returned`: delivery failed and the warehouse got the goods back. `failed` must be returned first.
      throw conflict(
        paid
          ? 'Đơn đã bàn giao vận chuyển, không hủy được; giao thất bại thì nhận hàng hoàn về trước'
          : 'Chỉ hủy được đơn đang xử lý đã nhận tiền; đơn chưa thanh toán dùng nút hủy thường',
      )
    }
    const { refundable } = await this.ports.refunds.totals(tx, orderId)
    const refundAmount = BigInt(input.refundAmount)
    const note = input.note?.trim() || null
    if (refundAmount > refundable) {
      throw invalidField('refundAmount', `Số tiền hoàn vượt số còn hoàn được ${vnd(refundable)}`)
    }
    // Only pre-orders have a remaining balance; for regular orders the customer would read a meaningless reason.
    if (input.cause === 'remainder_overdue' && locked.kind !== 'preorder') {
      throw invalidField('cause', 'Đơn thường không có phần còn lại phải trả; chọn lý do khác')
    }
    if (input.cause === 'supply_failed' && refundAmount !== refundable) {
      throw invalidField('refundAmount', `Không nhập được hàng thì hoàn đủ ${vnd(refundable)}`)
    }
    if (refundAmount < refundable && !note) {
      throw invalidField('note', 'Hoàn ít hơn số còn hoàn được thì cần ghi lý do')
    }

    // Pre-order stock held for this order (fully or partly arrived) passes to the next waiting order by deposit order
    // (ADR 0013), so remember what is released before releasing it.
    const released = locked.kind === 'preorder' ? await this.repo.reservedLines(tx, orderId) : []
    await this.releaseReservations(tx, orderId)
    const order = await this.repo.update(tx, orderId, {
      status: 'cancelled',
      cancelReason: 'staff',
      cancelCause: input.cause,
      cancelNote: note,
      cancelledAt: new Date(),
      reservedUntil: null,
    })
    await this.repo.recordEvent(
      tx,
      orderId,
      'cancelled',
      { type: 'staff', staffId },
      { reason: 'staff', cause: input.cause, refundAmount: Number(refundAmount) },
    )
    // The order is now `cancelled`, so `planArrivals` (waiting pre-orders only) never reallocates to it. `reallocate:
    // false` (bulk cancel when a campaign cannot be supplied): held stock becomes regular stock instead of passing to
    // orders about to be cancelled.
    const plans =
      reallocate && released.length
        ? await this.ports.arrivals.plan(
            tx,
            released.map((l) => ({ variantId: l.variantId, quantity: l.reservedQuantity })),
            { lock: true },
          )
        : []
    const arrivedOrderCodes = plans.length
      ? await this.ports.arrivals.apply(tx, this.deps, plans, { fromOrderCode: order.code })
      : []
    const reallocated = plans.flatMap((p) =>
      p.allocations.map((a) => ({ orderCode: a.orderCode, variantId: p.variantId, quantity: a.take })),
    )
    const refund =
      refundAmount > 0n
        ? await this.ports.refunds.create(tx, {
            orderId,
            amount: refundAmount,
            origin: 'cancellation',
            note: note ?? undefined,
            staffId,
          })
        : null
    await audit({
      action: 'order.cancel_paid',
      entityType: 'order',
      entityId: orderId,
      before: {
        status: locked.status,
        paymentStatus: locked.paymentStatus,
        fulfillmentStatus: locked.fulfillmentStatus,
      },
      after: {
        status: 'cancelled',
        cancelReason: 'staff',
        cancelCause: input.cause,
        cancelNote: note,
        refundAmount: Number(refundAmount),
        refundId: refund?.id ?? null,
        ...(reallocated.length && { reallocated, arrivedOrderCodes }),
      },
    })
    // The customer's cancel requests (M6b) are resolved with the cancel.
    const resolvedRequestCodes = await this.ports.support.resolveCancelRequests(tx, orderId)
    if (resolvedRequestCodes.length) {
      await this.repo.recordEvent(
        tx,
        orderId,
        'support_resolved',
        { type: 'staff', staffId },
        { requestCodes: resolvedRequestCodes },
      )
    }
    await this.queueCancelledEmail(tx, order, input.cause, refundAmount, refundable)
    return order.code
  }

  /**
   * Staff cancel of a paid order from the admin page, then cancels payment links after commit. Pre-orders may still
   * have a remaining-balance link; money arriving later needs reconciliation. Cancelling an in-stock order's
   * already-paid link is harmless: errors are only logged.
   */
  async cancelPaidByStaff(orderId: string, ctx: RequestContext, input: CancelPaidOrderRequest, log: Logger) {
    await audited(this.deps.prisma, ctx, (tx, audit) =>
      this.cancelPaidInTransaction(tx, audit, orderId, ctx.staffId, input),
    )
    await this.cancelPaymentLinks(orderId, log)
  }

  /**
   * "Đơn đã hủy" email: the reason as told to customers, the refund amount, the non-refunded part (forfeited deposit,
   * deduction) with a pointer to the order's policy, and a lookup link with a new token. `refundable` is as of cancel.
   */
  private async queueCancelledEmail(
    tx: Prisma.TransactionClient,
    order: { id: string; code: number; kind: string; email: string; recipientName: string },
    cause: OrderCancelCause,
    refundAmount: bigint,
    refundable: bigint,
  ) {
    const link = await this.repo.issueLookupUrl(tx, this.deps.siteUrl, order)
    const policy = order.kind === 'preorder' ? 'chính sách đặt trước' : 'chính sách'
    const kept = refundable - refundAmount
    const refundText = [
      refundAmount > 0n
        ? `Chúng tôi sẽ hoàn ${vnd(refundAmount)} cho bạn và gửi email khi tiền đã được chuyển.`
        : `Đơn này không được hoàn tiền theo ${policy} đã áp dụng cho đơn.`,
      ...(refundAmount > 0n && kept > 0n ? [`Phần không hoàn: ${vnd(kept)}, theo ${policy} đã áp dụng cho đơn.`] : []),
    ]
    // Draft, awaiting the owner's approval of the wording.
    await this.deps.emails.sendEmail(tx, {
      to: order.email,
      subject: `Đơn hàng #${order.code} đã bị hủy`,
      text: [
        `Chào ${order.recipientName},`,
        '',
        `Đơn hàng #${order.code} đã bị hủy vì ${ORDER_CANCEL_CAUSE_CUSTOMER_TEXT[cause]}.`,
        ...refundText,
        '',
        `Xem đơn hàng: ${link}`,
        '',
        'Nếu cần hỗ trợ, bạn hãy trả lời email này hoặc gọi cho cửa hàng.',
      ].join('\n'),
    })
  }

  // ===== Fulfillment =====

  /** One fulfillment transition in an audited transaction; the step declares its audit action, before and after. */
  private async transition(
    orderId: string,
    ctx: RequestContext,
    step: (tx: Prisma.TransactionClient) => Promise<FulfillmentAudit>,
  ) {
    await audited(this.deps.prisma, ctx, async (tx, audit) => {
      const entry = await step(tx)
      await audit({ ...entry, entityType: 'order', entityId: orderId })
    })
  }

  /**
   * Locks the order (same lock as cancel and payment) and checks it is fully paid and at `from`. Unpaid or cancelled
   * orders cannot be fulfilled; a wrong fulfillment edge gives 409.
   */
  private async lockForTransition(tx: Prisma.TransactionClient, orderId: string, from: FulfillmentStatus) {
    const locked = await this.repo.lockState(tx, orderId)
    if (!locked) throw new Error(`Không có đơn ${orderId}`)
    if (locked.status !== 'processing' || locked.paymentStatus !== 'paid') {
      throw new AppError(409, ErrorCode.CONFLICT, 'Đơn chưa thanh toán đủ, chưa xử lý giao hàng được')
    }
    if (locked.fulfillmentStatus !== from) {
      throw new AppError(409, ErrorCode.CONFLICT, 'Trạng thái giao hàng đã đổi, hãy tải lại trang')
    }
  }

  /** `not_prepared` → `preparing`: the warehouse starts packing. */
  prepare(orderId: string, ctx: RequestContext) {
    return this.transition(orderId, ctx, async (tx) => {
      await this.lockForTransition(tx, orderId, 'not_prepared')
      await this.repo.update(tx, orderId, { fulfillmentStatus: 'preparing' })
      await this.repo.recordEvent(tx, orderId, 'preparing', { type: 'staff', staffId: ctx.staffId })
      return {
        action: 'order.prepare',
        before: { fulfillmentStatus: 'not_prepared' },
        after: { fulfillmentStatus: 'preparing' },
      }
    })
  }

  /**
   * `preparing` → `handed_over`: goods leave stock (ADR 0007). Locks the order, then via the stock port (variants
   * locked by id) deducts on-hand and reserved, one sale ledger row per order line.
   */
  handOver(orderId: string, ctx: RequestContext, shipment: HandoverRequest) {
    return this.transition(orderId, ctx, async (tx) => {
      await this.lockForTransition(tx, orderId, 'preparing')
      const lines = await this.repo.lines(tx, orderId)
      await this.ports.stock.change(
        tx,
        ctx.staffId,
        lines.map((line) => line.variantId),
        () =>
          lines.map((line, i) => ({
            variantId: line.variantId,
            quantity: -line.quantity,
            // A fully paid order is fully reserved: in-stock orders since checkout, pre-orders since arrival (ADR 0013).
            releaseReserved: line.reservedQuantity,
            kind: 'sale' as const,
            orderId,
            path: `lines.${i}`,
          })),
      )
      await this.repo.clearReservations(tx, orderId)
      const order = await this.repo.update(tx, orderId, {
        fulfillmentStatus: 'handed_over',
        ...shipment,
        handedOverAt: new Date(),
      })
      await this.repo.recordEvent(tx, orderId, 'handed_over', { type: 'staff', staffId: ctx.staffId }, shipment)
      // Same transaction: if the handover rolls back, no email.
      const link = await this.repo.issueLookupUrl(tx, this.deps.siteUrl, order)
      // Draft, awaiting the owner's approval of the wording.
      await this.deps.emails.sendEmail(tx, {
        to: order.email,
        subject: `Đơn hàng #${order.code} đã được giao cho đơn vị vận chuyển`,
        text: [
          `Chào ${order.recipientName},`,
          '',
          `Đơn hàng #${order.code} đã được giao cho đơn vị vận chuyển.`,
          '',
          `Đơn vị vận chuyển: ${shipment.carrier}`,
          `Mã vận đơn: ${shipment.trackingNumber}`,
          '',
          `Xem đơn hàng: ${link}`,
        ].join('\n'),
      })
      return {
        action: 'order.hand_over',
        before: { fulfillmentStatus: 'preparing' },
        after: { fulfillmentStatus: 'handed_over', ...shipment },
      }
    })
  }

  /** `handed_over` → `delivered`: delivered, the order completes. */
  deliver(orderId: string, ctx: RequestContext) {
    return this.transition(orderId, ctx, async (tx) => {
      await this.lockForTransition(tx, orderId, 'handed_over')
      await this.repo.update(tx, orderId, { status: 'completed', fulfillmentStatus: 'delivered' })
      await this.repo.recordEvent(tx, orderId, 'delivered', { type: 'staff', staffId: ctx.staffId })
      return {
        action: 'order.deliver',
        before: { status: 'processing', fulfillmentStatus: 'handed_over' },
        after: { status: 'completed', fulfillmentStatus: 'delivered' },
      }
    })
  }

  /**
   * `handed_over` → `failed`: delivery failed. The order stays `processing`: redeliver later, or return to stock then
   * cancel (M6a). The customer is emailed that the shop will call, in the same transaction.
   */
  failDelivery(orderId: string, ctx: RequestContext) {
    return this.transition(orderId, ctx, async (tx) => {
      await this.lockForTransition(tx, orderId, 'handed_over')
      const order = await this.repo.update(tx, orderId, { fulfillmentStatus: 'failed' })
      await this.repo.recordEvent(tx, orderId, 'delivery_failed', { type: 'staff', staffId: ctx.staffId })
      // Draft, awaiting the owner's approval of the wording.
      await this.deps.emails.sendEmail(tx, {
        to: order.email,
        subject: `Giao hàng chưa thành công đơn hàng #${order.code}`,
        text: [
          `Chào ${order.recipientName},`,
          '',
          `Đơn vị vận chuyển báo chưa giao được đơn hàng #${order.code} (${order.carrier}, mã vận đơn ${order.trackingNumber}).`,
          '',
          'Shop sẽ liên hệ với bạn qua số điện thoại hoặc email để sắp xếp lại việc giao hàng.',
        ].join('\n'),
      })
      return {
        action: 'order.delivery_failed',
        before: { fulfillmentStatus: 'handed_over' },
        after: { fulfillmentStatus: 'failed' },
      }
    })
  }

  /**
   * Redelivery (GLOSSARY "Giao lại"): `failed` → `handed_over` with a new carrier, tracking number and handover time.
   * The goods never came back, so stock is unchanged; the old tracking stays in events and audit. No charge, no email
   * (spec M6a).
   */
  redeliver(orderId: string, ctx: RequestContext, shipment: RedeliverRequest) {
    return this.transition(orderId, ctx, async (tx) => {
      await this.lockForTransition(tx, orderId, 'failed')
      const before = await this.repo.findShipment(tx, orderId)
      await this.repo.update(tx, orderId, { fulfillmentStatus: 'handed_over', ...shipment, handedOverAt: new Date() })
      await this.repo.recordEvent(
        tx,
        orderId,
        'redelivered',
        { type: 'staff', staffId: ctx.staffId },
        { ...shipment, previous: before },
      )
      return {
        action: 'order.redeliver',
        before: { fulfillmentStatus: 'failed', ...before },
        after: { fulfillmentStatus: 'handed_over', ...shipment },
      }
    })
  }

  /**
   * Return to stock (GLOSSARY "Nhận hàng hoàn về"): `failed` → `returned`. Per line, restocked + written off = quantity,
   * else 400. Restocked goods go through the stock port as `return` on the order; write-offs get no ledger row since
   * the goods left stock at handover. Clears carrier, tracking and handover time (kept in events). No cancel, no
   * refund.
   */
  returnToStock(orderId: string, ctx: RequestContext, input: ReturnToStockRequest) {
    return this.transition(orderId, ctx, async (tx) => {
      await this.lockForTransition(tx, orderId, 'failed')
      const lines = await this.repo.lines(tx, orderId)
      const byVariant = new Map(input.lines.map((l, i) => [l.variantId, { ...l, index: i }]))
      if (byVariant.size !== input.lines.length || byVariant.size !== lines.length) {
        throw invalidField('lines', 'Cần đúng một dòng cho mỗi dòng của đơn')
      }
      const plan = lines.map((line) => {
        const entry = byVariant.get(line.variantId)
        if (!entry) throw invalidField('lines', `Thiếu dòng ${line.sku}`)
        if (entry.restocked + entry.writtenOff !== line.quantity) {
          throw invalidField(
            `lines.${entry.index}`,
            `${line.sku}: số nhập lại tồn cộng số hỏng/mất phải bằng ${line.quantity}`,
          )
        }
        return { ...line, restocked: entry.restocked, writtenOff: entry.writtenOff, index: entry.index }
      })
      const restocking = plan.filter((p) => p.restocked > 0)
      if (restocking.length > 0) {
        await this.ports.stock.change(
          tx,
          ctx.staffId,
          restocking.map((p) => p.variantId),
          () =>
            restocking.map((p) => ({
              variantId: p.variantId,
              quantity: p.restocked,
              kind: 'return' as const,
              orderId,
              path: `lines.${p.index}`,
            })),
        )
      }
      for (const p of plan) {
        await this.repo.updateLine(tx, p.id, { returnedQuantity: p.restocked, writtenOffQuantity: p.writtenOff })
      }
      const before = await this.repo.findShipment(tx, orderId)
      await this.repo.update(tx, orderId, {
        fulfillmentStatus: 'returned',
        carrier: null,
        trackingNumber: null,
        handedOverAt: null,
      })
      const result = plan.map((p) => ({ sku: p.sku, restocked: p.restocked, writtenOff: p.writtenOff }))
      await this.repo.recordEvent(
        tx,
        orderId,
        'returned_to_stock',
        { type: 'staff', staffId: ctx.staffId },
        { lines: result, ...before },
      )
      return {
        action: 'order.return_to_stock',
        before: { fulfillmentStatus: 'failed', ...before },
        after: { fulfillmentStatus: 'returned', lines: result },
      }
    })
  }

  /**
   * Redeliver from stock: `returned` → `not_prepared`. Reserves every line again as at checkout (pre-orders too: the
   * goods became regular stock when restocked); shortages give 409 with the SKUs. Resets restocked/written-off to 0;
   * the order goes through prepare → hand over again.
   */
  restockForRedelivery(orderId: string, ctx: RequestContext) {
    return this.transition(orderId, ctx, async (tx) => {
      await this.lockForTransition(tx, orderId, 'returned')
      const lines = await this.repo.lines(tx, orderId)
      const reservation = await this.ports.stock.reserve(
        tx,
        lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      )
      if (!reservation.ok) {
        const short = new Set(reservation.shortVariantIds)
        throw new AppError(409, ErrorCode.CONFLICT, 'Không còn đủ hàng để giao lại', undefined, {
          skus: lines.filter((l) => short.has(l.variantId)).map((l) => l.sku),
        })
      }
      for (const line of lines) {
        await this.repo.updateLine(tx, line.id, {
          reservedQuantity: line.quantity,
          returnedQuantity: 0,
          writtenOffQuantity: 0,
        })
      }
      await this.repo.update(tx, orderId, { fulfillmentStatus: 'not_prepared' })
      await this.repo.recordEvent(tx, orderId, 'restocked_for_redelivery', { type: 'staff', staffId: ctx.staffId })
      return {
        action: 'order.restock_redeliver',
        before: { fulfillmentStatus: 'returned' },
        after: {
          fulfillmentStatus: 'not_prepared',
          reserved: lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
        },
      }
    })
  }
}
