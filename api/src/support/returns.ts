import {
  type DecideSupportRequest,
  type ProductType,
  type ProposeReturnRefund,
  type ReceiveSupportReturn,
  type ReturnWindowItem,
  SUPPORT_CLOSED_STATUSES,
  type SupportReturnReason,
} from '@ecommerce/shared'
import { ProductType as ProductTypes } from '@ecommerce/shared'
import type { Audit } from '../core/audit/audited.ts'
import type { DbClient } from '../core/db.ts'
import { invalidField } from '../core/errors.ts'
import type { CustomerMail } from '../core/jobs/jobs.ts'
import { vnd } from '../core/utils/format.ts'
import { createRefund, lockOrderForRefund, refundTotals } from '../modules/refund/index.ts'
import { stockLedger } from '../modules/stock/index.ts'
import { ORDER_LINE_FOR_EXCHANGE, assertExchangeable, heldVariants, reserveExchange } from './exchanges.ts'
import { SUPPORT_INCLUDE, conflict, isClosed, lockSupportRequest, notFound, type SupportForView } from './support.ts'
import { queueSupportEmail } from './emails.ts'

/**
 * Returns (GLOSSARY "Trả hàng", spec M6b ticket 04): the customer submits lines of a delivered order to return; staff
 * accept or reject; the warehouse receives them (restock or write off, ledger kind `return`); staff propose a refund
 * (M6a refunds, `origin = return`). The order stays `completed`; voucher uses are unchanged.
 */

const DAY = 24 * 60 * 60_000

/** Request types that occupy a line's quantity: goods being (or already) returned or exchanged. */
const RETURNING_KINDS = ['return', 'exchange'] as const

/**
 * Quantity still returnable (or exchangeable) per order line: line quantity minus what is in return/exchange requests.
 * Not counted: requests ended before goods arrived (rejected, or closed by staff), and exchanges whose new item was
 * delivered (the customer holds goods again; ADR 0015). Goods already received always count, however the request
 * ended. Call under the order lock.
 */
export async function returnableQuantities(tx: DbClient, orderId: string) {
  const lines = await tx.orderLine.findMany({ where: { orderId }, select: { id: true, quantity: true } })
  const taken = await tx.supportRequestLine.findMany({
    where: {
      orderLine: { orderId },
      request: {
        kind: { in: [...RETURNING_KINDS] },
        NOT: [
          { status: { in: [...SUPPORT_CLOSED_STATUSES] }, receivedAt: null },
          { kind: 'exchange', exchangeHandedOverAt: { not: null } },
        ],
      },
    },
    select: { orderLineId: true, quantity: true },
  })
  const used = new Map<string, number>()
  for (const t of taken) used.set(t.orderLineId, (used.get(t.orderLineId) ?? 0) + t.quantity)
  return new Map(lines.map((l) => [l.id, l.quantity - (used.get(l.id) ?? 0)]))
}

/** Quantity the customer still holds per order line: line quantity minus what the shop received back via returns. */
export async function keptQuantities(tx: DbClient, orderId: string) {
  const lines = await tx.orderLine.findMany({ where: { orderId }, select: { id: true, quantity: true } })
  const returned = await tx.supportRequestLine.findMany({
    where: { orderLine: { orderId }, request: { kind: 'return', receivedAt: { not: null } } },
    select: { orderLineId: true, quantity: true },
  })
  const back = new Map<string, number>()
  for (const r of returned) back.set(r.orderLineId, (back.get(r.orderLineId) ?? 0) + r.quantity)
  return new Map(lines.map((l) => [l.id, l.quantity - (back.get(l.id) ?? 0)]))
}

export type PlannedReturnLine = {
  orderLineId: string
  quantity: number
  reason: SupportReturnReason | null
  /** The variant the customer holds (the warehouse receives this one). */
  heldVariantId: string
  /** Exchange: the variant the customer gets. */
  exchangeVariantId: string | null
}

/**
 * Matches the chosen lines (by the line's original variant) against the order and checks returnable quantities; for
 * exchanges also the target variant (ADR 0015). Otherwise 400 or 409.
 */
export async function planReturnLines(
  tx: DbClient,
  orderId: string,
  kind: 'return' | 'exchange',
  lines: readonly { variantId: string; quantity: number; reason?: SupportReturnReason; toVariantId?: string }[],
): Promise<PlannedReturnLine[]> {
  if (lines.length === 0) throw invalidField('lines', 'Chọn ít nhất một sản phẩm')
  const orderLines = await tx.orderLine.findMany({ where: { orderId }, ...ORDER_LINE_FOR_EXCHANGE })
  const available = await returnableQuantities(tx, orderId)
  const held = await heldVariants(tx, orderLines)
  const keptUnits = await keptQuantities(tx, orderId)
  const planned: PlannedReturnLine[] = []
  for (const [i, line] of lines.entries()) {
    const orderLine = orderLines.find((l) => l.variantId === line.variantId)
    if (!orderLine) throw invalidField(`lines.${i}`, 'Sản phẩm này không có trong đơn')
    const left = available.get(orderLine.id) ?? 0
    if (line.quantity > left) {
      throw conflict(
        `${orderLine.sku}: chỉ còn trả hay đổi được ${left} cái (các yêu cầu trả hay đổi khác đã chiếm phần còn lại)`,
      )
    }
    const heldVariantId = held.get(orderLine.id)!
    if (kind === 'exchange') {
      if (!line.toVariantId) throw invalidField(`lines.${i}`, 'Chọn biến thể muốn đổi sang')
      // Whole-line exchange: everything the customer holds of a line is one variant, so the next return or exchange
      // receives the right one.
      const holding = keptUnits.get(orderLine.id) ?? 0
      if (left !== holding || line.quantity !== holding) {
        throw conflict(
          left !== holding
            ? `${orderLine.sku}: dòng này đang có yêu cầu trả hay đổi khác; đổi hàng cần đổi cả dòng`
            : `${orderLine.sku}: đổi hàng cần đổi cả dòng (${holding} cái)`,
        )
      }
      await assertExchangeable(
        tx,
        { orderLine, productId: orderLine.variant.productId, heldVariantId },
        line.toVariantId,
        line.quantity,
      )
    } else if (!line.reason) throw invalidField(`lines.${i}`, 'Chọn lý do trả')
    planned.push({
      orderLineId: orderLine.id,
      quantity: line.quantity,
      reason: kind === 'return' ? line.reason! : null,
      heldVariantId,
      exchangeVariantId: kind === 'exchange' ? line.toVariantId! : null,
    })
  }
  return planned
}

/**
 * Return window snapshotted at submit (GLOSSARY "Hạn đổi trả"): smallest days among the lines' product types
 * (unconfigured types ignored; none configured gives `null`), delivery time (latest `delivered` event), days overdue.
 */
export async function returnWindowSnapshot(
  tx: DbClient,
  orderId: string,
  lines: readonly { orderLineId: string }[],
  now = new Date(),
) {
  const delivered = await tx.orderEvent.findFirst({
    where: { orderId, kind: 'delivered' },
    orderBy: { seq: 'desc' },
    select: { createdAt: true },
  })
  const types = await tx.orderLine.findMany({
    where: { id: { in: lines.map((l) => l.orderLineId) } },
    select: { variant: { select: { product: { select: { productType: true } } } } },
  })
  const windows = await tx.returnWindow.findMany({
    where: { productType: { in: types.map((t) => t.variant.product.productType) } },
  })
  const days = windows.length ? Math.min(...windows.map((w) => w.days)) : null
  const deliveredAt = delivered?.createdAt ?? null
  const overdueDays =
    days === null || !deliveredAt ? null : Math.max(0, Math.floor((now.getTime() - deliveredAt.getTime()) / DAY) - days)
  return { days, deliveredAt, overdueDays }
}

/**
 * Suggested refund for a return: Σ (price × returned − line discount × returned / line quantity, rounded down to the
 * dong). Shipping excluded (spec M6b).
 */
export async function suggestedReturnRefund(tx: DbClient, requestId: string) {
  const lines = await tx.supportRequestLine.findMany({
    where: { requestId },
    select: { quantity: true, orderLine: { select: { price: true, discount: true, quantity: true } } },
  })
  return lines.reduce(
    (sum, l) =>
      sum +
      l.orderLine.price * BigInt(l.quantity) -
      (l.orderLine.discount * BigInt(l.quantity)) / BigInt(l.orderLine.quantity),
    0n,
  )
}

/** Received returns without a proposed refund: suggested and refundable amounts, for the admin page. */
export async function returnRefundHint(db: DbClient, request: SupportForView) {
  if (request.kind !== 'return' || !request.receivedAt || isClosed(request.status) || !request.orderId) return null
  const [suggested, totals] = [await suggestedReturnRefund(db, request.id), await refundTotals(db, request.orderId)]
  return { suggested: Number(suggested), refundable: Number(totals.refundable) }
}

/**
 * Staff accept or reject a return (exchange, warranty) with a message: accepting moves it in progress and emails
 * instructions; rejecting ends it and emails the reason. Already decided gives 409. Returns the request code.
 */
export async function decideSupportRequest(
  tx: DbClient,
  mail: CustomerMail,
  audit: Audit,
  code: number,
  staffId: string,
  input: DecideSupportRequest,
) {
  const request = await lockSupportRequest(tx, { code })
  if (request.kind === 'other' || request.kind === 'cancel')
    throw conflict('Yêu cầu này không cần chấp nhận hay từ chối')
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc')
  if (request.decision) throw conflict('Yêu cầu đã được quyết định')
  const now = new Date()
  const accepted = input.decision === 'accepted'
  // Exchanges: on accept, recheck and reserve the new variant right away so it is not sold (ADR 0015).
  if (accepted && request.kind === 'exchange') await reserveExchange(tx, request)
  await tx.supportMessage.create({ data: { requestId: request.id, author: 'staff', staffId, body: input.message } })
  await tx.supportRequest.update({
    where: { id: request.id },
    data: {
      decision: input.decision,
      decidedById: staffId,
      decidedAt: now,
      status: accepted ? 'in_progress' : 'rejected',
      resolvedAt: accepted ? null : now,
      // The deciding staff member takes the request if nobody has.
      assigneeId: request.assigneeId ?? staffId,
    },
  })
  await audit({
    action: 'support.decide',
    entityType: 'support_request',
    entityId: request.id,
    before: { status: request.status, decision: null },
    after: { status: accepted ? 'in_progress' : 'rejected', decision: input.decision, message: input.message },
  })
  const updated = await tx.supportRequest.findUniqueOrThrow({ where: { id: request.id }, include: SUPPORT_INCLUDE })
  await queueSupportEmail(tx, mail, updated, accepted ? 'accepted' : 'rejected', input.message)
  return code
}

/**
 * Warehouse receives goods for a return (reused for exchanges in ticket 05): exactly one entry per request line,
 * restocked + written off = line quantity (else 400). Restocked goods go through `changeStock` kind `return`, pointing
 * at order and request, into the held variant; write-offs get no ledger row (they left stock at handover). Only after
 * acceptance, once.
 */
export async function receiveSupportReturn(
  tx: DbClient,
  audit: Audit,
  code: number,
  staffId: string,
  input: ReceiveSupportReturn,
) {
  const request = await lockSupportRequest(tx, { code })
  if (request.kind !== 'return' && request.kind !== 'exchange') throw conflict('Yêu cầu này không có hàng gửi về')
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc')
  if (request.decision !== 'accepted') throw conflict('Chưa chấp nhận yêu cầu, chưa nhận hàng về được')
  if (request.receivedAt) throw conflict('Đã nhận hàng về cho yêu cầu này')
  if (input.lines.length !== request.lines.length)
    throw invalidField('lines', 'Cần đúng một mục cho mỗi dòng của yêu cầu')

  const plan = request.lines.map((line) => {
    const index = input.lines.findIndex((l) => l.lineId === line.id)
    const entry = input.lines[index]
    if (!entry) throw invalidField('lines', `Thiếu dòng ${line.orderLine.sku}`)
    if (entry.restocked + entry.writtenOff !== line.quantity) {
      throw invalidField(
        `lines.${index}`,
        `${line.orderLine.sku}: số nhập lại tồn cộng số ghi hỏng phải bằng ${line.quantity}`,
      )
    }
    // The variant held at submit time: the original, or the one from a previous exchange.
    return { line, entry, variantId: line.heldVariantId, index }
  })

  const restocking = plan.filter((p) => p.entry.restocked > 0)
  if (restocking.length > 0) {
    await stockLedger.change(
      tx,
      staffId,
      restocking.map((p) => p.variantId),
      () =>
        restocking.map((p) => ({
          variantId: p.variantId,
          quantity: p.entry.restocked,
          kind: 'return' as const,
          orderId: request.orderId!,
          supportRequestId: request.id,
          path: `lines.${p.index}`,
        })),
    )
  }
  for (const p of plan) {
    await tx.supportRequestLine.update({
      where: { id: p.line.id },
      data: {
        restockedQuantity: p.entry.restocked,
        writtenOffQuantity: p.entry.writtenOff,
        receivedVariantId: p.variantId,
      },
    })
  }
  await tx.supportRequest.update({ where: { id: request.id }, data: { receivedAt: new Date(), receivedById: staffId } })
  await tx.supportMessage.create({
    data: { requestId: request.id, author: 'system', body: 'Cửa hàng đã nhận hàng bạn gửi về.' },
  })
  await audit({
    action: 'support.receive',
    entityType: 'support_request',
    entityId: request.id,
    after: {
      code,
      lines: plan.map((p) => ({
        sku: p.line.orderLine.sku,
        restocked: p.entry.restocked,
        writtenOff: p.entry.writtenOff,
      })),
    },
  })
  return code
}

/**
 * Proposes the refund for a received return: amount in [0, order refundable]; below the suggestion needs a note. A
 * positive amount creates a refund awaiting accounting (`origin = return`, ADR 0014). The request resolves and the
 * customer is emailed the amount. Locks the order before the request, the same order as cancel. Returns the code.
 */
export async function proposeReturnRefund(
  tx: DbClient,
  mail: CustomerMail,
  audit: Audit,
  code: number,
  staffId: string,
  input: ProposeReturnRefund,
) {
  const found = await tx.supportRequest.findUnique({ where: { code }, select: { orderId: true } })
  if (!found) throw notFound()
  if (found.orderId) await lockOrderForRefund(tx, found.orderId)
  const request = await lockSupportRequest(tx, { code })
  if (request.kind !== 'return') throw conflict('Chỉ đề xuất hoàn cho yêu cầu trả hàng')
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc')
  if (!request.receivedAt) throw conflict('Chưa nhận hàng về, chưa đề xuất hoàn được')

  const suggested = await suggestedReturnRefund(tx, request.id)
  const { refundable } = await refundTotals(tx, request.orderId!)
  const amount = BigInt(input.refundAmount)
  const note = input.note?.trim() || undefined
  if (amount > refundable) {
    throw invalidField('refundAmount', `Số tiền hoàn vượt số còn hoàn được của đơn ${vnd(refundable)}`)
  }
  if (amount < suggested && !note) throw invalidField('note', 'Hoàn ít hơn số gợi ý thì cần ghi lý do')

  const refund =
    amount > 0n
      ? await createRefund(tx, {
          orderId: request.orderId!,
          amount,
          origin: 'return',
          supportRequestId: request.id,
          note,
          staffId,
        })
      : null
  const message =
    input.message?.trim() ||
    (amount > 0n
      ? `Cửa hàng sẽ hoàn ${vnd(amount)} cho bạn và gửi email khi tiền đã được chuyển.`
      : 'Yêu cầu trả hàng không được hoàn tiền theo chính sách đã áp dụng cho đơn.')
  await tx.supportMessage.create({ data: { requestId: request.id, author: 'staff', staffId, body: message } })
  await tx.supportRequest.update({ where: { id: request.id }, data: { status: 'resolved', resolvedAt: new Date() } })
  await audit({
    action: 'support.refund_propose',
    entityType: 'support_request',
    entityId: request.id,
    after: {
      code,
      suggested: Number(suggested),
      refundAmount: Number(amount),
      note: note ?? null,
      refundId: refund?.id ?? null,
    },
  })
  const updated = await tx.supportRequest.findUniqueOrThrow({ where: { id: request.id }, include: SUPPORT_INCLUDE })
  await queueSupportEmail(tx, mail, updated, 'resolved', message)
  return code
}

/** Return windows of all five product types; unconfigured types are `null`. */
export async function loadReturnWindows(db: DbClient): Promise<ReturnWindowItem[]> {
  const rows = await db.returnWindow.findMany()
  return ProductTypes.options.map((productType: ProductType) => ({
    productType,
    days: rows.find((r) => r.productType === productType)?.days ?? null,
  }))
}

/** Saves return windows: `null` clears that type. No change, no audit. */
export async function saveReturnWindows(tx: DbClient, audit: Audit, items: readonly ReturnWindowItem[]) {
  const before = await loadReturnWindows(tx)
  const changed = items.filter((i) => before.find((b) => b.productType === i.productType)?.days !== i.days)
  if (changed.length === 0) return
  for (const item of changed) {
    if (item.days === null) await tx.returnWindow.deleteMany({ where: { productType: item.productType } })
    else {
      await tx.returnWindow.upsert({
        where: { productType: item.productType },
        create: { productType: item.productType, days: item.days },
        update: { days: item.days },
      })
    }
  }
  await audit({
    action: 'return_window.update',
    entityType: 'return_window',
    // One shared config row, like shipping fees: fixed id.
    entityId: 'return_window',
    before: { items: before },
    after: { items: await loadReturnWindows(tx) },
  })
}
