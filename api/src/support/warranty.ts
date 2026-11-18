import type { RecordWarrantyMilestone, RecordWarrantyOutcome, WarrantyView } from '@ecommerce/shared'
import type { Audit } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import { invalidField } from '../http/errors.ts'
import type { CustomerMail } from '../jobs/jobs.ts'
import { reserveStock } from '../stock/stock.ts'
import { heldVariants } from './exchanges.ts'
import { returnWindowSnapshot, returnableQuantities } from './returns.ts'
import { SUPPORT_INCLUDE, conflict, isClosed, lockSupportRequest, notFound, type SupportForView } from './support.ts'
import { queueSupportEmail } from './emails.ts'

/**
 * Bảo hành (spec M6b ticket 06): khách báo lỗi một dòng của đơn đã giao. Nhân viên ghi các mốc nhận hàng của khách →
 * gửi hãng hay sửa → trả lại khách (mã vận đơn), rồi kết quả. Không mốc nào đụng tới tồn: hàng của khách không phải hàng
 * của cửa hàng. Kết quả "đổi mới" hay "hoàn tiền" tạo yêu cầu đổi hay trả nối tiếp, đã chấp nhận và coi như đã nhận hàng.
 */

/** Dòng bảo hành: dòng đơn theo biến thể gốc, số lượng không quá số của dòng, biến thể khách đang giữ. */
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

/** Mốc và kết quả bảo hành như khách và nhân viên thấy; `null` với loại khác. */
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

/** Sản phẩm của dòng bảo hành có cam kết loại `warranty` (ADR 0005) không; `null` với loại khác. */
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
 * Ghi một mốc bảo hành (`support.handle`), đúng thứ tự: nhận hàng → gửi hãng/sửa → trả lại khách. Sai thứ tự, ghi lại mốc
 * đã có, hay yêu cầu đã kết thúc thì 409. Mỗi mốc thêm một tin cho khách; trả lại khách thì gửi email kèm mã vận đơn.
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
    // Nhân viên đang làm việc với hàng của khách: yêu cầu đang xử lý.
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
 * Ghi kết quả bảo hành (`support.handle`), một lần:
 * - `repaired`: cần đã trả lại khách;
 * - `rejected`: cần lý do (schema kiểm); yêu cầu `rejected`;
 * - `replaced`/`refunded`: cần đã nhận hàng; tạo yêu cầu đổi cùng biến thể (giữ hàng ngay) hay yêu cầu trả, đã chấp nhận
 *   và coi như đã nhận hàng (ghi hỏng, không nhập lại tồn), nối với yêu cầu bảo hành. Kho chỉ còn bàn giao hàng đổi; nhân
 *   viên đề xuất hoàn cho yêu cầu trả như thường.
 *
 * Khóa đơn trước rồi mới khóa yêu cầu (cùng thứ tự với trả hàng). Trả mã yêu cầu bảo hành.
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
 * Yêu cầu đổi (cùng biến thể khách đang giữ) hay trả nối tiếp yêu cầu bảo hành. Dòng phải còn trả/đổi được (dưới khóa
 * đơn); đổi thì giữ hàng ngay, thiếu thì 409 để nhân viên chọn hoàn tiền.
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
      // Hàng cũ đã ở cửa hàng từ mốc bảo hành: coi như đã nhận, ghi hỏng (không nhập lại tồn).
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
