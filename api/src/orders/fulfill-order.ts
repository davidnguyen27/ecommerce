import { ErrorCode, type FulfillmentStatus, type HandoverRequest } from '@ecommerce/shared'
import type { AuditEntry } from '../audit/audited.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { changeStock } from '../stock/stock.ts'
import { issueOrderLookupUrl, recordOrderEvent } from './orders.ts'

/** Bản audit của một lần chuyển trạng thái giao hàng; hàm chuyển trạng thái biết nguồn và đích nên tự khai. */
export type FulfillmentAudit = Pick<AuditEntry, 'action' | 'before' | 'after'>

/** Gửi email cho khách khi xử lý giao hàng: hàng đợi thư và địa chỉ website để dựng link tra cứu. */
export type FulfillmentMail = { emails: EmailQueue; siteUrl: string }

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
 * `preparing` → `handed_over`: hàng rời tồn (ADR 0007). Trong transaction của `audited()`: khóa đơn, rồi qua
 * `changeStock` (khóa biến thể theo thứ tự id) trừ cả tồn và số đang giữ, ghi một dòng sổ xuất bán mỗi dòng đơn.
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
  const order = await tx.order.update({
    where: { id: orderId },
    data: { fulfillmentStatus: 'handed_over', ...shipment, handedOverAt: new Date() },
  })
  await recordOrderEvent(tx, orderId, 'handed_over', { type: 'staff', staffId }, shipment)
  // Trong cùng transaction: bàn giao rollback thì không có thư.
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  // Bản nháp, chờ chủ doanh nghiệp duyệt nội dung.
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

/** `handed_over` → `delivered`: đã giao tới khách, đơn hoàn tất. Gọi trong transaction của `audited()`. */
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
 * `handed_over` → `failed`: giao không thành công. Đơn vẫn `processing` (nhập lại kho, hoàn tiền là việc của M6);
 * khách nhận email báo shop sẽ liên hệ, xếp trong cùng transaction. Gọi trong transaction của `audited()`.
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
  // Bản nháp, chờ chủ doanh nghiệp duyệt nội dung.
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
