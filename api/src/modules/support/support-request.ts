import {
  ErrorCode,
  canRequestCancel,
  isDelivered,
  type FulfillmentStatus,
  type OrderStatus,
  type PaymentStatus,
  SUPPORT_CLOSED_STATUSES,
  SUPPORT_IMAGES_PER_MESSAGE,
  SUPPORT_IMAGES_PER_REQUEST,
  ShippingAddress,
  type SupportAttachmentView,
  type AdminSupportReply,
  type AdminSupportRequest,
  type AdminSupportSummary,
  type PublicSupportRequest,
  type PublicSupportSummary,
  type SupportRequestKind,
  type SupportRequestStatus,
  type SupportReturnReason,
} from '@ecommerce/shared'
import type { Storage } from '../../core/adapters/storage.ts'
import type { Audit } from '../../core/audit/audited.ts'
import { ACTOR_SELECT } from '../../core/audit/audited.ts'
import { permissionsOf } from '../../core/auth/permissions.ts'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { AppError, invalidField } from '../../core/errors.ts'
import type { CustomerMail } from '../../core/jobs/queues.ts'
import { DOCUMENT_URL_TTL_SECONDS } from '../../core/media/documents.ts'
import { toPublicRefunds } from '../order/index.ts'
import { queueSupportEmail } from './support-email.ts'
import { releaseExchange } from './support-exchange.ts'
import { planReturnLines, returnWindowSnapshot } from './support-return.ts'
import { planWarrantyLine, warrantyOf } from './support-warranty.ts'

/**
 * Support requests (GLOSSARY "Yêu cầu hỗ trợ", spec M6b): what a customer asks the shop to handle, with a message
 * thread, an assignee and status `new` → `in_progress` ⇄ `waiting_customer` → `resolved` or `rejected` (final, never
 * reopened). Every change runs under the request row lock; creation locks the order (or account) to count open
 * requests correctly.
 */

/** Max unfinished requests per order, or per account for requests without an order (provisional). */
export const MAX_OPEN_REQUESTS = 3

export const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy yêu cầu')
export const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)
export const isClosed = (status: SupportRequestStatus) => SUPPORT_CLOSED_STATUSES.includes(status)

/** Enough to build a request as customers or staff see it. */
export const SUPPORT_INCLUDE = {
  order: { select: { code: true } },
  assignee: { select: ACTOR_SELECT },
  createdByStaff: { select: ACTOR_SELECT },
  previousRequest: { select: { code: true } },
  followUps: { select: { code: true, kind: true }, orderBy: { code: 'asc' } },
  messages: {
    include: {
      staff: { select: ACTOR_SELECT },
      attachments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  lines: {
    include: {
      orderLine: {
        select: {
          id: true,
          sku: true,
          productName: true,
          variantId: true,
          quantity: true,
          price: true,
          variant: { select: { productId: true } },
        },
      },
      receivedVariant: { select: { id: true, sku: true } },
      heldVariant: { select: { id: true, sku: true } },
      exchangeVariant: { select: { id: true, sku: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  decidedBy: { select: ACTOR_SELECT },
  receivedBy: { select: ACTOR_SELECT },
  refunds: {
    select: { id: true, amount: true, status: true, createdAt: true, completedAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} as const satisfies Prisma.SupportRequestInclude

export type SupportForView = Prisma.SupportRequestGetPayload<{ include: typeof SUPPORT_INCLUDE }>

const publicMessages = (request: SupportForView) => request.messages.filter((m) => !m.internal)

function summary(request: SupportForView): PublicSupportSummary {
  const visible = publicMessages(request)
  return {
    code: request.code,
    kind: request.kind,
    status: request.status,
    subject: request.subject,
    orderCode: request.order?.code ?? null,
    createdAt: request.createdAt.toISOString(),
    lastMessageAt: (visible.at(-1)?.createdAt ?? request.createdAt).toISOString(),
  }
}

type ViewMessage = SupportForView['messages'][number]

/** A message's images with 5-minute signed URLs (private bucket), built only for viewers allowed to see the request. */
async function attachmentsOf(storage: Storage, message: ViewMessage): Promise<SupportAttachmentView[]> {
  return Promise.all(
    message.attachments.map(async (a) => ({
      id: a.id,
      url: await storage.signedUrl(a.key, DOCUMENT_URL_TTL_SECONDS),
      contentType: a.contentType,
      width: a.width,
      height: a.height,
    })),
  )
}

/** A request as customers see it: no internal notes (nor their images), assignee or staff names. */
export async function toPublicSupport(storage: Storage, request: SupportForView): Promise<PublicSupportRequest> {
  return {
    ...summary(request),
    previousRequestCode: request.previousRequest?.code ?? null,
    resolvedAt: request.resolvedAt?.toISOString() ?? null,
    lines: request.lines.map((l) => ({
      id: l.id,
      sku: l.orderLine.sku,
      productName: l.orderLine.productName,
      quantity: l.quantity,
      reason: l.reason,
      toSku: l.exchangeVariant?.sku ?? null,
    })),
    decision: request.decision,
    receivedAt: request.receivedAt?.toISOString() ?? null,
    exchangeShipment: exchangeShipmentOf(request),
    warranty: warrantyOf(request),
    followUps: request.followUps,
    refunds: toPublicRefunds(request.refunds),
    messages: await Promise.all(
      publicMessages(request).map(async (m) => ({
        id: m.id,
        author: m.author,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        attachments: await attachmentsOf(storage, m),
      })),
    ),
  }
}

export const toPublicSupportSummary = summary

/** The exchange delivery (ADR 0015), once handed over. */
function exchangeShipmentOf(request: SupportForView) {
  const { exchangeCarrier, exchangeTrackingNumber, exchangeHandedOverAt } = request
  return exchangeCarrier && exchangeTrackingNumber && exchangeHandedOverAt
    ? {
        carrier: exchangeCarrier,
        trackingNumber: exchangeTrackingNumber,
        handedOverAt: exchangeHandedOverAt.toISOString(),
      }
    : null
}

export function toAdminSupportSummary(request: SupportForView): AdminSupportSummary {
  return {
    ...summary(request),
    // Staff see internal notes too, so the last message is the last of any kind.
    lastMessageAt: (request.messages.at(-1)?.createdAt ?? request.createdAt).toISOString(),
    contactEmail: request.contactEmail,
    contactName: request.contactName,
    assignee: request.assignee,
  }
}

export async function toAdminSupport(storage: Storage, request: SupportForView): Promise<AdminSupportRequest> {
  return {
    ...toAdminSupportSummary(request),
    customerId: request.customerId,
    createdBy: request.createdBy,
    createdByStaff: request.createdByStaff,
    previousRequestCode: request.previousRequest?.code ?? null,
    resolvedAt: request.resolvedAt?.toISOString() ?? null,
    lines: request.lines.map((l) => ({
      id: l.id,
      orderLineId: l.orderLine.id,
      sku: l.orderLine.sku,
      productName: l.orderLine.productName,
      quantity: l.quantity,
      reason: l.reason,
      toSku: l.exchangeVariant?.sku ?? null,
      // The variant held at submit (latest delivered exchange, or the original): the warehouse receives this one.
      heldVariantId: l.heldVariantId,
      heldSku: l.heldVariant.sku,
      restockedQuantity: l.restockedQuantity,
      writtenOffQuantity: l.writtenOffQuantity,
      exchangeVariantId: l.exchangeVariantId,
      reservedQuantity: l.reservedQuantity,
    })),
    decision: request.decision,
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    receivedAt: request.receivedAt?.toISOString() ?? null,
    receivedBy: request.receivedBy,
    exchangeShipment: exchangeShipmentOf(request),
    exchangeOverdueAt: request.exchangeOverdueAt?.toISOString() ?? null,
    warranty: warrantyOf(request),
    // Filled by the route (needs the product's commitments).
    hasWarrantyCommitment: null,
    followUps: request.followUps,
    returnWindow:
      request.kind === 'return' || request.kind === 'exchange'
        ? {
            days: request.returnWindowDays,
            deliveredAt: request.deliveredAt?.toISOString() ?? null,
            overdueDays: request.overdueDays,
          }
        : null,
    // Filled by the route once goods are received without a proposed refund (needs more DB reads).
    returnRefund: null,
    chatTranscript: null,
    refunds: request.refunds.map((r) => ({ id: r.id, amount: Number(r.amount), status: r.status })),
    messages: await Promise.all(
      request.messages.map(async (m) => ({
        id: m.id,
        author: m.author,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        internal: m.internal,
        staff: m.staff,
        attachments: await attachmentsOf(storage, m),
      })),
    ),
  }
}

/**
 * The customer account of a request without an order; contact name from the latest shipping address (accounts have
 * none).
 */
export type SupportCustomer = { id: string; email: string; name: string | null }

export async function findSupportCustomer(db: DbClient, where: Prisma.CustomerWhereUniqueInput) {
  const customer = await db.customer.findUnique({
    where,
    select: { id: true, email: true, lastShippingAddress: true },
  })
  if (!customer) return null
  const address = ShippingAddress.safeParse(customer.lastShippingAddress)
  const name: string | null = address.success ? address.data.recipientName : null
  return { id: customer.id, email: customer.email, name } satisfies SupportCustomer
}

/** Who creates the request: the customer (signed in or with an order link), staff on their behalf, or the system. */
export type SupportCreator =
  { type: 'customer' } | { type: 'staff'; staffId: string } | { type: 'system' } | { type: 'chatbot' }

export type NewSupportRequest = {
  kind: SupportRequestKind
  subject: string
  message: string
  /** The request's order; customer and contact email come from it. */
  order?: { id: string; code: number; email: string; recipientName: string; customerId: string | null }
  /** The customer account, when the request has no order. */
  customer?: SupportCustomer
  /** Name and email only: a guest without an order handed off by the chatbot (M8). Type `other` only. */
  contact?: { name: string; email: string }
  previousRequestCode?: number
  /** Returns: lines by variant, quantity, reason (ticket 04). */
  lines?: readonly { variantId: string; quantity: number; reason?: SupportReturnReason; toVariantId?: string }[]
  creator: SupportCreator
}

/**
 * Creates the request with its first message, then queues the "request received" email. Locks the order (or account)
 * and counts unfinished requests: at `MAX_OPEN_REQUESTS` it is 409. A previous request must belong to the same order
 * (or account) and be finished. Returns the new request.
 */
export async function createSupportRequest(tx: DbClient, mail: CustomerMail, input: NewSupportRequest) {
  const { order, customer, contact } = input
  if (!order && !customer && !contact) throw new Error('Yêu cầu cần đơn, tài khoản khách hoặc liên hệ')
  const owner: Prisma.SupportRequestWhereInput = order
    ? { orderId: order.id }
    : customer
      ? { customerId: customer.id, orderId: null }
      : { contactEmail: contact!.email, orderId: null, customerId: null }
  if (input.kind !== 'other' && !order) throw invalidField('orderCode', 'Yêu cầu này cần gắn với một đơn')
  if (order) {
    const [locked] = await tx.$queryRaw<
      { status: OrderStatus; paymentStatus: PaymentStatus; fulfillmentStatus: FulfillmentStatus }[]
    >`SELECT "status"::text AS status, "payment_status"::text AS "paymentStatus",
        "fulfillment_status"::text AS "fulfillmentStatus"
      FROM "order" WHERE "id" = ${order.id}::uuid FOR UPDATE`
    if (input.kind === 'cancel' && !canRequestCancel(locked!)) {
      throw conflict(
        'Chỉ gửi yêu cầu hủy được khi đơn đã thanh toán (hoặc đã cọc) và chưa giao cho đơn vị vận chuyển. Đơn chưa thanh toán thì bạn tự hủy được ở trang đơn; đơn đã giao đi thì gửi yêu cầu trả hàng sau khi nhận.',
      )
    }
    const aboutGoods = input.kind === 'return' || input.kind === 'exchange' || input.kind === 'warranty'
    if (aboutGoods && !isDelivered(locked!)) {
      throw conflict(
        input.kind === 'warranty'
          ? 'Chỉ báo bảo hành được với đơn đã giao xong'
          : 'Chỉ trả hay đổi được hàng của đơn đã giao xong',
      )
    }
  } else if (customer) await tx.$queryRaw`SELECT "id" FROM "customer" WHERE "id" = ${customer.id}::uuid FOR UPDATE`
  // A contact has no row to lock: lock by email, so two concurrent handoffs cannot exceed the open request limit.
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support_contact:${contact!.email}`}))`

  const open = await tx.supportRequest.count({
    where: { ...owner, status: { notIn: [...SUPPORT_CLOSED_STATUSES] } },
  })
  if (open >= MAX_OPEN_REQUESTS) {
    throw conflict(`Đã có ${open} yêu cầu đang xử lý; vui lòng chờ hoặc gửi thêm tin vào yêu cầu đó`)
  }

  let previousRequestId: string | null = null
  if (input.previousRequestCode !== undefined) {
    const previous = await tx.supportRequest.findFirst({
      where: { ...owner, code: input.previousRequestCode },
      select: { id: true, status: true },
    })
    if (!previous) throw invalidField('previousRequestCode', 'Không tìm thấy yêu cầu trước đó')
    if (!isClosed(previous.status)) throw invalidField('previousRequestCode', 'Yêu cầu trước đó vẫn đang xử lý')
    previousRequestId = previous.id
  }

  // Returns: valid lines, returnable quantities (under the order lock), return window snapshotted at submit.
  const goodsKind = input.kind === 'return' || input.kind === 'exchange' ? input.kind : null
  const returnLines = goodsKind ? await planReturnLines(tx, order!.id, goodsKind, input.lines ?? []) : []
  const window = goodsKind ? await returnWindowSnapshot(tx, order!.id, returnLines) : null
  // Warranty: exactly one line, not taking from the returnable/exchangeable quantity.
  const warrantyLine = input.kind === 'warranty' ? await planWarrantyLine(tx, order!.id, input.lines ?? []) : null

  const staffId = input.creator.type === 'staff' ? input.creator.staffId : null
  const created = await tx.supportRequest.create({
    data: {
      kind: input.kind,
      subject: input.subject,
      orderId: order?.id ?? null,
      customerId: order ? order.customerId : (customer?.id ?? null),
      contactEmail: order?.email ?? customer?.email ?? contact!.email,
      contactName: order?.recipientName ?? customer?.name ?? contact?.name ?? null,
      createdBy: input.creator.type,
      createdByStaffId: staffId,
      previousRequestId,
      // The chatbot only creates the request; the first message is what the customer typed in the handoff form.
      messages: {
        create: {
          author: input.creator.type === 'chatbot' ? 'customer' : input.creator.type,
          staffId,
          body: input.message,
        },
      },
      ...(window && {
        returnWindowDays: window.days,
        deliveredAt: window.deliveredAt,
        overdueDays: window.overdueDays,
      }),
      lines: {
        create: warrantyLine
          ? [warrantyLine]
          : returnLines.map((l) => ({
              orderLineId: l.orderLineId,
              quantity: l.quantity,
              reason: l.reason,
              heldVariantId: l.heldVariantId,
              exchangeVariantId: l.exchangeVariantId,
            })),
      },
    },
    select: { id: true },
  })
  const request = await tx.supportRequest.findUniqueOrThrow({ where: { id: created.id }, include: SUPPORT_INCLUDE })
  await queueSupportEmail(tx, mail, request, 'created')
  return request
}

/** Locks the request row, then rereads it under the lock. */
export async function lockSupportRequest(tx: DbClient, where: Prisma.SupportRequestWhereInput) {
  const found = await tx.supportRequest.findFirst({ where, select: { id: true } })
  if (!found) throw notFound()
  await tx.$queryRaw`SELECT "id" FROM "support_request" WHERE "id" = ${found.id}::uuid FOR UPDATE`
  return tx.supportRequest.findUniqueOrThrow({ where: { id: found.id }, include: SUPPORT_INCLUDE })
}

/**
 * The customer posts to their request (`where` is already scoped to the account or the token's order). Finished
 * requests give 409. Waiting on the customer moves it back in progress. No email to staff (spec M6b).
 */
export async function addCustomerMessage(tx: DbClient, where: Prisma.SupportRequestWhereInput, body: string) {
  const request = await lockSupportRequest(tx, where)
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc; hãy gửi yêu cầu mới nếu cần')
  await tx.supportMessage.create({ data: { requestId: request.id, author: 'customer', body } })
  await tx.supportRequest.update({
    where: { id: request.id },
    data: { status: request.status === 'waiting_customer' ? 'in_progress' : request.status, updatedAt: new Date() },
  })
  return tx.supportRequest.findUniqueOrThrow({ where: { id: request.id }, include: SUPPORT_INCLUDE })
}

/**
 * Staff reply, add an internal note and/or change status. A message or new status is required; finished requests give
 * 409. Email: a customer message sends a reply email (with the final status if any); a status-only finish sends the
 * finish email; internal notes send nothing. Audit `support.reply`, `support.note`, `support.status`.
 */
export async function staffReply(
  tx: DbClient,
  mail: CustomerMail,
  audit: Audit,
  code: number,
  staffId: string,
  input: Pick<AdminSupportReply, 'message' | 'status'> & { internal: boolean },
) {
  if (!input.message && !input.status) throw invalidField('message', 'Nhập nội dung hoặc chọn trạng thái mới')
  if (input.internal && !input.message) throw invalidField('message', 'Ghi chú nội bộ cần nội dung')
  const request = await lockSupportRequest(tx, { code })
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc, không đổi được nữa')
  // No message and no status change: write nothing (CODING_STANDARDS "Ghi dữ liệu ở API quản trị").
  if (!input.message && input.status === request.status) return request

  if (input.message) {
    await tx.supportMessage.create({
      data: { requestId: request.id, author: 'staff', staffId, internal: input.internal, body: input.message },
    })
  }
  const status = input.status ?? request.status
  const closing = isClosed(status)
  if (closing && request.receivedAt) {
    if (status === 'rejected') {
      throw conflict('Đã nhận hàng khách gửi về, không từ chối được nữa; kết thúc yêu cầu bằng "Đã xong"')
    }
    if (request.kind === 'exchange' && !request.exchangeHandedOverAt) {
      throw conflict('Đã nhận hàng cũ của khách: bàn giao hàng đổi trước khi kết thúc yêu cầu')
    }
  }
  // An exchange closed before the old item arrived: release the stock reserved for the new variant (ADR 0015).
  if (closing && request.kind === 'exchange' && !request.exchangeHandedOverAt) await releaseExchange(tx, request.id)
  await tx.supportRequest.update({
    where: { id: request.id },
    data: { status, resolvedAt: closing ? new Date() : null, updatedAt: new Date() },
  })
  const entries = []
  if (input.message) {
    entries.push({
      action: input.internal ? 'support.note' : 'support.reply',
      entityType: 'support_request',
      entityId: request.id,
      after: { code, internal: input.internal, message: input.message },
    })
  }
  if (status !== request.status) {
    entries.push({
      action: 'support.status',
      entityType: 'support_request',
      entityId: request.id,
      before: { status: request.status },
      after: { status },
    })
  }
  await audit(entries)

  const updated = await tx.supportRequest.findUniqueOrThrow({ where: { id: request.id }, include: SUPPORT_INCLUDE })
  if (input.message && !input.internal) await queueSupportEmail(tx, mail, updated, 'reply', input.message)
  else if (closing && status !== request.status) {
    await queueSupportEmail(tx, mail, updated, status === 'resolved' ? 'resolved' : 'rejected')
  }
  return updated
}

/**
 * Staff take a request: only if unassigned (or already theirs). New requests move in progress. Assigned to someone
 * else gives 409: the owner reassigns with `assignSupportRequest`.
 */
export async function claimSupportRequest(tx: DbClient, audit: Audit, code: number, staffId: string) {
  const request = await lockSupportRequest(tx, { code })
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc')
  if (request.assigneeId === staffId) return request
  if (request.assigneeId) throw conflict(`Yêu cầu đã được ${request.assignee!.name} nhận`)
  await tx.supportRequest.update({
    where: { id: request.id },
    data: { assigneeId: staffId, status: request.status === 'new' ? 'in_progress' : request.status },
  })
  await audit({
    action: 'support.assign',
    entityType: 'support_request',
    entityId: request.id,
    before: { assigneeId: null, status: request.status },
    after: { assigneeId: staffId, status: request.status === 'new' ? 'in_progress' : request.status },
  })
  return tx.supportRequest.findUniqueOrThrow({ where: { id: request.id }, include: SUPPORT_INCLUDE })
}

/**
 * The owner assigns a request to a staff member (or unassigns with `null`). The assignee must be active with
 * `support.handle`. No change, no audit.
 */
export async function assignSupportRequest(tx: DbClient, audit: Audit, code: number, assigneeId: string | null) {
  const request = await lockSupportRequest(tx, { code })
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc')
  if (request.assigneeId === assigneeId) return request
  if (assigneeId) {
    const staff = await tx.staff.findUnique({ where: { id: assigneeId }, select: { roles: true, lockedAt: true } })
    if (!staff || staff.lockedAt || !permissionsOf(staff.roles).includes('support.handle')) {
      throw invalidField('staffId', 'Nhân viên này không xử lý được yêu cầu hỗ trợ')
    }
  }
  const status = assigneeId && request.status === 'new' ? 'in_progress' : request.status
  await tx.supportRequest.update({ where: { id: request.id }, data: { assigneeId, status } })
  await audit({
    action: 'support.assign',
    entityType: 'support_request',
    entityId: request.id,
    before: { assigneeId: request.assigneeId, status: request.status },
    after: { assigneeId, status },
  })
  return tx.supportRequest.findUniqueOrThrow({ where: { id: request.id }, include: SUPPORT_INCLUDE })
}

/** Images attach only to your own message, within this time after sending (spec M6b ticket 02). */
export const ATTACH_WINDOW_MS = 30 * 60_000

/** Who attaches: the customer (customer messages) or a staff member (their own messages). */
export type AttachmentAuthor = { type: 'customer' } | { type: 'staff'; staffId: string }

/**
 * Records a stored image on message `messageId` (`where` scoped to the viewer). Under the request row lock: request not
 * finished; the attacher's own message, sent at most 30 minutes ago; under 5 images per message and 20 per request.
 * Otherwise 404 (unknown message) or 409; the caller deletes the stored file on error. Returns the request id.
 */
export async function recordAttachment(
  tx: DbClient,
  where: Prisma.SupportRequestWhereInput,
  messageId: string,
  author: AttachmentAuthor,
  image: { key: string; contentType: string; sizeBytes: number; width: number; height: number },
  now = new Date(),
) {
  const request = await lockSupportRequest(tx, where)
  if (isClosed(request.status)) throw conflict('Yêu cầu đã kết thúc, không gửi thêm ảnh được')
  const message = request.messages.find((m) => m.id === messageId)
  const own =
    message && (author.type === 'customer' ? message.author === 'customer' : message.staffId === author.staffId)
  if (!message || !own) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy tin để gắn ảnh')
  if (now.getTime() - message.createdAt.getTime() > ATTACH_WINDOW_MS) {
    throw conflict('Tin đã gửi quá 30 phút, hãy gửi ảnh kèm một tin mới')
  }
  if (message.attachments.length >= SUPPORT_IMAGES_PER_MESSAGE) {
    throw conflict(`Mỗi tin tối đa ${SUPPORT_IMAGES_PER_MESSAGE} ảnh`)
  }
  const total = request.messages.reduce((sum, m) => sum + m.attachments.length, 0)
  if (total >= SUPPORT_IMAGES_PER_REQUEST) throw conflict(`Mỗi yêu cầu tối đa ${SUPPORT_IMAGES_PER_REQUEST} ảnh`)
  await tx.supportAttachment.create({ data: { requestId: request.id, messageId, ...image } })
  return request.id
}

/**
 * The order was just cancelled (`cancelPaidOrder`): every open cancel request of the order becomes `resolved` with a
 * system message, in the same transaction. No email: the customer already got "Đơn đã hủy" (spec M6b ticket 03).
 * Returns the closed request codes.
 */
export async function resolveCancelRequests(tx: DbClient, orderId: string) {
  const open = await tx.supportRequest.findMany({
    where: { orderId, kind: 'cancel', status: { notIn: [...SUPPORT_CLOSED_STATUSES] } },
    select: { id: true, code: true },
  })
  const now = new Date()
  for (const request of open) {
    await tx.$queryRaw`SELECT "id" FROM "support_request" WHERE "id" = ${request.id}::uuid FOR UPDATE`
    await tx.supportMessage.create({
      data: { requestId: request.id, author: 'system', body: 'Đơn đã được hủy. Xem số tiền hoàn ở trang đơn hàng.' },
    })
    await tx.supportRequest.update({ where: { id: request.id }, data: { status: 'resolved', resolvedAt: now } })
  }
  return open.map((r) => r.code)
}
