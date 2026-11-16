import { ErrorCode } from '@ecommerce/shared'
import type { Audit } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import { AppError } from '../http/errors.ts'
import type { OrderLine } from '../generated/prisma/client.ts'
import { vnd } from '../orders/format.ts'
import { recordOrderEvent } from '../orders/orders.ts'
import { usedAllocations } from '../preorders/campaigns.ts'
import { reserveStock } from '../stock/stock.ts'
import { queueDepositReceivedEmail, queuePaymentReceivedEmail, type RecordPaymentDeps } from './record-payment.ts'

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
 * Đơn đặt trước thì so tiền cọc thay cho tổng phải trả, lấy lại suất thay cho giữ hàng, và thành `deposit_paid` kèm
 * email "đã nhận cọc".
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
  // Đơn đặt trước khôi phục về đã cọc bằng các khoản cọc; đơn hàng sẵn về đã trả đủ bằng các khoản trả đủ.
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
      // Thứ tự chia hàng tính từ lúc khôi phục: đơn không chen lên trước những người cọc trong lúc nó đã bị hủy.
      ...(preorder && { depositPaidAt: new Date() }),
      cancelReason: null,
      cancelledAt: null,
      reservedUntil: null,
    },
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
    after: { status: 'processing', paymentStatus, reconciliationItemIds },
  })
  if (preorder) await queueDepositReceivedEmail(tx, deps, order)
  else await queuePaymentReceivedEmail(tx, deps, order)
  return order.code
}

/**
 * Đơn đặt trước đã hủy lấy lại suất của mình trong đợt, kể cả khi đợt đã đóng: khóa dòng suất `FOR UPDATE` như lúc đặt
 * trước, số đã dùng (không tính chính đơn này vì nó đang hủy) cộng số lượng của đơn không vượt suất. Không giữ hàng:
 * hàng đặt trước chỉ được giữ khi về kho (ADR 0013).
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
