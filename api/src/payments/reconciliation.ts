import { ErrorCode } from '@ecommerce/shared'
import type { Audit } from '../core/audit/audited.ts'
import type { DbClient } from '../core/db.ts'
import { AppError } from '../core/errors.ts'
import type { OrderLine } from '../generated/prisma/client.ts'
import { vnd } from '../core/utils/format.ts'
import { recordOrderEvent } from '../modules/order/index.ts'
import { usedAllocations } from '../preorders/campaigns.ts'
import { stockLedger } from '../modules/stock/index.ts'
import { queueDepositReceivedEmail, queuePaymentReceivedEmail, type RecordPaymentDeps } from './record-payment.ts'
import { createRefund } from './refunds.ts'
import { usedRedemptions } from '../vouchers/vouchers.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy mục cần đối soát')
const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, ErrorCode.CONFLICT, message, undefined, details)

/**
 * Locks the reconciliation item's order (same lock as payment and cancel), then rereads the item under the lock.
 * Unknown or closed items throw.
 */
async function lockOpenItem(tx: DbClient, itemId: string) {
  if (!UUID.test(itemId)) throw notFound()
  const found = await tx.reconciliationItem.findUnique({ where: { id: itemId }, select: { orderId: true } })
  if (!found) throw notFound()
  await tx.$queryRaw`SELECT "id" FROM "order" WHERE "id" = ${found.orderId}::uuid FOR UPDATE`
  const item = await tx.reconciliationItem.findUniqueOrThrow({ where: { id: itemId } })
  if (item.status !== 'open') throw conflict('Mục này đã được xử lý')
  return item
}

/**
 * Restores a cancelled order once paid in full: only when `cancelled`, total received equals the amount due, and the
 * stock can be reserved again. The order becomes `processing` + `paid` as for a normal payment, with the "payment
 * received" email. Received matching the total means every payment is accounted for, so all its open items close as
 * `restored`. Orders with an item closed "outside the system" (maybe refunded by hand) are not restored.
 * Pre-orders compare against the deposit, take back allocation instead of reserving stock, and become `deposit_paid`
 * with the "deposit received" email.
 */
export async function restoreOrder(
  tx: DbClient,
  deps: Pick<RecordPaymentDeps, 'emails' | 'siteUrl'>,
  audit: Audit,
  itemId: string,
  staffId: string,
) {
  const item = await lockOpenItem(tx, itemId)
  const order = await tx.order.findUniqueOrThrow({
    where: { id: item.orderId },
    include: { lines: { orderBy: { position: 'asc' } } },
  })
  if (order.status !== 'cancelled') throw conflict('Chỉ khôi phục được đơn đã hủy')
  // Staff cancelled a paid order (M6a): cancel, forfeit or refund was deliberate, not reversed by late money. That
  // money is handled by refund or outside the system.
  if (order.cancelCause) throw conflict('Đơn bị nhân viên hủy sau khi đã nhận tiền, không khôi phục được')
  const handledExternally = await tx.reconciliationItem.count({
    where: { orderId: order.id, resolution: 'handled_externally' },
  })
  if (handledExternally > 0) {
    throw conflict('Đơn có khoản tiền đã xử lý ngoài hệ thống, không khôi phục được')
  }
  // Money returned (or being returned) to the customer leaves the order short.
  const refunds = await tx.refund.count({ where: { orderId: order.id, status: { not: 'failed' } } })
  if (refunds > 0) throw conflict('Đơn có khoản hoàn tiền, không khôi phục được')
  // Pre-orders restore to deposited from deposit payments; in-stock orders to paid from full payments.
  const preorder = order.kind === 'preorder'
  const due = preorder ? order.depositAmount! : order.total
  const { _sum } = await tx.paymentTransaction.aggregate({
    where: { orderId: order.id, purpose: preorder ? 'deposit' : 'full' },
    _sum: { amount: true },
  })
  const received = _sum.amount ?? 0n
  if (received !== due) {
    const message = preorder
      ? `Tiền cọc đã nhận ${vnd(received)} khác tiền cọc của đơn ${vnd(due)}`
      : `Tổng đã nhận ${vnd(received)} khác tổng phải trả của đơn ${vnd(due)}`
    throw conflict(message, { received: Number(received), total: Number(due) })
  }

  if (preorder) await retakeAllocation(tx, order)
  else {
    const reservation = await stockLedger.reserve(
      tx,
      order.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
    )
    if (!reservation.ok) {
      const short = new Set(reservation.shortVariantIds)
      throw conflict('Không còn đủ hàng để giữ lại cho đơn', {
        lines: order.lines.filter((l) => short.has(l.variantId)).map((l) => ({ variantId: l.variantId, sku: l.sku })),
      })
    }
    for (const line of order.lines) {
      await tx.orderLine.update({ where: { id: line.id }, data: { reservedQuantity: line.quantity } })
    }
  }

  const paymentStatus = preorder ? 'deposit_paid' : 'paid'
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'processing',
      paymentStatus,
      // Allocation order counts from the restore: the order does not jump ahead of those who deposited while it was
      // cancelled.
      ...(preorder && { depositPaidAt: new Date() }),
      cancelReason: null,
      cancelledAt: null,
      reservedUntil: null,
    },
  })
  const voucherOverLimit = await voucherOverLimitOf(tx, order)
  const openItems = await tx.reconciliationItem.findMany({
    where: { orderId: order.id, status: 'open' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  const reconciliationItemIds = openItems.map((i) => i.id)
  await tx.reconciliationItem.updateMany({
    where: { id: { in: reconciliationItemIds } },
    data: { status: 'resolved', resolution: 'restored', resolvedById: staffId, resolvedAt: new Date() },
  })
  await recordOrderEvent(
    tx,
    order.id,
    'restored',
    { type: 'staff', staffId },
    { received: Number(received), reconciliationItemIds, ...(voucherOverLimit && { voucherOverLimit }) },
  )
  await audit({
    action: 'reconciliation.restore',
    entityType: 'order',
    entityId: order.id,
    before: { status: order.status, paymentStatus: order.paymentStatus, cancelReason: order.cancelReason },
    after: {
      status: 'processing',
      paymentStatus,
      reconciliationItemIds,
      ...(voucherOverLimit && { voucherOverLimit }),
    },
  })
  if (preorder) await queueDepositReceivedEmail(tx, deps, order)
  else await queuePaymentReceivedEmail(tx, deps, order)
  return order.code
}

/**
 * Restore keeps the snapshotted discount and does not recheck the voucher (spec M5): the customer paid what the order
 * says. If uses (counting this order) then exceed the voucher's total, returns details for the event and audit.
 */
async function voucherOverLimitOf(tx: DbClient, order: { voucherId: string | null; voucherCode: string | null }) {
  if (!order.voucherId) return null
  const { totalLimit } = await tx.voucher.findUniqueOrThrow({
    where: { id: order.voucherId },
    select: { totalLimit: true },
  })
  if (totalLimit === null) return null
  const used = (await usedRedemptions(tx, [order.voucherId])).get(order.voucherId) ?? 0
  return used > totalLimit ? { code: order.voucherCode!, used, totalLimit } : null
}

/**
 * A cancelled pre-order takes back its allocation, even if the campaign closed: locks the allocation row as at
 * pre-order time; used (excluding this cancelled order) plus its quantity must fit. No stock reservation: pre-order
 * stock is only reserved on arrival (ADR 0013).
 */
async function retakeAllocation(tx: DbClient, order: { preorderCampaignId: string | null; lines: OrderLine[] }) {
  const campaignId = order.preorderCampaignId!
  const line = order.lines[0]!
  const [row] = await tx.$queryRaw<{ allocation: number }[]>`
    SELECT "allocation" FROM "preorder_campaign_variant"
    WHERE "campaign_id" = ${campaignId}::uuid AND "variant_id" = ${line.variantId}::uuid FOR UPDATE`
  const used = (await usedAllocations(tx, [campaignId])).get(campaignId)?.get(line.variantId) ?? 0
  if (!row || used + line.quantity > row.allocation) {
    throw conflict('Đợt đặt trước không còn đủ suất để khôi phục đơn', { sku: line.sku })
  }
}

/**
 * Resolves by refund: creates a `pending` refund (`origin = reconciliation`) for the item amount, then closes the item
 * as `refunded`. Order status is unchanged. Over the refundable amount gives 409 (`createRefund`). Returns the code.
 */
export async function refundReconciliationItem(tx: DbClient, audit: Audit, itemId: string, staffId: string) {
  const item = await lockOpenItem(tx, itemId)
  const refund = await createRefund(tx, {
    orderId: item.orderId,
    amount: item.amount,
    origin: 'reconciliation',
    reconciliationItemId: item.id,
    staffId,
  })
  await tx.reconciliationItem.update({
    where: { id: item.id },
    data: { status: 'resolved', resolution: 'refunded', resolvedById: staffId, resolvedAt: new Date() },
  })
  await recordOrderEvent(
    tx,
    item.orderId,
    'reconciliation_resolved',
    { type: 'staff', staffId },
    { reconciliationItemId: item.id, amount: Number(item.amount), resolution: 'refunded', refundId: refund.id },
  )
  await audit({
    action: 'reconciliation.refund',
    entityType: 'order',
    entityId: item.orderId,
    before: { reconciliationItemId: item.id, status: 'open' },
    after: { reconciliationItemId: item.id, status: 'resolved', resolution: 'refunded', refundId: refund.id },
  })
  const order = await tx.order.findUniqueOrThrow({ where: { id: item.orderId }, select: { code: true } })
  return order.code
}

/** "Handled outside the system" (manual refund…): closes the item with a note, order status unchanged. */
export async function resolveExternally(tx: DbClient, audit: Audit, itemId: string, staffId: string, note: string) {
  const item = await lockOpenItem(tx, itemId)
  await tx.reconciliationItem.update({
    where: { id: item.id },
    data: { status: 'resolved', resolution: 'handled_externally', note, resolvedById: staffId, resolvedAt: new Date() },
  })
  await recordOrderEvent(
    tx,
    item.orderId,
    'reconciliation_resolved',
    { type: 'staff', staffId },
    { reconciliationItemId: item.id, amount: Number(item.amount), note },
  )
  await audit({
    action: 'reconciliation.resolve',
    entityType: 'order',
    entityId: item.orderId,
    before: { reconciliationItemId: item.id, status: 'open' },
    after: { reconciliationItemId: item.id, status: 'resolved', note },
  })
  const order = await tx.order.findUniqueOrThrow({ where: { id: item.orderId }, select: { code: true } })
  return order.code
}
