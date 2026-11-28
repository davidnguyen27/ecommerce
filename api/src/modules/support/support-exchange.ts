import { SUPPORT_CLOSED_STATUSES, type ExchangeOptions, type ShipExchangeRequest } from '@ecommerce/shared'
import type { Audit } from '../../core/audit/audited.ts'
import { cartVariants } from '../product/index.ts'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { CustomerMail } from '../../core/jobs/jobs.ts'
import { stockLedger } from '../stock/index.ts'
import { keptQuantities, returnableQuantities } from './support-return.ts'
import { queueSupportEmail } from './support-email.ts'
import { SUPPORT_INCLUDE, conflict, isClosed, lockSupportRequest } from './support-request.ts'

/**
 * Exchanges (GLOSSARY "Đổi hàng", ADR 0015): the customer swaps to another variant of the same product at the same
 * price, without a new order. Acceptance reserves the new variant; the warehouse receives the old item (via the return
 * receiving function) before handing over the new one (sale ledger pointing at order and request). Closing before
 * handover releases the reservation.
 */

/**
 * Days the customer has to send the old item after an exchange is accepted; past that a job flags it for staff. The
 * shop pays shipping, so 7 days is enough without holding the new item too long (2026-11-18).
 */
export const EXCHANGE_SEND_DAYS = 7
export const EXCHANGE_OVERDUE_MS = EXCHANGE_SEND_DAYS * 24 * 60 * 60_000

/**
 * The variant the customer holds per order line: the one received in the latest delivered exchange, else the line's
 * original. Further returns, exchanges and receiving all use it.
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
  // Newest delivery first: keep only the first hit per line.
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
 * Whether `toVariantId` can replace the line (ADR 0015): live and on sale, same product, current price equals the
 * line's price, differs from the held variant, enough stock (on-hand − reserved). Otherwise 409 with the reason, so the
 * customer can choose a return instead.
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

/** Order lines with their product, to check the target variant. */
export const ORDER_LINE_FOR_EXCHANGE = {
  select: { id: true, variantId: true, sku: true, price: true, variant: { select: { productId: true } } },
} as const satisfies Prisma.OrderLineFindManyArgs

/** Exchangeable variants per delivered order line, for the customer's exchange form (writes nothing). */
export async function exchangeOptions(db: DbClient, orderId: string): Promise<ExchangeOptions> {
  const lines = await db.orderLine.findMany({
    where: { orderId },
    ...ORDER_LINE_FOR_EXCHANGE,
    orderBy: { position: 'asc' },
  })
  const held = await heldVariants(db, lines)
  const available = await returnableQuantities(db, orderId)
  const kept = await keptQuantities(db, orderId)
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
    // After an exchange the customer holds a different variant than the line's SKU.
    const heldSku =
      heldId === line.variantId
        ? line.sku
        : (await db.productVariant.findUniqueOrThrow({ where: { id: heldId }, select: { sku: true } })).sku
    // Whole-line exchange: only when no other return or exchange request occupies the line.
    const holding = kept.get(line.id) ?? 0
    const exchangeable = available.get(line.id) === holding ? holding : 0
    result.push({ variantId: line.variantId, heldSku, returnable: exchangeable, options })
  }
  return { lines: result }
}

/** Accepts an exchange: rechecks each line, then reserves the new variants; shortage gives 409 and reserves nothing. */
export async function reserveExchange(tx: DbClient, request: { id: string; lines: ExchangeRequestLine[] }) {
  for (const line of request.lines) {
    await assertExchangeable(
      tx,
      { orderLine: line.orderLine, productId: line.orderLine.variant.productId, heldVariantId: line.heldVariantId },
      line.exchangeVariantId!,
      line.quantity,
    )
  }
  const reservation = await stockLedger.reserve(
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

/** Releases stock reserved for an undelivered exchange (request closed). Call under the request row lock. */
export async function releaseExchange(tx: DbClient, requestId: string) {
  const lines = await tx.supportRequestLine.findMany({
    where: { requestId, reservedQuantity: { gt: 0 }, exchangeVariantId: { not: null } },
    select: { id: true, exchangeVariantId: true, reservedQuantity: true },
  })
  if (lines.length === 0) return
  await stockLedger.release(
    tx,
    lines.map((l) => ({ variantId: l.exchangeVariantId!, quantity: l.reservedQuantity })),
  )
  await tx.supportRequestLine.updateMany({ where: { requestId }, data: { reservedQuantity: 0 } })
}

/**
 * Warehouse hands over the exchange variant (`order.fulfill`): only after the old item arrived, once. `changeStock`
 * kind `sale` deducts stock and releases the reservation, pointing at order and request; the request resolves and the
 * customer gets an email with the tracking number. Returns the request code.
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
  await stockLedger.change(
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
 * Daily job: flags accepted exchanges older than `EXCHANGE_SEND_DAYS` days with the old item not received. No
 * auto-cancel, no release: staff decide (spec M6b). Returns the number flagged.
 */
export async function flagOverdueExchanges(db: DbClient, now = new Date()) {
  const { count } = await db.supportRequest.updateMany({
    where: {
      kind: 'exchange',
      decision: 'accepted',
      receivedAt: null,
      exchangeOverdueAt: null,
      status: { notIn: [...SUPPORT_CLOSED_STATUSES] },
      decidedAt: { lte: new Date(now.getTime() - EXCHANGE_OVERDUE_MS) },
    },
    data: { exchangeOverdueAt: now },
  })
  return count
}
