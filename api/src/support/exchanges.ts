import type { ExchangeOptions, ShipExchangeRequest } from '@ecommerce/shared'
import type { Audit } from '../audit/audited.ts'
import { cartVariants } from '../checkout/live-variants.ts'
import type { DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import type { CustomerMail } from '../jobs/jobs.ts'
import { releaseStock, reserveStock, changeStock } from '../stock/stock.ts'
import { returnableQuantities } from './returns.ts'
import { SUPPORT_INCLUDE, conflict, isClosed, lockSupportRequest, queueSupportEmail } from './support.ts'

/**
 * Đổi hàng (GLOSSARY "Đổi hàng", ADR 0015): khách đổi sang biến thể khác của cùng sản phẩm, cùng giá, không tạo đơn mới.
 * Chấp nhận thì giữ hàng biến thể mới; kho nhận hàng cũ (hàm nhận hàng của trả hàng) rồi mới bàn giao biến thể mới (sổ
 * xuất bán trỏ về đơn và yêu cầu). Đóng yêu cầu trước khi giao thì nhả hàng đang giữ.
 */

/** Đổi hàng đã chấp nhận mà quá ngần này chưa nhận được hàng cũ thì gắn cờ (spec M6b, số tạm). */
export const EXCHANGE_OVERDUE_MS = 14 * 24 * 60 * 60_000

/**
 * Biến thể khách đang giữ của từng dòng đơn: biến thể nhận được ở lần đổi gần nhất đã giao, không có thì biến thể gốc
 * của dòng. Trả hay đổi tiếp và nhận hàng về đều dùng biến thể này.
 */
export async function heldVariants(tx: DbClient, orderLines: readonly { id: string; variantId: string }[]) {
  const shipped = await tx.supportRequestLine.findMany({
    where: {
      orderLineId: { in: orderLines.map((l) => l.id) },
      exchangeVariantId: { not: null },
      request: { kind: 'exchange', exchangeHandedOverAt: { not: null } },
    },
    select: { orderLineId: true, exchangeVariantId: true, request: { select: { exchangeHandedOverAt: true } } },
    orderBy: { request: { exchangeHandedOverAt: 'desc' } },
  })
  const held = new Map(orderLines.map((l) => [l.id, l.variantId]))
  // Lần giao mới nhất đứng đầu: chỉ lấy lần đầu gặp của mỗi dòng.
  const seen = new Set<string>()
  for (const s of shipped) {
    if (seen.has(s.orderLineId)) continue
    seen.add(s.orderLineId)
    held.set(s.orderLineId, s.exchangeVariantId!)
  }
  return held
}

type ExchangeCheck = { orderLine: { price: bigint; sku: string }; productId: string; heldVariantId: string }

/**
 * Biến thể `toVariantId` có đổi được cho dòng không (ADR 0015): có trong phiên bản đang xuất bản và đang bán, cùng sản
 * phẩm, giá hiện tại bằng giá của dòng, khác biến thể khách đang giữ, còn đủ hàng (tồn − đang giữ). Sai thì 409 kèm lý do
 * để khách chọn trả hàng.
 */
export async function assertExchangeable(tx: DbClient, line: ExchangeCheck, toVariantId: string, quantity: number) {
  const target = (await cartVariants(tx, [toVariantId])).get(toVariantId)
  const stock = await tx.productVariant.findUnique({
    where: { id: toVariantId },
    select: { productId: true, onHand: true, reserved: true, sku: true },
  })
  const prefix = `${line.orderLine.sku}: `
  if (!stock || stock.productId !== line.productId) {
    throw conflict(`${prefix}chỉ đổi được sang biến thể khác của cùng sản phẩm`)
  }
  if (toVariantId === line.heldVariantId) throw conflict(`${prefix}biến thể muốn đổi trùng biến thể bạn đang có`)
  if (!target?.variant) throw conflict(`${prefix}${stock.sku} không còn bán`)
  if (BigInt(target.variant.price) !== line.orderLine.price) {
    throw conflict(`${prefix}${stock.sku} khác giá, không đổi được; bạn có thể trả hàng rồi đặt mua mới`)
  }
  if (stock.onHand - stock.reserved < quantity) throw conflict(`${prefix}${stock.sku} không còn đủ hàng để đổi`)
}

/** Dòng của đơn kèm sản phẩm, để kiểm biến thể đổi sang. */
export const ORDER_LINE_FOR_EXCHANGE = {
  select: { id: true, variantId: true, sku: true, price: true, variant: { select: { productId: true } } },
} as const satisfies Prisma.OrderLineFindManyArgs

/** Biến thể đổi được của từng dòng đơn đã giao, cho form đổi hàng của khách (không ghi gì). */
export async function exchangeOptions(db: DbClient, orderId: string): Promise<ExchangeOptions> {
  const lines = await db.orderLine.findMany({
    where: { orderId },
    ...ORDER_LINE_FOR_EXCHANGE,
    orderBy: { position: 'asc' },
  })
  const held = await heldVariants(db, lines)
  const available = await returnableQuantities(db, orderId)
  const result: ExchangeOptions['lines'] = []
  for (const line of lines) {
    const heldId = held.get(line.id)!
    const siblings = await db.productVariant.findMany({
      where: { productId: line.variant.productId, id: { not: heldId } },
      select: { id: true, sku: true, onHand: true, reserved: true },
      orderBy: { sku: 'asc' },
    })
    const live = await cartVariants(
      db,
      siblings.map((v) => v.id),
    )
    const options = siblings
      .filter((v) => {
        const variant = live.get(v.id)?.variant
        return variant && BigInt(variant.price) === line.price && v.onHand - v.reserved > 0
      })
      .map((v) => ({
        variantId: v.id,
        sku: v.sku,
        label: Object.values(live.get(v.id)!.variant!.attributes)
          .map((value) => (Array.isArray(value) ? value.join(', ') : String(value)))
          .join(' · '),
      }))
    // Đã đổi rồi thì khách đang giữ biến thể khác với SKU trên dòng đơn.
    const heldSku =
      heldId === line.variantId
        ? line.sku
        : (await db.productVariant.findUniqueOrThrow({ where: { id: heldId }, select: { sku: true } })).sku
    result.push({ variantId: line.variantId, heldSku, returnable: available.get(line.id) ?? 0, options })
  }
  return { lines: result }
}

/** Chấp nhận đổi hàng: kiểm lại từng dòng rồi giữ hàng biến thể mới; không đủ thì 409 và không giữ gì. */
export async function reserveExchange(tx: DbClient, request: { id: string; lines: ExchangeRequestLine[] }) {
  for (const line of request.lines) {
    await assertExchangeable(
      tx,
      { orderLine: line.orderLine, productId: line.orderLine.variant.productId, heldVariantId: line.heldVariantId },
      line.exchangeVariantId!,
      line.quantity,
    )
  }
  const reservation = await reserveStock(
    tx,
    request.lines.map((l) => ({ variantId: l.exchangeVariantId!, quantity: l.quantity })),
  )
  if (!reservation.ok) throw conflict('Không còn đủ hàng để giữ cho yêu cầu đổi')
  for (const line of request.lines) {
    await tx.supportRequestLine.update({ where: { id: line.id }, data: { reservedQuantity: line.quantity } })
  }
}

type ExchangeRequestLine = {
  id: string
  quantity: number
  heldVariantId: string
  exchangeVariantId: string | null
  reservedQuantity: number
  orderLine: { price: bigint; sku: string; variant: { productId: string } }
}

/** Nhả hàng đang giữ cho yêu cầu đổi chưa giao (yêu cầu bị đóng). Gọi dưới khóa dòng yêu cầu. */
export async function releaseExchange(tx: DbClient, requestId: string) {
  const lines = await tx.supportRequestLine.findMany({
    where: { requestId, reservedQuantity: { gt: 0 }, exchangeVariantId: { not: null } },
    select: { id: true, exchangeVariantId: true, reservedQuantity: true },
  })
  if (lines.length === 0) return
  await releaseStock(
    tx,
    lines.map((l) => ({ variantId: l.exchangeVariantId!, quantity: l.reservedQuantity })),
  )
  await tx.supportRequestLine.updateMany({ where: { requestId }, data: { reservedQuantity: 0 } })
}

/**
 * Kho bàn giao biến thể đổi (`order.fulfill`): chỉ sau khi đã nhận hàng cũ, một lần. `changeStock` loại `sale` trừ tồn và
 * nhả số đang giữ, trỏ về đơn và yêu cầu; yêu cầu xong, khách nhận email kèm mã vận đơn. Trả mã yêu cầu.
 */
export async function shipExchange(
  tx: DbClient,
  mail: CustomerMail,
  audit: Audit,
  code: number,
  staffId: string,
  shipment: ShipExchangeRequest,
) {
  const request = await lockSupportRequest(tx, { code })
  if (request.kind !== 'exchange') throw conflict('Chỉ bàn giao hàng đổi cho yêu cầu đổi hàng')
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc')
  if (!request.receivedAt) throw conflict('Chưa nhận hàng khách gửi về, chưa giao hàng đổi được (ADR 0015)')
  const lines = request.lines.filter((l) => l.exchangeVariantId)
  await changeStock(
    tx,
    staffId,
    lines.map((l) => l.exchangeVariantId!),
    () =>
      lines.map((l, i) => ({
        variantId: l.exchangeVariantId!,
        quantity: -l.quantity,
        releaseReserved: l.reservedQuantity,
        kind: 'sale' as const,
        orderId: request.orderId!,
        supportRequestId: request.id,
        path: `lines.${i}`,
      })),
  )
  await tx.supportRequestLine.updateMany({ where: { requestId: request.id }, data: { reservedQuantity: 0 } })
  const now = new Date()
  await tx.supportRequest.update({
    where: { id: request.id },
    data: {
      exchangeCarrier: shipment.carrier,
      exchangeTrackingNumber: shipment.trackingNumber,
      exchangeHandedOverAt: now,
      status: 'resolved',
      resolvedAt: now,
    },
  })
  const message = `Cửa hàng đã gửi hàng đổi cho bạn qua ${shipment.carrier}, mã vận đơn ${shipment.trackingNumber}.`
  await tx.supportMessage.create({ data: { requestId: request.id, author: 'staff', staffId, body: message } })
  await audit({
    action: 'support.exchange_ship',
    entityType: 'support_request',
    entityId: request.id,
    after: { code, ...shipment, lines: lines.map((l) => ({ sku: l.exchangeVariant?.sku, quantity: l.quantity })) },
  })
  const updated = await tx.supportRequest.findUniqueOrThrow({ where: { id: request.id }, include: SUPPORT_INCLUDE })
  await queueSupportEmail(tx, mail, updated, 'resolved', message)
  return code
}

/**
 * Job hằng ngày: gắn cờ yêu cầu đổi đã chấp nhận quá 14 ngày mà chưa nhận được hàng cũ. Không tự hủy, không nhả hàng:
 * nhân viên quyết (spec M6b). Trả số yêu cầu vừa gắn cờ.
 */
export async function flagOverdueExchanges(db: DbClient, now = new Date()) {
  const { count } = await db.supportRequest.updateMany({
    where: {
      kind: 'exchange',
      decision: 'accepted',
      receivedAt: null,
      exchangeOverdueAt: null,
      status: { notIn: ['resolved', 'rejected'] },
      decidedAt: { lte: new Date(now.getTime() - EXCHANGE_OVERDUE_MS) },
    },
    data: { exchangeOverdueAt: now },
  })
  return count
}
