import { ErrorCode, type FulfillmentStatus, type HandoverRequest } from '@ecommerce/shared'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { changeStock } from '../stock/stock.ts'
import { recordOrderEvent } from './orders.ts'

/**
 * Khóa đơn `FOR UPDATE` (cùng khóa với hủy đơn và ghi nhận thanh toán) rồi kiểm đơn đã trả đủ và đang ở `from`.
 * Đơn chưa trả hay đã hủy thì chưa xử lý giao hàng được; sai cạnh trạng thái giao hàng thì 409.
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

/** `not_prepared` → `preparing`: nhân viên kho bắt đầu soạn hàng. Gọi trong transaction của `audited()`. */
export async function prepareOrder(tx: Prisma.TransactionClient, orderId: string, staffId: string) {
  await lockForTransition(tx, orderId, 'not_prepared')
  await tx.order.update({ where: { id: orderId }, data: { fulfillmentStatus: 'preparing' } })
  await recordOrderEvent(tx, orderId, 'preparing', { type: 'staff', staffId })
}

/**
 * `preparing` → `handed_over`: hàng rời tồn (ADR 0007). Trong transaction của `audited()`: khóa đơn, rồi qua
 * `changeStock` (khóa biến thể theo thứ tự id) trừ cả tồn và số đang giữ, ghi một dòng sổ xuất bán mỗi dòng đơn.
 */
export async function handOverOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  staffId: string,
  shipment: HandoverRequest,
) {
  await lockForTransition(tx, orderId, 'preparing')
  const lines = await tx.orderLine.findMany({
    where: { orderId },
    select: { variantId: true, quantity: true },
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
        releaseReserved: line.quantity,
        kind: 'sale' as const,
        orderId,
        path: `lines.${i}`,
      })),
  )
  await tx.order.update({
    where: { id: orderId },
    data: { fulfillmentStatus: 'handed_over', ...shipment, handedOverAt: new Date() },
  })
  await recordOrderEvent(tx, orderId, 'handed_over', { type: 'staff', staffId }, shipment)
  // Ticket 09: xếp email "đã bàn giao vận chuyển" ở đây, trong cùng transaction, để rollback thì không gửi.
}
