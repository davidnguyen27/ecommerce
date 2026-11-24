import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { dateVN, vnd, voucherLines } from '../orders/format.ts'
import { issueOrderLookupUrl, recordOrderEvent, remainingOf } from '../orders/orders.ts'
import { reserveStock } from '../stock/stock.ts'

/** Part of a variant's arrived stock reserved for one pre-order line. */
export type Allocation = {
  lineId: string
  orderId: string
  orderCode: number
  take: number
  /** After this part the line is fully reserved. */
  fills: boolean
}

/**
 * Allocation of one variant's arrival: parts reserved for pre-orders in deposit order, and the rest as regular stock.
 */
export type ArrivalPlan = { variantId: string; received: number; allocations: Allocation[]; toStock: number }

const DAY = 24 * 60 * 60_000

/**
 * Plans the allocation of arrived stock (ADR 0013): for each received variant, deposited pre-order lines still short,
 * by deposit time then order code, each take up to what they lack; it stops when stock runs out, and any rest becomes
 * regular stock. Pending-deposit orders get nothing. Every receipt allocates, campaign-linked or not.
 * `lock` is for the receipt transaction, after `changeStock` locked the variants: also locks the allocated order lines.
 * Without `lock` it is a preview: writes nothing and may drift if a deposit lands meanwhile.
 */
export async function planArrivals(
  db: DbClient,
  received: readonly { variantId: string; quantity: number }[],
  { lock = false }: { lock?: boolean } = {},
): Promise<ArrivalPlan[]> {
  const plans: ArrivalPlan[] = []
  for (const { variantId, quantity } of received) {
    const waiting = await db.$queryRaw<
      { lineId: string; orderId: string; orderCode: number; quantity: number; reservedQuantity: number }[]
    >`
      SELECT l."id"::text AS "lineId", o."id"::text AS "orderId", o."code" AS "orderCode", l."quantity",
        l."reserved_quantity" AS "reservedQuantity"
      FROM "order_line" l JOIN "order" o ON o."id" = l."order_id"
      WHERE l."variant_id" = ${variantId}::uuid AND l."reserved_quantity" < l."quantity"
        AND o."kind" = 'preorder' AND o."status" = 'processing' AND o."payment_status" = 'deposit_paid'
      ORDER BY o."deposit_paid_at", o."code"
      ${lock ? Prisma.sql`FOR UPDATE OF l` : Prisma.empty}`
    let remaining = quantity
    const allocations: Allocation[] = []
    for (const line of waiting) {
      if (remaining === 0) break
      const take = Math.min(remaining, line.quantity - line.reservedQuantity)
      remaining -= take
      allocations.push({
        lineId: line.lineId,
        orderId: line.orderId,
        orderCode: line.orderCode,
        take,
        fills: line.reservedQuantity + take === line.quantity,
      })
    }
    plans.push({ variantId, received: quantity, allocations, toStock: remaining })
  }
  return plans
}

/**
 * Where allocated stock came from, recorded in the order event: a receipt, or the stock held by a just-cancelled
 * pre-order (M6a).
 */
export type ArrivalSource = { receiptId: string } | { fromOrderCode: number }

/**
 * Applies an allocation plan in the receipt transaction, or when cancelling a pre-order holding stock: adds to the
 * line's and the variant's reserved counts (the stock is on hand and held for no one, so `reserved <= on_hand` holds).
 * Orders with every line fully reserved become arrived: arrival time, remaining-balance deadline (`remainder_days`
 * later), an order event and the "Hàng đã về" email. Returns the codes of orders that just arrived.
 */
export async function applyArrivals(
  tx: Prisma.TransactionClient,
  { emails, siteUrl }: { emails: EmailQueue; siteUrl: string },
  plans: readonly ArrivalPlan[],
  source: ArrivalSource,
  now = new Date(),
) {
  const touched = new Set<string>()
  for (const plan of plans) {
    const reserved = plan.allocations.reduce((sum, a) => sum + a.take, 0)
    if (reserved === 0) continue
    // Through the stock module, on the same lock path as `changeStock`. Stock was just increased by the arrival, so
    // allocations never exceed it.
    const reservation = await reserveStock(tx, [{ variantId: plan.variantId, quantity: reserved }])
    if (!reservation.ok) throw new Error(`Không giữ được ${reserved} cho đơn đặt trước của biến thể ${plan.variantId}`)
    for (const allocation of plan.allocations) {
      await tx.orderLine.update({
        where: { id: allocation.lineId },
        data: { reservedQuantity: { increment: allocation.take } },
      })
      await recordOrderEvent(
        tx,
        allocation.orderId,
        'stock_allocated',
        { type: 'system' },
        { variantId: plan.variantId, quantity: allocation.take, ...source },
      )
      touched.add(allocation.orderId)
    }
  }

  const arrived: number[] = []
  for (const orderId of touched) {
    const short = await tx.orderLine.count({
      where: { orderId, reservedQuantity: { lt: tx.orderLine.fields.quantity } },
    })
    if (short > 0) continue
    const before = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { remainderDays: true } })
    const order = await tx.order.update({
      where: { id: orderId },
      data: { arrivedAt: now, remainderDueAt: new Date(now.getTime() + before.remainderDays! * DAY) },
      include: { lines: { orderBy: { position: 'asc' } } },
    })
    await recordOrderEvent(tx, orderId, 'arrived', { type: 'system' }, source)
    await queueArrivedEmail(tx, { emails, siteUrl }, order)
    arrived.push(order.code)
  }
  return arrived
}

type OrderWithLines = Prisma.OrderGetPayload<{ include: { lines: true } }>

/** "Hàng đã về" email: remaining balance, deadline, order page link (new token). Draft awaiting owner approval. */
async function queueArrivedEmail(
  tx: DbClient,
  { emails, siteUrl }: { emails: EmailQueue; siteUrl: string },
  order: OrderWithLines,
) {
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  const line = order.lines[0]!
  await emails.sendEmail(tx, {
    to: order.email,
    subject: `Hàng đã về cho đơn đặt trước #${order.code}`,
    text: [
      `Chào ${order.recipientName},`,
      '',
      `Hàng của đơn đặt trước #${order.code} đã về kho: ${line.productName} x ${line.quantity}.`,
      '',
      ...voucherLines(order),
      `Phần còn lại cần trả (gồm phí giao): ${vnd(remainingOf(order))}`,
      `Hạn trả: ${dateVN(order.remainderDueAt!)}`,
      '',
      `Trả phần còn lại tại trang đơn hàng: ${link}`,
      '',
      'Chúng tôi sẽ chuẩn bị và giao hàng ngay sau khi nhận đủ tiền.',
    ].join('\n'),
  })
}
