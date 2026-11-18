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
import type { Audit } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import { invalidField } from '../http/errors.ts'
import type { CustomerMail } from '../jobs/jobs.ts'
import { vnd } from '../orders/format.ts'
import { createRefund, lockOrderForRefund, refundTotals } from '../payments/refunds.ts'
import { changeStock } from '../stock/stock.ts'
import { ORDER_LINE_FOR_EXCHANGE, assertExchangeable, heldVariants, reserveExchange } from './exchanges.ts'
import { SUPPORT_INCLUDE, conflict, isClosed, lockSupportRequest, notFound, type SupportForView } from './support.ts'
import { queueSupportEmail } from './emails.ts'

/**
 * Trả hàng (GLOSSARY "Trả hàng", spec M6b ticket 04): khách gửi các dòng muốn trả của đơn đã giao; nhân viên chấp nhận
 * hay từ chối; kho nhận hàng về (nhập lại tồn hoặc ghi hỏng, sổ loại `return`); nhân viên đề xuất hoàn (hoàn tiền của
 * M6a, `origin = return`). Đơn vẫn `completed`; lượt mã giảm giá không đổi.
 */

const DAY = 24 * 60 * 60_000

/** Loại yêu cầu chiếm số lượng của dòng đơn: hàng đang (hay đã) được trả, đổi. */
const RETURNING_KINDS = ['return', 'exchange'] as const

/**
 * Số còn trả (hay đổi) được của từng dòng đơn: số lượng dòng trừ số đã nằm trong các yêu cầu trả/đổi. Không tính: yêu
 * cầu đã kết thúc mà chưa nhận hàng (từ chối, hay nhân viên đóng khi hàng chưa về), và yêu cầu đổi đã giao hàng mới
 * (khách lại đang giữ hàng, trả hay đổi tiếp được; ADR 0015). Hàng đã nhận về luôn được tính, dù yêu cầu kết thúc thế nào.
 * Gọi dưới khóa đơn.
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

/** Số khách còn giữ của từng dòng đơn: số lượng dòng trừ số cửa hàng đã nhận về qua yêu cầu trả. */
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
  /** Biến thể khách đang giữ (kho nhận về biến thể này). */
  heldVariantId: string
  /** Đổi hàng: biến thể khách nhận. */
  exchangeVariantId: string | null
}

/**
 * Đối chiếu các dòng khách chọn (theo biến thể gốc của dòng đơn) với đơn, kiểm số còn trả/đổi được; với đổi hàng kiểm
 * thêm biến thể đổi sang (ADR 0015). Sai thì 400 hay 409.
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
      // Đổi cả dòng: mọi cái khách đang giữ của dòng cùng một biến thể, nên lần trả hay đổi sau nhận về đúng biến thể.
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
 * Hạn đổi trả chụp lúc gửi (GLOSSARY "Hạn đổi trả"): số ngày nhỏ nhất trong các nhóm hàng của các dòng (nhóm không cấu
 * hình thì không tính; không nhóm nào cấu hình thì `null`), lúc giao (sự kiện `delivered` gần nhất), số ngày đã quá.
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
 * Số hoàn gợi ý của một yêu cầu trả: Σ (giá × số trả − phần giảm của dòng × số trả / số lượng dòng, làm tròn xuống tới
 * đồng). Không gồm phí giao (spec M6b).
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

/** Yêu cầu trả đã nhận hàng mà chưa đề xuất hoàn: số hoàn gợi ý và số còn hoàn được của đơn, cho trang quản trị. */
export async function returnRefundHint(db: DbClient, request: SupportForView) {
  if (request.kind !== 'return' || !request.receivedAt || isClosed(request.status) || !request.orderId) return null
  const [suggested, totals] = [await suggestedReturnRefund(db, request.id), await refundTotals(db, request.orderId)]
  return { suggested: Number(suggested), refundable: Number(totals.refundable) }
}

/**
 * Nhân viên chấp nhận hay từ chối yêu cầu trả (đổi, bảo hành), kèm tin cho khách: chấp nhận thì yêu cầu đang xử lý, gửi
 * email hướng dẫn; từ chối thì yêu cầu kết thúc, gửi email lý do. Đã quyết rồi thì 409. Trả mã yêu cầu.
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
  // Đổi hàng: chấp nhận thì kiểm lại và giữ hàng biến thể mới ngay, để không bị bán mất (ADR 0015).
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
      // Người quyết định nhận việc nếu chưa ai nhận.
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
 * Kho nhận hàng khách gửi về cho yêu cầu trả (ticket 05 dùng lại cho đổi hàng): mỗi dòng của yêu cầu có đúng một mục,
 * nhập lại tồn + ghi hỏng = số lượng dòng (sai thì 400). Phần nhập lại qua `changeStock` loại `return`, trỏ về đơn và yêu
 * cầu, vào biến thể khách đang giữ; phần hỏng không ghi sổ (hàng đã rời tồn lúc bàn giao). Chỉ sau khi chấp nhận, một lần.
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
    // Biến thể khách đang giữ lúc gửi: biến thể gốc, hay biến thể nhận được ở lần đổi trước.
    return { line, entry, variantId: line.heldVariantId, index }
  })

  const restocking = plan.filter((p) => p.entry.restocked > 0)
  if (restocking.length > 0) {
    await changeStock(
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
 * Đề xuất hoàn cho yêu cầu trả đã nhận hàng về: số hoàn trong [0, còn hoàn được của đơn]; thấp hơn gợi ý thì ghi chú bắt
 * buộc. Hoàn > 0 thì tạo khoản hoàn chờ kế toán thực hiện (`origin = return`, ADR 0014). Yêu cầu xong, khách nhận email
 * kèm số tiền. Khóa đơn trước rồi mới khóa yêu cầu, cùng thứ tự với hủy đơn. Trả mã yêu cầu.
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

/** Hạn đổi trả của đủ năm nhóm hàng; nhóm chưa cấu hình là `null`. */
export async function loadReturnWindows(db: DbClient): Promise<ReturnWindowItem[]> {
  const rows = await db.returnWindow.findMany()
  return ProductTypes.options.map((productType: ProductType) => ({
    productType,
    days: rows.find((r) => r.productType === productType)?.days ?? null,
  }))
}

/** Lưu hạn đổi trả: `null` là bỏ cấu hình nhóm đó. Không đổi gì thì không ghi audit. */
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
    // Một bảng cấu hình chung, như phí giao: id cố định.
    entityId: 'return_window',
    before: { items: before },
    after: { items: await loadReturnWindows(tx) },
  })
}
