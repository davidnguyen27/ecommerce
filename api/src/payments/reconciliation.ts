import { ErrorCode } from '@ecommerce/shared'
import type { Audit } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { recordOrderEvent } from '../orders/orders.ts'
import { reserveStock } from '../stock/stock.ts'
import { queuePaymentReceivedEmail, type RecordPaymentDeps } from './record-payment.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy mục cần đối soát')
const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, ErrorCode.CONFLICT, message, undefined, details)

/**
 * Khóa đơn của mục cần đối soát `FOR UPDATE` (cùng khóa với ghi nhận thanh toán và hủy đơn), rồi đọc lại mục dưới khóa.
 * Mục lạ hay đã đóng thì ném lỗi.
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
 * Khôi phục đơn đã hủy khi tiền về đủ: chỉ khi đơn đang `cancelled`, tổng đã nhận bằng đúng tổng phải trả và giữ lại được
 * đủ hàng. Đơn thành `processing` + `paid` như thanh toán bình thường, xếp email "đã nhận thanh toán". Tổng đã nhận khớp
 * tổng đơn nghĩa là mọi khoản của đơn đều đã tính vào, nên mọi mục còn mở của đơn cùng được đóng là `restored`.
 * Đơn có mục đã đóng "ngoài hệ thống" (có thể đã hoàn tiền tay) thì không khôi phục.
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
  const handledExternally = await tx.reconciliationItem.count({
    where: { orderId: order.id, resolution: 'handled_externally' },
  })
  if (handledExternally > 0) {
    throw conflict('Đơn có khoản tiền đã xử lý ngoài hệ thống, không khôi phục được')
  }
  const { _sum } = await tx.paymentTransaction.aggregate({ where: { orderId: order.id }, _sum: { amount: true } })
  const received = _sum.amount ?? 0n
  if (received !== order.total) {
    const vnd = (amount: bigint) => `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`
    throw conflict(`Tổng đã nhận ${vnd(received)} khác tổng phải trả của đơn ${vnd(order.total)}`, {
      received: Number(received),
      total: Number(order.total),
    })
  }

  const reservation = await reserveStock(
    tx,
    order.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
  )
  if (!reservation.ok) {
    const short = new Set(reservation.shortVariantIds)
    throw conflict('Không còn đủ hàng để giữ lại cho đơn', {
      lines: order.lines.filter((l) => short.has(l.variantId)).map((l) => ({ variantId: l.variantId, sku: l.sku })),
    })
  }

  await tx.order.update({
    where: { id: order.id },
    data: { status: 'processing', paymentStatus: 'paid', cancelReason: null, cancelledAt: null, reservedUntil: null },
  })
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
    { received: Number(received), reconciliationItemIds },
  )
  await audit({
    action: 'reconciliation.restore',
    entityType: 'order',
    entityId: order.id,
    before: { status: order.status, paymentStatus: order.paymentStatus, cancelReason: order.cancelReason },
    after: { status: 'processing', paymentStatus: 'paid', reconciliationItemIds },
  })
  await queuePaymentReceivedEmail(tx, deps, order)
  return order.code
}

/** "Đã xử lý ngoài hệ thống" (hoàn tiền tay…): đóng mục với ghi chú, không đổi trạng thái đơn. */
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
