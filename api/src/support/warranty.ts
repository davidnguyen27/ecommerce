import type { RecordWarrantyMilestone, RecordWarrantyOutcome, WarrantyView } from '@ecommerce/shared'
import type { Audit } from '../core/audit/audited.ts'
import type { DbClient } from '../core/db.ts'
import { invalidField } from '../core/errors.ts'
import type { CustomerMail } from '../core/jobs/jobs.ts'
import { reserveStock } from '../stock/stock.ts'
import { heldVariants } from './exchanges.ts'
import { returnWindowSnapshot, returnableQuantities } from './returns.ts'
import { SUPPORT_INCLUDE, conflict, isClosed, lockSupportRequest, notFound, type SupportForView } from './support.ts'
import { queueSupportEmail } from './emails.ts'

/**
 * Warranty (spec M6b ticket 06): the customer reports a defect on a delivered line. Staff record milestones: item
 * received → sent to the brand or repaired → returned to the customer (tracking number), then the outcome. No
 * milestone touches stock: the customer's item is not shop stock. "Replaced" or "refunded" creates a follow-up exchange
 * or return, already accepted and treated as received.
 */

/** Warranty line: order line by original variant, quantity within the line, the variant the customer holds. */
export async function planWarrantyLine(
  tx: DbClient,
  orderId: string,
  lines: readonly { variantId: string; quantity: number }[],
) {
  const [line] = lines
  if (!line || lines.length !== 1) throw invalidField('lines', 'Chọn một sản phẩm cần bảo hành')
  const orderLine = await tx.orderLine.findFirst({
    where: { orderId, variantId: line.variantId },
    select: { id: true, variantId: true, quantity: true },
  })
  if (!orderLine) throw invalidField('lines.0', 'Sản phẩm này không có trong đơn')
  if (line.quantity > orderLine.quantity) {
    throw invalidField('lines.0', `Đơn chỉ có ${orderLine.quantity} sản phẩm này`)
  }
  const held = await heldVariants(tx, [orderLine])
  return { orderLineId: orderLine.id, quantity: line.quantity, heldVariantId: held.get(orderLine.id)! }
}

/** Warranty milestones and outcome as customers and staff see them; `null` for other types. */
export function warrantyOf(request: SupportForView): WarrantyView | null {
  if (request.kind !== 'warranty') return null
  const { warrantyReturnCarrier: carrier, warrantyReturnTrackingNumber: trackingNumber } = request
  return {
    receivedAt: request.warrantyReceivedAt?.toISOString() ?? null,
    sentAt: request.warrantySentAt?.toISOString() ?? null,
    returnedAt: request.warrantyReturnedAt?.toISOString() ?? null,
    returnShipment: carrier && trackingNumber ? { carrier, trackingNumber } : null,
    outcome: request.warrantyOutcome,
    outcomeNote: request.warrantyOutcomeNote,
  }
}

/** Whether the line's product has a `warranty` commitment (ADR 0005); `null` for other types. */
export async function hasWarrantyCommitment(db: DbClient, request: SupportForView) {
  const productId = request.kind === 'warranty' ? request.lines[0]?.orderLine.variant.productId : undefined
  if (!productId) return null
  const count = await db.productCommitment.count({ where: { productId, type: { kind: 'warranty' } } })
  return count > 0
}

const MILESTONE_MESSAGES = {
  received: 'Cửa hàng đã nhận sản phẩm bạn gửi bảo hành.',
  sent: 'Cửa hàng đã gửi sản phẩm của bạn đi bảo hành (gửi hãng hoặc sửa).',
} as const

/**
 * Records a warranty milestone (`support.handle`) in order: received → sent/repaired → returned. Wrong order, a
 * repeated milestone, or a finished request gives 409. Each milestone adds a customer message; returning emails the
 * tracking number.
 */
export async function recordWarrantyMilestone(
  tx: DbClient,
  mail: CustomerMail,
  audit: Audit,
  code: number,
  staffId: string,
  input: RecordWarrantyMilestone,
) {
  const request = await lockSupportRequest(tx, { code })
  if (request.kind !== 'warranty') throw conflict('Chỉ ghi mốc cho yêu cầu bảo hành')
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc')
  if (request.warrantyOutcome) throw conflict('Bảo hành đã có kết quả')
  const now = new Date()
  const previousMissing = {
    received: null,
    sent: request.warrantyReceivedAt ? null : 'Chưa ghi nhận hàng của khách',
    returned: request.warrantySentAt ? null : 'Chưa ghi gửi hãng hay sửa',
  }[input.milestone]
  const already = {
    received: request.warrantyReceivedAt,
    sent: request.warrantySentAt,
    returned: request.warrantyReturnedAt,
  }[input.milestone]
  if (already) throw conflict('Mốc này đã được ghi')
  if (previousMissing) throw conflict(`${previousMissing}, chưa ghi mốc này được`)

  const data =
    input.milestone === 'received'
      ? { warrantyReceivedAt: now }
      : input.milestone === 'sent'
        ? { warrantySentAt: now }
        : {
            warrantyReturnedAt: now,
            warrantyReturnCarrier: input.carrier.trim(),
            warrantyReturnTrackingNumber: input.trackingNumber.trim(),
          }
  const message =
    input.milestone === 'returned'
      ? `Cửa hàng đã gửi trả sản phẩm cho bạn qua ${input.carrier.trim()}, mã vận đơn ${input.trackingNumber.trim()}.`
      : MILESTONE_MESSAGES[input.milestone]
  await tx.supportRequest.update({
    where: { id: request.id },
    // Staff are now working on the customer's item: the request is in progress.
    data: { ...data, ...(request.status === 'new' && { status: 'in_progress' }) },
  })
  await tx.supportMessage.create({ data: { requestId: request.id, author: 'staff', staffId, body: message } })
  await audit({
    action: 'support.warranty_milestone',
    entityType: 'support_request',
    entityId: request.id,
    after: { code, ...input },
  })
  if (input.milestone === 'returned') {
    const updated = await tx.supportRequest.findUniqueOrThrow({ where: { id: request.id }, include: SUPPORT_INCLUDE })
    await queueSupportEmail(tx, mail, updated, 'reply', message)
  }
  return code
}

const OUTCOME_MESSAGES = {
  repaired: 'Sản phẩm của bạn đã được bảo hành xong.',
  replaced: 'Cửa hàng sẽ đổi sản phẩm mới cho bạn',
  refunded: 'Cửa hàng sẽ hoàn tiền sản phẩm này cho bạn',
} as const

/**
 * Records the warranty outcome (`support.handle`), once:
 * - `repaired`: must be returned to the customer first;
 * - `rejected`: needs a reason (schema-checked); the request becomes `rejected`;
 * - `replaced`/`refunded`: must be received; creates an exchange to the same variant (reserved now) or a return,
 *   accepted and treated as received (written off, not restocked), linked to the warranty request. The warehouse only
 *   hands over the exchange; staff propose the return refund as usual.
 * Locks the order before the request (same order as returns). Returns the warranty request code.
 */
export async function recordWarrantyOutcome(
  tx: DbClient,
  mail: CustomerMail,
  audit: Audit,
  code: number,
  staffId: string,
  input: RecordWarrantyOutcome,
) {
  const found = await tx.supportRequest.findUnique({ where: { code }, select: { orderId: true } })
  if (!found) throw notFound()
  if (found.orderId) await tx.$queryRaw`SELECT "id" FROM "order" WHERE "id" = ${found.orderId}::uuid FOR UPDATE`
  const request = await lockSupportRequest(tx, { code })
  if (request.kind !== 'warranty') throw conflict('Chỉ ghi kết quả cho yêu cầu bảo hành')
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc')
  if (request.warrantyOutcome) throw conflict('Bảo hành đã có kết quả')
  if (input.outcome === 'repaired' && !request.warrantyReturnedAt) {
    throw conflict('Chưa trả lại sản phẩm cho khách, chưa ghi "đã sửa" được')
  }
  if ((input.outcome === 'replaced' || input.outcome === 'refunded') && !request.warrantyReceivedAt) {
    throw conflict('Chưa nhận sản phẩm của khách, chưa đổi mới hay hoàn tiền được')
  }
  const note = input.note?.trim() || null
  const followUp =
    input.outcome === 'replaced' || input.outcome === 'refunded'
      ? await createFollowUp(tx, request, input.outcome === 'replaced' ? 'exchange' : 'return', staffId)
      : null
  const message =
    input.outcome === 'rejected'
      ? note!
      : [
          OUTCOME_MESSAGES[input.outcome] + (followUp ? ` theo yêu cầu #YC${followUp.code}.` : ''),
          ...(note ? [note] : []),
        ].join('\n\n')
  const status = input.outcome === 'rejected' ? 'rejected' : 'resolved'
  await tx.supportRequest.update({
    where: { id: request.id },
    data: { warrantyOutcome: input.outcome, warrantyOutcomeNote: note, status, resolvedAt: new Date() },
  })
  await tx.supportMessage.create({ data: { requestId: request.id, author: 'staff', staffId, body: message } })
  await audit({
    action: 'support.warranty_outcome',
    entityType: 'support_request',
    entityId: request.id,
    after: { code, outcome: input.outcome, note, followUpCode: followUp?.code ?? null },
  })
  const updated = await tx.supportRequest.findUniqueOrThrow({ where: { id: request.id }, include: SUPPORT_INCLUDE })
  await queueSupportEmail(tx, mail, updated, status, message)
  return code
}

/**
 * Follow-up exchange (to the held variant) or return of a warranty request. The line must still be returnable (under
 * the order lock); an exchange reserves at once, and a shortage gives 409 so staff can refund instead.
 */
async function createFollowUp(tx: DbClient, warranty: SupportForView, kind: 'exchange' | 'return', staffId: string) {
  const line = warranty.lines[0]!
  const orderId = warranty.orderId!
  const available = (await returnableQuantities(tx, orderId)).get(line.orderLineId) ?? 0
  if (line.quantity > available) {
    throw conflict(`${line.orderLine.sku}: chỉ còn trả hay đổi được ${available} cái (đã nằm trong yêu cầu khác)`)
  }
  if (kind === 'exchange') {
    const reservation = await reserveStock(tx, [{ variantId: line.heldVariantId, quantity: line.quantity }])
    if (!reservation.ok) throw conflict(`${line.heldVariant.sku} không còn đủ hàng để đổi mới; có thể chọn hoàn tiền`)
  }
  const window = await returnWindowSnapshot(tx, orderId, [{ orderLineId: line.orderLineId }])
  const now = new Date()
  const body =
    kind === 'exchange'
      ? `Đổi sản phẩm mới theo kết quả bảo hành #YC${warranty.code}. Cửa hàng đã giữ sản phẩm cũ; kho sẽ gửi sản phẩm mới.`
      : `Hoàn tiền theo kết quả bảo hành #YC${warranty.code}. Cửa hàng đã giữ sản phẩm cũ và sẽ báo số tiền hoàn.`
  return tx.supportRequest.create({
    data: {
      kind,
      status: 'in_progress',
      subject: `${kind === 'exchange' ? 'Đổi mới' : 'Hoàn tiền'} theo bảo hành #YC${warranty.code}`,
      orderId,
      customerId: warranty.customerId,
      contactEmail: warranty.contactEmail,
      contactName: warranty.contactName,
      assigneeId: warranty.assigneeId ?? staffId,
      createdBy: 'staff',
      createdByStaffId: staffId,
      previousRequestId: warranty.id,
      decision: 'accepted',
      decidedById: staffId,
      decidedAt: now,
      // The old item has been at the shop since the warranty milestone: treat as received, written off (not restocked).
      receivedAt: now,
      receivedById: staffId,
      returnWindowDays: window.days,
      deliveredAt: window.deliveredAt,
      overdueDays: window.overdueDays,
      messages: { create: { author: 'staff', staffId, body } },
      lines: {
        create: {
          orderLineId: line.orderLineId,
          quantity: line.quantity,
          reason: kind === 'return' ? 'defective' : null,
          heldVariantId: line.heldVariantId,
          receivedVariantId: line.heldVariantId,
          writtenOffQuantity: line.quantity,
          ...(kind === 'exchange' && { exchangeVariantId: line.heldVariantId, reservedQuantity: line.quantity }),
        },
      },
    },
    select: { code: true },
  })
}
