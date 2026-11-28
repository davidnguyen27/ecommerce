import { ErrorCode, type FulfillmentStatus, type HandoverRequest, type ReturnToStockRequest } from '@ecommerce/shared'
import type { AuditEntry } from '../core/audit/audited.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../core/errors.ts'
import type { EmailQueue } from '../core/jobs/jobs.ts'
import { changeStock, reserveStock } from '../stock/stock.ts'
import { issueOrderLookupUrl, recordOrderEvent } from './orders.ts'

/** Audit entry of one fulfillment transition; the transition knows its source and target, so it declares them. */
export type FulfillmentAudit = Pick<AuditEntry, 'action' | 'before' | 'after'>

/** Customer email during fulfillment: the mail queue and the website URL for lookup links. */
export type FulfillmentMail = { emails: EmailQueue; siteUrl: string }

/**
 * Locks the order (same lock as cancel and payment) and checks it is fully paid and at `from`. Unpaid or cancelled
 * orders cannot be fulfilled; a wrong fulfillment edge gives 409.
 */
async function lockForTransition(tx: Prisma.TransactionClient, orderId: string, from: FulfillmentStatus) {
  const [locked] = await tx.$queryRaw<{ status: string; paymentStatus: string; fulfillmentStatus: string }[]>`
    SELECT "status"::text AS status, "payment_status"::text AS "paymentStatus",
      "fulfillment_status"::text AS "fulfillmentStatus"
    FROM "order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
  if (!locked) throw new Error(`Không có đơn ${orderId}`)
  if (locked.status !== 'processing' || locked.paymentStatus !== 'paid') {
    throw new AppError(409, ErrorCode.CONFLICT, 'Đơn chưa thanh toán đủ, chưa xử lý giao hàng được')
  }
  if (locked.fulfillmentStatus !== from) {
    throw new AppError(409, ErrorCode.CONFLICT, 'Trạng thái giao hàng đã đổi, hãy tải lại trang')
  }
}

/** `not_prepared` → `preparing`: the warehouse starts packing. Call in the `audited()` transaction. */
export async function prepareOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  staffId: string,
): Promise<FulfillmentAudit> {
  await lockForTransition(tx, orderId, 'not_prepared')
  await tx.order.update({ where: { id: orderId }, data: { fulfillmentStatus: 'preparing' } })
  await recordOrderEvent(tx, orderId, 'preparing', { type: 'staff', staffId })
  return {
    action: 'order.prepare',
    before: { fulfillmentStatus: 'not_prepared' },
    after: { fulfillmentStatus: 'preparing' },
  }
}

/**
 * `preparing` → `handed_over`: goods leave stock (ADR 0007). In the `audited()` transaction: locks the order, then via
 * `changeStock` (variants locked by id) deducts on-hand and reserved, one sale ledger row per order line.
 */
export async function handOverOrder(
  tx: Prisma.TransactionClient,
  { emails, siteUrl }: FulfillmentMail,
  orderId: string,
  staffId: string,
  shipment: HandoverRequest,
): Promise<FulfillmentAudit> {
  await lockForTransition(tx, orderId, 'preparing')
  const lines = await tx.orderLine.findMany({
    where: { orderId },
    select: { variantId: true, quantity: true, reservedQuantity: true },
    orderBy: { position: 'asc' },
  })
  await changeStock(
    tx,
    staffId,
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
  await tx.orderLine.updateMany({ where: { orderId }, data: { reservedQuantity: 0 } })
  const order = await tx.order.update({
    where: { id: orderId },
    data: { fulfillmentStatus: 'handed_over', ...shipment, handedOverAt: new Date() },
  })
  await recordOrderEvent(tx, orderId, 'handed_over', { type: 'staff', staffId }, shipment)
  // Same transaction: if the handover rolls back, no email.
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  // Draft, awaiting the owner's approval of the wording.
  await emails.sendEmail(tx, {
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
}

/** `handed_over` → `delivered`: delivered, the order completes. Call in the `audited()` transaction. */
export async function deliverOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  staffId: string,
): Promise<FulfillmentAudit> {
  await lockForTransition(tx, orderId, 'handed_over')
  await tx.order.update({ where: { id: orderId }, data: { status: 'completed', fulfillmentStatus: 'delivered' } })
  await recordOrderEvent(tx, orderId, 'delivered', { type: 'staff', staffId })
  return {
    action: 'order.deliver',
    before: { status: 'processing', fulfillmentStatus: 'handed_over' },
    after: { status: 'completed', fulfillmentStatus: 'delivered' },
  }
}

/**
 * `handed_over` → `failed`: delivery failed. The order stays `processing`: redeliver later, or return to stock then
 * cancel (M6a). The customer is emailed that the shop will call, in the same transaction.
 */
export async function failDelivery(
  tx: Prisma.TransactionClient,
  emails: EmailQueue,
  orderId: string,
  staffId: string,
): Promise<FulfillmentAudit> {
  await lockForTransition(tx, orderId, 'handed_over')
  const order = await tx.order.update({ where: { id: orderId }, data: { fulfillmentStatus: 'failed' } })
  await recordOrderEvent(tx, orderId, 'delivery_failed', { type: 'staff', staffId })
  // Draft, awaiting the owner's approval of the wording.
  await emails.sendEmail(tx, {
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
}

/**
 * Redelivery (GLOSSARY "Giao lại"): `failed` → `handed_over` with a new carrier, tracking number and handover time.
 * The goods never came back, so stock is unchanged; the old tracking stays in events and audit. No charge, no email
 * (spec M6a).
 */
export async function redeliverOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  staffId: string,
  shipment: HandoverRequest,
): Promise<FulfillmentAudit> {
  await lockForTransition(tx, orderId, 'failed')
  const before = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { carrier: true, trackingNumber: true },
  })
  await tx.order.update({
    where: { id: orderId },
    data: { fulfillmentStatus: 'handed_over', ...shipment, handedOverAt: new Date() },
  })
  await recordOrderEvent(tx, orderId, 'redelivered', { type: 'staff', staffId }, { ...shipment, previous: before })
  return {
    action: 'order.redeliver',
    before: { fulfillmentStatus: 'failed', ...before },
    after: { fulfillmentStatus: 'handed_over', ...shipment },
  }
}

/**
 * Return to stock (GLOSSARY "Nhận hàng hoàn về"): `failed` → `returned`. Per line, restocked + written off = quantity,
 * else 400. Restocked goods go through `changeStock` as `return` on the order; write-offs get no ledger row since the
 * goods left stock at handover. Clears carrier, tracking and handover time (kept in events). No cancel, no refund.
 */
export async function returnToStock(
  tx: Prisma.TransactionClient,
  orderId: string,
  staffId: string,
  input: ReturnToStockRequest,
): Promise<FulfillmentAudit> {
  await lockForTransition(tx, orderId, 'failed')
  const lines = await tx.orderLine.findMany({
    where: { orderId },
    select: { id: true, variantId: true, sku: true, quantity: true },
    orderBy: { position: 'asc' },
  })
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
    await changeStock(
      tx,
      staffId,
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
    await tx.orderLine.update({
      where: { id: p.id },
      data: { returnedQuantity: p.restocked, writtenOffQuantity: p.writtenOff },
    })
  }
  const before = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { carrier: true, trackingNumber: true },
  })
  await tx.order.update({
    where: { id: orderId },
    data: { fulfillmentStatus: 'returned', carrier: null, trackingNumber: null, handedOverAt: null },
  })
  const result = plan.map((p) => ({ sku: p.sku, restocked: p.restocked, writtenOff: p.writtenOff }))
  await recordOrderEvent(tx, orderId, 'returned_to_stock', { type: 'staff', staffId }, { lines: result, ...before })
  return {
    action: 'order.return_to_stock',
    before: { fulfillmentStatus: 'failed', ...before },
    after: { fulfillmentStatus: 'returned', lines: result },
  }
}

/**
 * Redeliver from stock: `returned` → `not_prepared`. Reserves every line again as at checkout (pre-orders too: the
 * goods became regular stock when restocked); shortages give 409 with the SKUs. Resets restocked/written-off to 0; the
 * order goes through prepare → hand over again.
 */
export async function restockForRedelivery(
  tx: Prisma.TransactionClient,
  orderId: string,
  staffId: string,
): Promise<FulfillmentAudit> {
  await lockForTransition(tx, orderId, 'returned')
  const lines = await tx.orderLine.findMany({
    where: { orderId },
    select: { id: true, variantId: true, sku: true, quantity: true },
    orderBy: { position: 'asc' },
  })
  const reservation = await reserveStock(
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
    await tx.orderLine.update({
      where: { id: line.id },
      data: { reservedQuantity: line.quantity, returnedQuantity: 0, writtenOffQuantity: 0 },
    })
  }
  await tx.order.update({ where: { id: orderId }, data: { fulfillmentStatus: 'not_prepared' } })
  await recordOrderEvent(tx, orderId, 'restocked_for_redelivery', { type: 'staff', staffId })
  return {
    action: 'order.restock_redeliver',
    before: { fulfillmentStatus: 'returned' },
    after: { fulfillmentStatus: 'not_prepared', reserved: lines.map((l) => ({ sku: l.sku, quantity: l.quantity })) },
  }
}
