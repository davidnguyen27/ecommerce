import { ErrorCode, type FulfillmentStatus, type HandoverRequest, type ReturnToStockRequest } from '@ecommerce/shared'
import type { AuditEntry } from '../audit/audited.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { changeStock, reserveStock } from '../stock/stock.ts'
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
        // Đơn đã trả đủ thì đang giữ đủ: đơn hàng sẵn từ lúc đặt, đơn đặt trước từ lúc hàng về (ADR 0013).
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
 * `handed_over` → `failed`: giao không thành công. Đơn vẫn `processing`: sau đó giao lại, hoặc nhận hàng hoàn về rồi hủy (M6a);
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

/**
 * Giao lại (GLOSSARY): `failed` → `handed_over` với đơn vị vận chuyển, mã vận đơn và lúc bàn giao mới. Hàng chưa về kho
 * nên không đổi tồn; mã cũ còn trong sự kiện đơn và audit. Không thu thêm tiền, không gửi email (spec M6a).
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
 * Nhận hàng hoàn về (GLOSSARY): `failed` → `returned`. Mỗi dòng đơn: số nhập lại tồn + số hỏng/mất = số lượng, sai thì
 * 400. Phần nhập lại tồn qua `changeStock` loại `return` trỏ về đơn; phần hỏng/mất không ghi sổ vì hàng đã rời tồn lúc
 * bàn giao. Xóa đơn vị vận chuyển, mã vận đơn, lúc bàn giao (còn trong sự kiện đơn). Không hủy đơn, không hoàn tiền.
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
 * Giao lại từ kho: `returned` → `not_prepared`. Giữ hàng lại cho mọi dòng như lúc đặt mua (đơn đặt trước cũng vậy: hàng
 * đã thành hàng sẵn khi nhập lại tồn), thiếu thì 409 kèm các SKU thiếu. Đưa số nhập lại/hỏng của dòng về 0; đơn đi lại
 * luồng chuẩn bị → bàn giao.
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
