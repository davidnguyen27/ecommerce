import { z } from 'zod'
import { ProductType } from './catalog.ts'
import { PageQuery, pageOf } from './pagination.ts'

/** Loại yêu cầu hỗ trợ (GLOSSARY "Yêu cầu hỗ trợ"); mọi loại trừ `other` gắn với một đơn. */
export const SupportRequestKind = z.enum(['cancel', 'return', 'exchange', 'warranty', 'other'])
export type SupportRequestKind = z.infer<typeof SupportRequestKind>

/** Mới → đang xử lý ⇄ chờ khách → đã xong hoặc từ chối (kết thúc, không mở lại). */
export const SupportRequestStatus = z.enum(['new', 'in_progress', 'waiting_customer', 'resolved', 'rejected'])
export type SupportRequestStatus = z.infer<typeof SupportRequestStatus>

/** Trạng thái kết thúc: không nhận thêm tin, không mở lại. */
export const SUPPORT_CLOSED_STATUSES: readonly SupportRequestStatus[] = ['resolved', 'rejected']

/** Ai viết tin: khách, nhân viên, hay hệ thống. */
export const SupportAuthor = z.enum(['customer', 'staff', 'system'])
export type SupportAuthor = z.infer<typeof SupportAuthor>

const Body = z
  .string({ error: 'Nhập nội dung' })
  .trim()
  .min(1, 'Nhập nội dung')
  .max(5000, 'Nội dung tối đa 5.000 ký tự')
const Subject = z.string({ error: 'Nhập tiêu đề' }).trim().min(1, 'Nhập tiêu đề').max(200, 'Tiêu đề tối đa 200 ký tự')

/** Loại khách và nhân viên tạo được (spec M6b). */
export const CreatableSupportKind = z.enum(['other', 'cancel', 'return', 'exchange', 'warranty'])
export type CreatableSupportKind = z.infer<typeof CreatableSupportKind>

/** Lý do trả hàng: lỗi, không vừa, không đúng mô tả, khác. */
export const SupportReturnReason = z.enum(['defective', 'wrong_fit', 'not_as_described', 'other'])
export type SupportReturnReason = z.infer<typeof SupportReturnReason>

/** Một dòng muốn trả: theo biến thể của dòng đơn (mỗi đơn một dòng cho mỗi biến thể), số lượng và lý do. */
export const ReturnLineInput = z.object({
  variantId: z.string(),
  quantity: z.number().int().min(1, 'Số lượng ít nhất là 1').max(5),
  reason: SupportReturnReason,
})
export type ReturnLineInput = z.infer<typeof ReturnLineInput>

/**
 * Một dòng muốn đổi (ADR 0015): dòng đơn theo biến thể gốc của nó, số lượng, và biến thể muốn nhận (cùng sản phẩm, cùng
 * giá, còn hàng; API kiểm).
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

/** Bảo hành: đúng một dòng của đơn (theo biến thể gốc) và số lượng; mô tả lỗi là tin đầu tiên. */
export const WarrantyLineInput = z.object({
  variantId: z.string(),
  quantity: z.number().int().min(1, 'Số lượng ít nhất là 1').max(5),
})
export type WarrantyLineInput = z.infer<typeof WarrantyLineInput>
const WarrantyLines = z.array(WarrantyLineInput).length(1, 'Chọn một sản phẩm cần bảo hành')

const CreateBase = z.object({
  subject: Subject,
  message: Body,
  /** Nối tiếp một yêu cầu đã kết thúc của chính khách. */
  previousRequestCode: z.number().int().positive().optional(),
  /** Chỉ ở trang tài khoản: gắn yêu cầu vào một đơn của chính khách. Đường link tra cứu đơn đã có đơn trong URL. */
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
 * Body khách gửi để tạo yêu cầu, theo loại: `other`; `cancel` (hủy đơn đã nhận tiền, cần đơn); `return`, `exchange`
 * (hàng đã giao, cần đơn và các dòng); `warranty` (một dòng của đơn đã giao).
 */
export const CreateSupportRequest = z.discriminatedUnion('kind', [
  CreateBase.extend({ kind: z.literal('other') }),
  CreateBase.extend({ kind: z.literal('cancel') }),
  CreateBase.extend({ kind: z.literal('return'), lines: ReturnLines }),
  CreateBase.extend({ kind: z.literal('exchange'), lines: ExchangeLines }),
  CreateBase.extend({ kind: z.literal('warranty'), lines: WarrantyLines }),
])
export type CreateSupportRequest = z.input<typeof CreateSupportRequest>

/** Body khách gửi tin vào yêu cầu. */
export const SupportMessageRequest = z.object({ message: Body })
export type SupportMessageRequest = z.input<typeof SupportMessageRequest>

/** Ảnh đính kèm: jpeg, png, webp, tối đa 5 MB mỗi ảnh (spec M6b). */
export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** Tối đa số ảnh trên một tin và trên một yêu cầu. */
export const SUPPORT_IMAGES_PER_MESSAGE = 5
export const SUPPORT_IMAGES_PER_REQUEST = 20

/** Một ảnh đính kèm: URL ký có hạn (5 phút), chỉ trả cho người xem được yêu cầu. */
export const SupportAttachmentView = z.object({
  id: z.string(),
  url: z.string(),
  contentType: z.string(),
  width: z.number(),
  height: z.number(),
})
export type SupportAttachmentView = z.infer<typeof SupportAttachmentView>

/** Một tin như khách thấy: không có ghi chú nội bộ, không có tên nhân viên (khách thấy "Cửa hàng"). */
export const PublicSupportMessage = z.object({
  id: z.string(),
  author: SupportAuthor,
  body: z.string(),
  createdAt: z.string(),
  attachments: z.array(SupportAttachmentView),
})
export type PublicSupportMessage = z.infer<typeof PublicSupportMessage>

/** Một yêu cầu trong danh sách của khách. */
export const PublicSupportSummary = z.object({
  code: z.number(),
  kind: SupportRequestKind,
  status: SupportRequestStatus,
  subject: z.string(),
  orderCode: z.number().nullable(),
  createdAt: z.string(),
  /** Lúc có tin cuối cùng khách thấy được. */
  lastMessageAt: z.string(),
})
export type PublicSupportSummary = z.infer<typeof PublicSupportSummary>

export const PublicSupportList = z.object({ items: z.array(PublicSupportSummary) })
export type PublicSupportList = z.infer<typeof PublicSupportList>

/** Chi tiết yêu cầu như khách thấy. */
/** Một dòng của yêu cầu như khách thấy: sản phẩm, số lượng, lý do. */
export const SupportLineView = z.object({
  id: z.string(),
  sku: z.string(),
  productName: z.string(),
  quantity: z.number(),
  reason: SupportReturnReason.nullable(),
  /** Đổi hàng: SKU biến thể khách nhận. */
  toSku: z.string().nullable(),
})
export type SupportLineView = z.infer<typeof SupportLineView>

export const SupportDecision = z.enum(['accepted', 'rejected'])
export type SupportDecision = z.infer<typeof SupportDecision>

export const WarrantyOutcome = z.enum(['repaired', 'replaced', 'rejected', 'refunded'])
export type WarrantyOutcome = z.infer<typeof WarrantyOutcome>

/** Các mốc và kết quả bảo hành (spec M6b ticket 06). */
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
  /** Lúc cửa hàng đã nhận hàng khách gửi về. */
  receivedAt: z.string().nullable(),
  /** Đổi hàng: lần giao biến thể mới (đơn vị vận chuyển, mã vận đơn, lúc bàn giao). */
  exchangeShipment: z.object({ carrier: z.string(), trackingNumber: z.string(), handedOverAt: z.string() }).nullable(),
  warranty: WarrantyView.nullable(),
  previousRequestCode: z.number().nullable(),
  /** Yêu cầu nối tiếp yêu cầu này (ví dụ yêu cầu đổi hay trả tạo từ kết quả bảo hành). */
  followUps: z.array(z.object({ code: z.number(), kind: SupportRequestKind })),
  resolvedAt: z.string().nullable(),
  messages: z.array(PublicSupportMessage),
})
export type PublicSupportRequest = z.infer<typeof PublicSupportRequest>

const Actor = z.object({ id: z.string(), name: z.string(), email: z.string() })

/** Query của `GET /api/admin/support-requests`. `open` là mọi trạng thái chưa kết thúc; `awaiting_staff` là mới hoặc đang xử lý. */
export const AdminSupportQuery = PageQuery.extend({
  status: z.union([SupportRequestStatus, z.enum(['all', 'open', 'awaiting_staff'])]).default('open'),
  kind: z.union([SupportRequestKind, z.literal('all')]).default('all'),
  /** Id nhân viên, hay `me`. */
  assignee: z.string().trim().max(64).optional(),
  /** `true`: chỉ yêu cầu chưa ai nhận. */
  unassigned: z.stringbool().optional(),
  /** Mã đơn: yêu cầu của một đơn. */
  orderCode: z.coerce.number().int().positive().optional(),
  /** `true`: chỉ yêu cầu đổi bị gắn cờ quá hạn gửi hàng cũ. */
  exchangeOverdue: z.stringbool().optional(),
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

/** Một tin ở trang quản trị: có ghi chú nội bộ và nhân viên viết. */
export const AdminSupportMessage = PublicSupportMessage.extend({
  internal: z.boolean(),
  staff: Actor.nullable(),
})
export type AdminSupportMessage = z.infer<typeof AdminSupportMessage>

/** Dòng ở trang quản trị: thêm kết quả nhận hàng về và biến thể kho thực nhận. */
export const AdminSupportLine = SupportLineView.extend({
  orderLineId: z.string(),
  /** Biến thể khách đang giữ của dòng, là biến thể kho nhận về. */
  heldVariantId: z.string(),
  heldSku: z.string(),
  restockedQuantity: z.number(),
  writtenOffQuantity: z.number(),
  /** Đổi hàng: biến thể khách nhận và số đang giữ cho nó trong kho. */
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
  /** Đổi hàng đã chấp nhận quá 14 ngày chưa nhận hàng cũ: lúc job gắn cờ. */
  exchangeOverdueAt: z.string().nullable(),
  warranty: WarrantyView.nullable(),
  /** Bảo hành: sản phẩm của dòng có cam kết loại `warranty` (ADR 0005); route điền. `null` với loại khác. */
  hasWarrantyCommitment: z.boolean().nullable(),
  followUps: z.array(z.object({ code: z.number(), kind: SupportRequestKind })),
  /** Hạn đổi trả chụp lúc gửi: số ngày (null là nhóm hàng không cấu hình), lúc giao, số ngày đã quá. */
  returnWindow: z
    .object({ days: z.number().nullable(), deliveredAt: z.string().nullable(), overdueDays: z.number().nullable() })
    .nullable(),
  /** Trả hàng đã nhận về mà chưa đề xuất hoàn: số hoàn gợi ý (trừ phần giảm, không gồm phí giao) và số còn hoàn được. */
  returnRefund: z.object({ suggested: z.number(), refundable: z.number() }).nullable(),
  /** Khoản hoàn sinh từ yêu cầu (trả hàng). */
  refunds: z.array(z.object({ id: z.string(), amount: z.number(), status: z.string() })),
  customerId: z.string().nullable(),
  createdBy: SupportAuthor,
  createdByStaff: Actor.nullable(),
  previousRequestCode: z.number().nullable(),
  resolvedAt: z.string().nullable(),
  messages: z.array(AdminSupportMessage),
})
export type AdminSupportRequest = z.infer<typeof AdminSupportRequest>

/**
 * Body của `POST /api/admin/support-requests`: nhân viên tạo hộ khách gọi điện hay nhắn tin. Gắn với một đơn
 * (`orderCode`), hoặc với tài khoản khách (`customerEmail`) khi không gắn đơn.
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
 * Body nhân viên gửi tin: `internal` là ghi chú nội bộ (không gửi email). `status`: chuyển trạng thái cùng lúc
 * (chỉ trạng thái nhân viên được chọn).
 */
export const AdminSupportReply = z.object({
  message: Body.optional(),
  internal: z.boolean().default(false),
  status: z.enum(['in_progress', 'waiting_customer', 'resolved', 'rejected']).optional(),
})
export type AdminSupportReply = z.input<typeof AdminSupportReply>

/** Body giao người phụ trách: id nhân viên, hay `null` để bỏ giao. Nhận việc cho chính mình dùng `/claim`. */
export const AssignSupportRequest = z.object({ staffId: z.string().uuid().nullable() })
export type AssignSupportRequest = z.input<typeof AssignSupportRequest>

/** Body chấp nhận hay từ chối yêu cầu trả (đổi, bảo hành): kèm tin cho khách (hướng dẫn gửi hàng, hay lý do từ chối). */
export const DecideSupportRequest = z.object({
  decision: SupportDecision,
  message: Body,
})
export type DecideSupportRequest = z.input<typeof DecideSupportRequest>

/** Body kho nhận hàng về: mỗi dòng của yêu cầu, số nhập lại tồn và số ghi hỏng; tổng bằng số lượng dòng. */
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

/** Body đề xuất hoàn sau khi đã nhận hàng trả về: số hoàn, ghi chú (bắt buộc khi thấp hơn gợi ý), tin cho khách. */
export const ProposeReturnRefund = z.object({
  refundAmount: z.number().int().min(0, 'Số tiền hoàn không âm'),
  note: z.string().trim().max(2000).optional(),
  message: Body.optional(),
})
export type ProposeReturnRefund = z.input<typeof ProposeReturnRefund>

/** Hạn đổi trả của một nhóm hàng: số ngày tính từ lúc giao; `null` là không cảnh báo (GLOSSARY "Hạn đổi trả"). */
export const ReturnWindowItem = z.object({
  productType: ProductType,
  days: z.number().int().min(0, 'Số ngày không âm').max(365, 'Tối đa 365 ngày').nullable(),
})
export type ReturnWindowItem = z.infer<typeof ReturnWindowItem>

/** `GET` và `PUT /api/admin/return-windows`: đủ năm nhóm hàng. */
export const ReturnWindowList = z.object({ items: z.array(ReturnWindowItem) })
export type ReturnWindowList = z.infer<typeof ReturnWindowList>

/** Body kho bàn giao biến thể đổi cho đơn vị vận chuyển (ADR 0015): chỉ sau khi đã nhận hàng cũ. */
export const ShipExchangeRequest = z.object({
  carrier: z.string().trim().min(1, 'Cần đơn vị vận chuyển').max(100),
  trackingNumber: z.string().trim().min(1, 'Cần mã vận đơn').max(100),
})
export type ShipExchangeRequest = z.input<typeof ShipExchangeRequest>

/**
 * Biến thể đổi được của từng dòng đơn đã giao (`GET …/support-requests/exchange-options`): cùng sản phẩm, cùng giá với
 * dòng, đang bán, còn hàng, khác biến thể khách đang giữ. `variantId` của dòng là biến thể gốc (khóa của dòng đơn).
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

/** Mốc bảo hành, theo thứ tự: nhận hàng của khách → gửi hãng hay sửa → trả lại khách (kèm vận chuyển). */
export const WarrantyMilestone = z.enum(['received', 'sent', 'returned'])
export type WarrantyMilestone = z.infer<typeof WarrantyMilestone>

/** Body ghi một mốc bảo hành; `returned` cần đơn vị vận chuyển và mã vận đơn. */
export const RecordWarrantyMilestone = z.discriminatedUnion('milestone', [
  z.object({ milestone: z.literal('received') }),
  z.object({ milestone: z.literal('sent') }),
  ShipExchangeRequest.extend({ milestone: z.literal('returned') }),
])
export type RecordWarrantyMilestone = z.input<typeof RecordWarrantyMilestone>

/**
 * Body ghi kết quả bảo hành. `note` là lời nhắn cho khách (gửi email), bắt buộc khi từ chối. `replaced`/`refunded` tạo
 * yêu cầu đổi/trả nối tiếp đã chấp nhận.
 */
export const RecordWarrantyOutcome = z
  .object({ outcome: WarrantyOutcome, note: Body.optional() })
  .refine((v) => v.outcome !== 'rejected' || v.note !== undefined, {
    message: 'Nhập lý do từ chối bảo hành',
    path: ['note'],
  })
export type RecordWarrantyOutcome = z.input<typeof RecordWarrantyOutcome>
