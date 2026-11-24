import { PublicRefund } from './refunds.ts'
import { z } from 'zod'
import { ChatMessageView } from './chat.ts'
import { ProductType } from './catalog.ts'
import { PageQuery, pageOf } from './pagination.ts'

/** Support request type (GLOSSARY "Yêu cầu hỗ trợ"); every type except `other` is tied to an order. */
export const SupportRequestKind = z.enum(['cancel', 'return', 'exchange', 'warranty', 'other'])
export type SupportRequestKind = z.infer<typeof SupportRequestKind>

/** New → in progress ⇄ waiting on customer → resolved or rejected (final, never reopened). */
export const SupportRequestStatus = z.enum(['new', 'in_progress', 'waiting_customer', 'resolved', 'rejected'])
export type SupportRequestStatus = z.infer<typeof SupportRequestStatus>

/** Final statuses: no more messages, never reopened. */
export const SUPPORT_CLOSED_STATUSES: readonly SupportRequestStatus[] = ['resolved', 'rejected']

/**
 * Who wrote a message or created a request: customer, staff, system, or chatbot (creates requests only on confirmed
 * handoff).
 */
export const SupportAuthor = z.enum(['customer', 'staff', 'system', 'chatbot'])
export type SupportAuthor = z.infer<typeof SupportAuthor>

const Body = z
  .string({ error: 'Nhập nội dung' })
  .trim()
  .min(1, 'Nhập nội dung')
  .max(5000, 'Nội dung tối đa 5.000 ký tự')
const Subject = z.string({ error: 'Nhập tiêu đề' }).trim().min(1, 'Nhập tiêu đề').max(200, 'Tiêu đề tối đa 200 ký tự')

/** Types customers and staff can create (spec M6b). */
export const CreatableSupportKind = z.enum(['other', 'cancel', 'return', 'exchange', 'warranty'])
export type CreatableSupportKind = z.infer<typeof CreatableSupportKind>

/** Return reason: defective, wrong fit, not as described, other. */
export const SupportReturnReason = z.enum(['defective', 'wrong_fit', 'not_as_described', 'other'])
export type SupportReturnReason = z.infer<typeof SupportReturnReason>

/** A line to return: by the order line's variant (one line per variant per order), quantity and reason. */
export const ReturnLineInput = z.object({
  variantId: z.string(),
  quantity: z.number().int().min(1, 'Số lượng ít nhất là 1').max(5),
  reason: SupportReturnReason,
})
export type ReturnLineInput = z.infer<typeof ReturnLineInput>

/**
 * A line to exchange (ADR 0015): the order line by its original variant, quantity, and the variant wanted (same
 * product, same price, in stock; checked by the API).
 */
export const ExchangeLineInput = z.object({
  variantId: z.string(),
  quantity: z.number().int().min(1, 'Số lượng ít nhất là 1').max(5),
  toVariantId: z.string(),
})
export type ExchangeLineInput = z.infer<typeof ExchangeLineInput>

const ExchangeLines = z
  .array(ExchangeLineInput)
  .min(1, 'Chọn ít nhất một sản phẩm muốn đổi')
  .max(20)
  .refine((lines) => new Set(lines.map((l) => l.variantId)).size === lines.length, {
    message: 'Mỗi sản phẩm chỉ chọn một lần',
  })

/** Warranty: exactly one order line (by original variant) and quantity; the defect description is the first message. */
export const WarrantyLineInput = z.object({
  variantId: z.string(),
  quantity: z.number().int().min(1, 'Số lượng ít nhất là 1').max(5),
})
export type WarrantyLineInput = z.infer<typeof WarrantyLineInput>
const WarrantyLines = z.array(WarrantyLineInput).length(1, 'Chọn một sản phẩm cần bảo hành')

const CreateBase = z.object({
  subject: Subject,
  message: Body,
  /** Follows up one of the customer's own finished requests. */
  previousRequestCode: z.number().int().positive().optional(),
  /**
   * Account page only: ties the request to one of the customer's orders. The lookup link path has the order in the URL.
   */
  orderCode: z.number().int().positive().optional(),
})

const ReturnLines = z
  .array(ReturnLineInput)
  .min(1, 'Chọn ít nhất một sản phẩm muốn trả')
  .max(20)
  .refine((lines) => new Set(lines.map((l) => l.variantId)).size === lines.length, {
    message: 'Mỗi sản phẩm chỉ chọn một lần',
  })

/**
 * Body customers send to create a request, by type: `other`; `cancel` (cancel a paid order, needs an order); `return`,
 * `exchange` (delivered goods, need an order and lines); `warranty` (one line of a delivered order).
 */
export const CreateSupportRequest = z.discriminatedUnion('kind', [
  CreateBase.extend({ kind: z.literal('other') }),
  CreateBase.extend({ kind: z.literal('cancel') }),
  CreateBase.extend({ kind: z.literal('return'), lines: ReturnLines }),
  CreateBase.extend({ kind: z.literal('exchange'), lines: ExchangeLines }),
  CreateBase.extend({ kind: z.literal('warranty'), lines: WarrantyLines }),
])
export type CreateSupportRequest = z.input<typeof CreateSupportRequest>

/** Body customers send to post a message. */
export const SupportMessageRequest = z.object({ message: Body })
export type SupportMessageRequest = z.input<typeof SupportMessageRequest>

/** Attachments: jpeg, png, webp, up to 5 MB each (spec M6b). */
export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** Max images per message and per request. */
export const SUPPORT_IMAGES_PER_MESSAGE = 5
export const SUPPORT_IMAGES_PER_REQUEST = 20

/** An attachment: an expiring signed URL (5 minutes), returned only to those allowed to see the request. */
export const SupportAttachmentView = z.object({
  id: z.string(),
  url: z.string(),
  contentType: z.string(),
  width: z.number(),
  height: z.number(),
})
export type SupportAttachmentView = z.infer<typeof SupportAttachmentView>

/** A message as customers see it: no internal notes, no staff names (customers see "Cửa hàng"). */
export const PublicSupportMessage = z.object({
  id: z.string(),
  author: SupportAuthor,
  body: z.string(),
  createdAt: z.string(),
  attachments: z.array(SupportAttachmentView),
})
export type PublicSupportMessage = z.infer<typeof PublicSupportMessage>

/** A request in the customer's list. */
export const PublicSupportSummary = z.object({
  code: z.number(),
  kind: SupportRequestKind,
  status: SupportRequestStatus,
  subject: z.string(),
  orderCode: z.number().nullable(),
  createdAt: z.string(),
  /** Time of the last message the customer can see. */
  lastMessageAt: z.string(),
})
export type PublicSupportSummary = z.infer<typeof PublicSupportSummary>

export const PublicSupportList = z.object({ items: z.array(PublicSupportSummary) })
export type PublicSupportList = z.infer<typeof PublicSupportList>

/** Request detail as customers see it. */
/** A request line as customers see it: product, quantity, reason. */
export const SupportLineView = z.object({
  id: z.string(),
  sku: z.string(),
  productName: z.string(),
  quantity: z.number(),
  reason: SupportReturnReason.nullable(),
  /** Exchange: SKU of the variant the customer gets. */
  toSku: z.string().nullable(),
})
export type SupportLineView = z.infer<typeof SupportLineView>

export const SupportDecision = z.enum(['accepted', 'rejected'])
export type SupportDecision = z.infer<typeof SupportDecision>

export const WarrantyOutcome = z.enum(['repaired', 'replaced', 'rejected', 'refunded'])
export type WarrantyOutcome = z.infer<typeof WarrantyOutcome>

/** Warranty milestones and outcome (spec M6b ticket 06). */
export const WarrantyView = z.object({
  receivedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  returnedAt: z.string().nullable(),
  returnShipment: z.object({ carrier: z.string(), trackingNumber: z.string() }).nullable(),
  outcome: WarrantyOutcome.nullable(),
  outcomeNote: z.string().nullable(),
})
export type WarrantyView = z.infer<typeof WarrantyView>

export const PublicSupportRequest = PublicSupportSummary.extend({
  lines: z.array(SupportLineView),
  decision: SupportDecision.nullable(),
  /** When the shop received the goods the customer sent back. */
  receivedAt: z.string().nullable(),
  /** Exchange: shipment of the new variant (carrier, tracking number, handover time). */
  exchangeShipment: z.object({ carrier: z.string(), trackingNumber: z.string(), handedOverAt: z.string() }).nullable(),
  warranty: WarrantyView.nullable(),
  previousRequestCode: z.number().nullable(),
  /** The request following this one (e.g. an exchange or return created from a warranty outcome). */
  followUps: z.array(z.object({ code: z.number(), kind: SupportRequestKind })),
  /** The refund from this request (returns), as on the order page: refunding or refunded. */
  refunds: z.array(PublicRefund),
  resolvedAt: z.string().nullable(),
  messages: z.array(PublicSupportMessage),
})
export type PublicSupportRequest = z.infer<typeof PublicSupportRequest>

const Actor = z.object({ id: z.string(), name: z.string(), email: z.string() })

/**
 * Query of `GET /api/admin/support-requests`. `open` is every unfinished status; `awaiting_staff` is new or in
 * progress.
 */
export const AdminSupportQuery = PageQuery.extend({
  status: z.union([SupportRequestStatus, z.enum(['all', 'open', 'awaiting_staff'])]).default('open'),
  kind: z.union([SupportRequestKind, z.literal('all')]).default('all'),
  /** Staff id, or `me`. */
  assignee: z.string().trim().max(64).optional(),
  /** `true`: only unassigned requests. */
  unassigned: z.stringbool().optional(),
  /** Order code: requests of one order. */
  orderCode: z.coerce.number().int().positive().optional(),
  /** `true`: only exchanges flagged for not sending the old item in time. */
  exchangeOverdue: z.stringbool().optional(),
  /** `true`: only returns and exchanges submitted after the product type's return window. */
  returnOverdue: z.stringbool().optional(),
})
export type AdminSupportQuery = z.input<typeof AdminSupportQuery>

export const AdminSupportSummary = PublicSupportSummary.extend({
  contactEmail: z.string(),
  contactName: z.string().nullable(),
  assignee: Actor.nullable(),
})
export type AdminSupportSummary = z.infer<typeof AdminSupportSummary>

export const AdminSupportPage = pageOf(AdminSupportSummary)
export type AdminSupportPage = z.infer<typeof AdminSupportPage>

/** An admin message: includes internal notes and the staff author. */
export const AdminSupportMessage = PublicSupportMessage.extend({
  internal: z.boolean(),
  staff: Actor.nullable(),
})
export type AdminSupportMessage = z.infer<typeof AdminSupportMessage>

/** Admin line: adds the receiving result and the variant actually received. */
export const AdminSupportLine = SupportLineView.extend({
  orderLineId: z.string(),
  /** The variant the customer holds for the line, which the warehouse receives. */
  heldVariantId: z.string(),
  heldSku: z.string(),
  restockedQuantity: z.number(),
  writtenOffQuantity: z.number(),
  /** Exchange: the variant the customer gets and the quantity reserved for it. */
  exchangeVariantId: z.string().nullable(),
  reservedQuantity: z.number(),
})
export type AdminSupportLine = z.infer<typeof AdminSupportLine>

export const AdminSupportRequest = AdminSupportSummary.extend({
  lines: z.array(AdminSupportLine),
  decision: SupportDecision.nullable(),
  decidedBy: Actor.nullable(),
  decidedAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
  receivedBy: Actor.nullable(),
  exchangeShipment: z.object({ carrier: z.string(), trackingNumber: z.string(), handedOverAt: z.string() }).nullable(),
  /** Accepted exchanges older than 7 days without the old item: when the job flagged it. */
  exchangeOverdueAt: z.string().nullable(),
  warranty: WarrantyView.nullable(),
  /**
   * Warranty: the line's product has a `warranty` commitment (ADR 0005); filled by the route. `null` for other types.
   */
  hasWarrantyCommitment: z.boolean().nullable(),
  followUps: z.array(z.object({ code: z.number(), kind: SupportRequestKind })),
  /** Return window snapshotted at submit: days (null when the type is unconfigured), delivery time, days overdue. */
  returnWindow: z
    .object({ days: z.number().nullable(), deliveredAt: z.string().nullable(), overdueDays: z.number().nullable() })
    .nullable(),
  /**
   * Received returns without a proposed refund: suggested refund (discount deducted, shipping excluded) and refundable.
   */
  returnRefund: z.object({ suggested: z.number(), refundable: z.number() }).nullable(),
  /** The refund from this request (returns). */
  refunds: z.array(z.object({ id: z.string(), amount: z.number(), status: z.string() })),
  customerId: z.string().nullable(),
  createdBy: SupportAuthor,
  createdByStaff: Actor.nullable(),
  previousRequestCode: z.number().nullable(),
  resolvedAt: z.string().nullable(),
  messages: z.array(AdminSupportMessage),
  /** The chatbot conversation before handoff (M8); filled by the route. `null` when not from the chatbot. */
  chatTranscript: z.array(ChatMessageView).nullable(),
})
export type AdminSupportRequest = z.infer<typeof AdminSupportRequest>

/**
 * Body of `POST /api/admin/support-requests`: staff create a request for a customer who called or messaged. Tied to an
 * order (`orderCode`), or to the customer account (`customerEmail`) without an order.
 */
const AdminCreateBase = z.object({
  orderCode: z.number().int().positive().optional(),
  customerEmail: z.email('Email không hợp lệ').trim().toLowerCase().optional(),
  subject: Subject,
  message: Body,
})

export const AdminCreateSupportRequest = z
  .discriminatedUnion('kind', [
    AdminCreateBase.extend({ kind: z.literal('other') }),
    AdminCreateBase.extend({ kind: z.literal('cancel') }),
    AdminCreateBase.extend({ kind: z.literal('return'), lines: ReturnLines }),
    AdminCreateBase.extend({ kind: z.literal('exchange'), lines: ExchangeLines }),
    AdminCreateBase.extend({ kind: z.literal('warranty'), lines: WarrantyLines }),
  ])
  .refine((v) => v.orderCode !== undefined || v.customerEmail !== undefined, {
    message: 'Cần mã đơn hoặc email tài khoản khách',
    path: ['orderCode'],
  })
  .refine((v) => v.kind === 'other' || v.orderCode !== undefined, {
    message: 'Yêu cầu này cần mã đơn',
    path: ['orderCode'],
  })
export type AdminCreateSupportRequest = z.input<typeof AdminCreateSupportRequest>

/**
 * Body of a staff message: `internal` is an internal note (no email). `status`: change status at the same time (only
 * statuses staff may pick).
 */
export const AdminSupportReply = z.object({
  message: Body.optional(),
  internal: z.boolean().default(false),
  status: z.enum(['in_progress', 'waiting_customer', 'resolved', 'rejected']).optional(),
})
export type AdminSupportReply = z.input<typeof AdminSupportReply>

/** Body to assign: staff id, or `null` to unassign. Taking it yourself uses `/claim`. */
export const AssignSupportRequest = z.object({ staffId: z.string().uuid().nullable() })
export type AssignSupportRequest = z.input<typeof AssignSupportRequest>

/** Body to accept or reject a return (exchange, warranty): with a message to the customer (instructions or reason). */
export const DecideSupportRequest = z.object({
  decision: SupportDecision,
  message: Body,
})
export type DecideSupportRequest = z.input<typeof DecideSupportRequest>

/**
 * Body for warehouse receiving: per request line, units restocked and written off; they add up to the line quantity.
 */
export const ReceiveSupportReturn = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string(),
        restocked: z.number().int().min(0),
        writtenOff: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(20),
})
export type ReceiveSupportReturn = z.input<typeof ReceiveSupportReturn>

/**
 * Body to propose the refund after receiving a return: amount, note (required below the suggestion), customer message.
 */
export const ProposeReturnRefund = z.object({
  refundAmount: z.number().int().min(0, 'Số tiền hoàn không âm'),
  note: z.string().trim().max(2000).optional(),
  message: Body.optional(),
})
export type ProposeReturnRefund = z.input<typeof ProposeReturnRefund>

/** A product type's return window: days from delivery; `null` means no warning (GLOSSARY "Hạn đổi trả"). */
export const ReturnWindowItem = z.object({
  productType: ProductType,
  days: z.number().int().min(0, 'Số ngày không âm').max(365, 'Tối đa 365 ngày').nullable(),
})
export type ReturnWindowItem = z.infer<typeof ReturnWindowItem>

/** `GET` and `PUT /api/admin/return-windows`: all five product types. */
export const ReturnWindowList = z.object({ items: z.array(ReturnWindowItem) })
export type ReturnWindowList = z.infer<typeof ReturnWindowList>

/** Body for the warehouse to hand the exchange variant to the carrier (ADR 0015): only after the old item arrived. */
export const ShipExchangeRequest = z.object({
  carrier: z.string().trim().min(1, 'Cần đơn vị vận chuyển').max(100),
  trackingNumber: z.string().trim().min(1, 'Cần mã vận đơn').max(100),
})
export type ShipExchangeRequest = z.input<typeof ShipExchangeRequest>

/**
 * Exchangeable variants per delivered line (`GET …/support-requests/exchange-options`): same product and price as the
 * line, on sale, in stock, other than the held variant. The line's `variantId` is the original (the order line key).
 */
export const ExchangeOptions = z.object({
  lines: z.array(
    z.object({
      variantId: z.string(),
      heldSku: z.string(),
      returnable: z.number(),
      options: z.array(z.object({ variantId: z.string(), sku: z.string(), label: z.string() })),
    }),
  ),
})
export type ExchangeOptions = z.infer<typeof ExchangeOptions>

/** Warranty milestones, in order: item received → sent to the brand or repaired → returned (with shipping). */
export const WarrantyMilestone = z.enum(['received', 'sent', 'returned'])
export type WarrantyMilestone = z.infer<typeof WarrantyMilestone>

/** Body to record a warranty milestone; `returned` needs a carrier and tracking number. */
export const RecordWarrantyMilestone = z.discriminatedUnion('milestone', [
  z.object({ milestone: z.literal('received') }),
  z.object({ milestone: z.literal('sent') }),
  ShipExchangeRequest.extend({ milestone: z.literal('returned') }),
])
export type RecordWarrantyMilestone = z.input<typeof RecordWarrantyMilestone>

/**
 * Body to record the warranty outcome. `note` is the message to the customer (emailed), required when rejecting.
 * `replaced`/`refunded` create an accepted follow-up exchange/return.
 */
export const RecordWarrantyOutcome = z
  .object({ outcome: WarrantyOutcome, note: Body.optional() })
  .refine((v) => v.outcome !== 'rejected' || v.note !== undefined, {
    message: 'Nhập lý do từ chối bảo hành',
    path: ['note'],
  })
export type RecordWarrantyOutcome = z.input<typeof RecordWarrantyOutcome>
