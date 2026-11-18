import {
  ErrorCode,
  canRequestCancel,
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
import type { Storage } from '../adapters/storage.ts'
import type { Audit } from '../audit/audited.ts'
import { ACTOR_SELECT } from '../audit/audited.ts'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import { permissionsOf } from '../auth/permissions.ts'
import type { DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import type { CustomerMail } from '../jobs/jobs.ts'
import { DOCUMENT_URL_TTL_SECONDS } from '../media/documents.ts'
import { toPublicRefunds } from '../orders/orders.ts'
import { releaseExchange } from './exchanges.ts'
import { planReturnLines, returnWindowSnapshot } from './returns.ts'
import { planWarrantyLine, warrantyOf } from './warranty.ts'

/**
 * Yêu cầu hỗ trợ (GLOSSARY, spec M6b): việc khách nhờ cửa hàng xử lý, gồm chuỗi tin, người phụ trách và trạng thái
 * `new` → `in_progress` ⇄ `waiting_customer` → `resolved` hoặc `rejected` (kết thúc, không mở lại). Mọi thay đổi chạy
 * dưới khóa dòng yêu cầu `FOR UPDATE`; tạo yêu cầu khóa đơn (hay tài khoản) để đếm yêu cầu đang mở cho đúng.
 */

/** Tối đa số yêu cầu chưa kết thúc trên một đơn, hay trên một tài khoản với yêu cầu không gắn đơn (số tạm). */
export const MAX_OPEN_REQUESTS = 3

export const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy yêu cầu')
export const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)
export const isClosed = (status: SupportRequestStatus) => SUPPORT_CLOSED_STATUSES.includes(status)

/** Đủ để dựng yêu cầu như khách hay nhân viên thấy. */
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

/** Ảnh của một tin kèm URL ký 5 phút (bucket private), chỉ dựng khi trả cho người đã được phép xem yêu cầu. */
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

/** Yêu cầu như khách thấy: không có ghi chú nội bộ (cả ảnh của ghi chú), người phụ trách hay tên nhân viên. */
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

/** Lần giao hàng đổi (ADR 0015), khi đã bàn giao. */
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
    // Nhân viên thấy cả ghi chú nội bộ, nên tin cuối là tin cuối bất kỳ.
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
      // Biến thể khách đang giữ lúc gửi (lần đổi gần nhất đã giao, hay biến thể gốc): kho nhận về đúng biến thể này.
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
    // Route điền (cần đọc cam kết của sản phẩm).
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
    // Route điền khi đã nhận hàng mà chưa đề xuất hoàn (cần đọc thêm DB).
    returnRefund: null,
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

/** Tài khoản khách của yêu cầu không gắn đơn; tên liên hệ lấy từ địa chỉ nhận hàng gần nhất (tài khoản không có tên). */
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

/** Ai tạo yêu cầu: khách (đăng nhập hay cầm link đơn), nhân viên tạo hộ, hay hệ thống. */
export type SupportCreator = { type: 'customer' } | { type: 'staff'; staffId: string } | { type: 'system' }

export type NewSupportRequest = {
  kind: SupportRequestKind
  subject: string
  message: string
  /** Đơn của yêu cầu; khách và email liên hệ lấy từ đơn. */
  order?: { id: string; code: number; email: string; recipientName: string; customerId: string | null }
  /** Tài khoản khách, khi yêu cầu không gắn đơn. */
  customer?: SupportCustomer
  previousRequestCode?: number
  /** Trả hàng: các dòng theo biến thể, số lượng, lý do (ticket 04). */
  lines?: readonly { variantId: string; quantity: number; reason?: SupportReturnReason; toVariantId?: string }[]
  creator: SupportCreator
}

/**
 * Tạo yêu cầu cùng tin đầu tiên, rồi xếp email "đã nhận yêu cầu". Khóa đơn (hay tài khoản) `FOR UPDATE` rồi đếm yêu cầu
 * chưa kết thúc: đủ `MAX_OPEN_REQUESTS` thì 409. Yêu cầu trước đó phải của cùng đơn (hay tài khoản) và đã kết thúc.
 * Trả yêu cầu vừa tạo.
 */
export async function createSupportRequest(tx: DbClient, mail: CustomerMail, input: NewSupportRequest) {
  const { order, customer } = input
  if (!order && !customer) throw new Error('Yêu cầu cần đơn hoặc tài khoản khách')
  const owner: Prisma.SupportRequestWhereInput = order
    ? { orderId: order.id }
    : { customerId: customer!.id, orderId: null }
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
    if (aboutGoods && !(locked!.status === 'completed' && locked!.fulfillmentStatus === 'delivered')) {
      throw conflict(
        input.kind === 'warranty'
          ? 'Chỉ báo bảo hành được với đơn đã giao xong'
          : 'Chỉ trả hay đổi được hàng của đơn đã giao xong',
      )
    }
  } else await tx.$queryRaw`SELECT "id" FROM "customer" WHERE "id" = ${customer!.id}::uuid FOR UPDATE`

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

  // Trả hàng: dòng hợp lệ, số lượng còn trả được (dưới khóa đơn), hạn đổi trả chụp lúc gửi.
  const goodsKind = input.kind === 'return' || input.kind === 'exchange' ? input.kind : null
  const returnLines = goodsKind ? await planReturnLines(tx, order!.id, goodsKind, input.lines ?? []) : []
  const window = goodsKind ? await returnWindowSnapshot(tx, order!.id, returnLines) : null
  // Bảo hành: đúng một dòng, không chiếm số còn trả/đổi được của dòng.
  const warrantyLine = input.kind === 'warranty' ? await planWarrantyLine(tx, order!.id, input.lines ?? []) : null

  const staffId = input.creator.type === 'staff' ? input.creator.staffId : null
  const created = await tx.supportRequest.create({
    data: {
      kind: input.kind,
      subject: input.subject,
      orderId: order?.id ?? null,
      customerId: order ? order.customerId : customer!.id,
      contactEmail: order?.email ?? customer!.email,
      contactName: order?.recipientName ?? customer?.name ?? null,
      createdBy: input.creator.type,
      createdByStaffId: staffId,
      previousRequestId,
      messages: { create: { author: input.creator.type, staffId, body: input.message } },
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

/** Khóa dòng yêu cầu `FOR UPDATE` rồi đọc lại dưới khóa. */
export async function lockSupportRequest(tx: DbClient, where: Prisma.SupportRequestWhereInput) {
  const found = await tx.supportRequest.findFirst({ where, select: { id: true } })
  if (!found) throw notFound()
  await tx.$queryRaw`SELECT "id" FROM "support_request" WHERE "id" = ${found.id}::uuid FOR UPDATE`
  return tx.supportRequest.findUniqueOrThrow({ where: { id: found.id }, include: SUPPORT_INCLUDE })
}

/**
 * Khách gửi tin vào yêu cầu của mình (`where` đã giới hạn theo tài khoản hay theo đơn của token). Yêu cầu đã kết thúc
 * thì 409. Đang chờ khách thì về đang xử lý. Không gửi email cho nhân viên (spec M6b).
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
 * Nhân viên trả lời, ghi chú nội bộ, và/hoặc chuyển trạng thái. Phải có tin hoặc trạng thái mới; yêu cầu đã kết thúc
 * thì 409. Email: tin gửi khách thì gửi email trả lời (kèm trạng thái kết thúc nếu có); chỉ kết thúc thì gửi email
 * kết thúc; ghi chú nội bộ không gửi gì. Audit `support.reply`, `support.note`, `support.status`.
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
  // Không có tin và trạng thái không đổi: không ghi gì (CODING_STANDARDS "Ghi dữ liệu ở API quản trị").
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
  // Đổi hàng đóng trước khi nhận hàng cũ: nhả hàng đang giữ cho biến thể mới (ADR 0015).
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
 * Nhân viên nhận yêu cầu về mình: chỉ khi chưa ai nhận (hay đã là của mình). Yêu cầu mới thành đang xử lý. Yêu cầu đã
 * có người khác nhận thì 409: owner giao lại bằng `assignSupportRequest`.
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
 * Owner giao yêu cầu cho một nhân viên (hay bỏ giao với `null`). Người được giao phải còn hoạt động và có
 * `support.handle`. Không đổi gì thì không ghi audit.
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

/**
 * Link trang yêu cầu gửi trong email. Yêu cầu của tài khoản: trang tài khoản. Yêu cầu của đơn vãng lai: trang yêu cầu
 * kèm mã đơn và token tra cứu đơn mới (chỉ lưu hash) như email đơn hàng.
 */
async function requestUrl(tx: DbClient, siteUrl: string, request: SupportForView) {
  if (request.customerId) return new URL(`/tai-khoan/yeu-cau/${request.code}`, siteUrl).toString()
  const token = newOpaqueToken()
  await tx.orderLookupToken.create({ data: { orderId: request.orderId!, tokenHash: hashOpaqueToken(token) } })
  const url = new URL(`/yeu-cau/${request.code}`, siteUrl)
  url.searchParams.set('don', String(request.order!.code))
  url.searchParams.set('token', token)
  return url.toString()
}

export type SupportEmail = 'created' | 'reply' | 'accepted' | 'resolved' | 'rejected'

/**
 * Xếp email cho khách trong transaction của thay đổi; `message` là lời của nhân viên kèm theo (trả lời, hướng dẫn gửi
 * hàng, lý do từ chối, số tiền hoàn). Nội dung là bản nháp, chờ chủ doanh nghiệp duyệt.
 */
export async function queueSupportEmail(
  tx: DbClient,
  { emails, siteUrl }: CustomerMail,
  request: SupportForView,
  kind: SupportEmail,
  message?: string,
) {
  const link = await requestUrl(tx, siteUrl, request)
  const title = `#YC${request.code} ${request.subject}`
  const subjects: Record<SupportEmail, string> = {
    created: `Đã nhận yêu cầu ${title}`,
    reply: `Cửa hàng đã trả lời yêu cầu ${title}`,
    accepted: `Yêu cầu ${title} đã được chấp nhận`,
    resolved: `Yêu cầu ${title} đã được xử lý xong`,
    rejected: `Yêu cầu ${title} không được chấp nhận`,
  }
  const closingLine =
    request.status === 'resolved'
      ? 'Yêu cầu đã được xử lý xong.'
      : request.status === 'rejected'
        ? 'Yêu cầu đã được đóng.'
        : null
  const body: Record<SupportEmail, string[]> = {
    created: ['Chúng tôi đã nhận yêu cầu của bạn và sẽ phản hồi sớm.'],
    reply: ['Cửa hàng đã trả lời:', '', message ?? '', ...(closingLine ? ['', closingLine] : [])],
    accepted: ['Cửa hàng đã chấp nhận yêu cầu của bạn:', '', message ?? ''],
    resolved: ['Yêu cầu của bạn đã được xử lý xong.', ...(message ? ['', message] : [])],
    rejected: message
      ? ['Yêu cầu của bạn không được chấp nhận:', '', message]
      : ['Yêu cầu của bạn không được chấp nhận. Xem trao đổi trong yêu cầu để biết lý do.'],
  }
  await emails.sendEmail(tx, {
    to: request.contactEmail,
    subject: subjects[kind],
    text: [`Chào ${request.contactName ?? 'bạn'},`, '', ...body[kind], '', `Xem và trả lời yêu cầu: ${link}`].join(
      '\n',
    ),
  })
}

/** Ảnh chỉ gắn được vào tin của chính mình, trong khoảng này sau khi gửi tin (spec M6b ticket 02). */
export const ATTACH_WINDOW_MS = 30 * 60_000

/** Ai gắn ảnh: khách (tin của khách), hay một nhân viên (tin của chính nhân viên đó). */
export type AttachmentAuthor = { type: 'customer' } | { type: 'staff'; staffId: string }

/**
 * Ghi một ảnh đã lưu vào tin `messageId` của yêu cầu (`where` giới hạn theo người xem). Dưới khóa dòng yêu cầu: yêu cầu
 * chưa kết thúc; tin của chính người gắn, gửi chưa quá 30 phút; tin chưa đủ 5 ảnh và yêu cầu chưa đủ 20 ảnh. Sai thì
 * 404 (tin lạ) hay 409; nơi gọi xóa file đã lưu khi lỗi. Trả id yêu cầu.
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
 * Đơn vừa được hủy (`cancelPaidOrder`): mọi yêu cầu hủy đang mở của đơn thành `resolved` kèm một tin hệ thống, trong
 * cùng transaction. Không gửi email: khách đã nhận email "Đơn đã hủy" (spec M6b ticket 03). Trả mã các yêu cầu đã đóng.
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
