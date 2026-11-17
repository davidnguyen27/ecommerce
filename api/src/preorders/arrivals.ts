import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { dateVN, vnd, voucherLines } from '../orders/format.ts'
import { issueOrderLookupUrl, recordOrderEvent, remainingOf } from '../orders/orders.ts'
import { reserveStock } from '../stock/stock.ts'

/** Phần hàng về của một biến thể giữ cho một dòng đơn đặt trước. */
export type Allocation = {
  lineId: string
  orderId: string
  orderCode: number
  take: number
  /** Sau phần này dòng được giữ đủ số lượng. */
  fills: boolean
}

/** Kết quả chia hàng về của một biến thể: phần giữ cho đơn đặt trước, theo thứ tự cọc, và phần dư thành hàng sẵn. */
export type ArrivalPlan = { variantId: string; received: number; allocations: Allocation[]; toStock: number }

const DAY = 24 * 60 * 60_000

/**
 * Lập kế hoạch chia hàng về (ADR 0013): với mỗi biến thể nhập về, lần lượt các dòng đơn đặt trước đã cọc còn thiếu hàng,
 * theo lúc cọc rồi mã đơn, mỗi dòng nhận tới đủ phần còn thiếu; hết hàng thì dừng, còn dư thì thành hàng sẵn. Đơn chờ cọc
 * không được chia. Mọi phiếu nhập đều chia, không cần gắn với đợt.
 *
 * `lock` dùng trong transaction ghi phiếu nhập, sau khi `changeStock` đã khóa các biến thể: khóa thêm các dòng đơn được
 * chia `FOR UPDATE`. Không `lock` thì là xem trước, không ghi gì và có thể lệch nếu có đơn cọc xen vào.
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
 * Hàng được chia từ đâu, ghi vào sự kiện đơn: một phiếu nhập, hoặc phần hàng đã giữ của một đơn đặt trước vừa bị hủy
 * (M6a).
 */
export type ArrivalSource = { receiptId: string } | { fromOrderCode: number }

/**
 * Áp kế hoạch chia hàng trong transaction ghi phiếu nhập, hoặc khi hủy một đơn đặt trước đang giữ hàng: cộng số đang
 * giữ của dòng đơn và của biến thể (hàng đã có trong tồn và không còn giữ cho ai nên vẫn `reserved <= on_hand`). Đơn nào mọi dòng đã được giữ đủ thì thành hàng đã về: có lúc về, hạn trả phần
 * còn lại (`remainder_days` ngày sau), sự kiện đơn và email "Hàng đã về". Trả mã các đơn vừa về đủ.
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
    // Qua module kho, cùng đường khóa với `changeStock`. Tồn vừa được cộng đủ số hàng về, phần chia không vượt số đó.
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

/** Email "Hàng đã về": phần còn lại phải trả, hạn trả, link trang đơn (có token mới). Bản nháp chờ chủ doanh nghiệp duyệt. */
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
