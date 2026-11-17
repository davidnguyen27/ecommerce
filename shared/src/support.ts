import { z } from 'zod'
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

/**
 * Body khách gửi để tạo yêu cầu: loại `other` hay `cancel` (hủy đơn đã nhận tiền, cần đơn). Trả, đổi, bảo hành được thêm
 * cùng phần xử lý riêng của chúng.
 * `previousRequestCode`: nối tiếp một yêu cầu đã kết thúc của chính khách.
 */
/** Loại khách và nhân viên đang tạo được (spec M6b ticket 01, 03). */
export const CreatableSupportKind = z.enum(['other', 'cancel'])
export type CreatableSupportKind = z.infer<typeof CreatableSupportKind>

export const CreateSupportRequest = z.object({
  kind: CreatableSupportKind,
  subject: Subject,
  message: Body,
  previousRequestCode: z.number().int().positive().optional(),
  /** Chỉ ở trang tài khoản: gắn yêu cầu vào một đơn của chính khách. Đường link tra cứu đơn đã có đơn trong URL. */
  orderCode: z.number().int().positive().optional(),
})
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
export const PublicSupportRequest = PublicSupportSummary.extend({
  previousRequestCode: z.number().nullable(),
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

export const AdminSupportRequest = AdminSupportSummary.extend({
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
export const AdminCreateSupportRequest = z
  .object({
    kind: CreatableSupportKind,
    orderCode: z.number().int().positive().optional(),
    customerEmail: z.email('Email không hợp lệ').trim().toLowerCase().optional(),
    subject: Subject,
    message: Body,
  })
  .refine((v) => v.orderCode !== undefined || v.customerEmail !== undefined, {
    message: 'Cần mã đơn hoặc email tài khoản khách',
    path: ['orderCode'],
  })
  .refine((v) => v.kind === 'other' || v.orderCode !== undefined, {
    message: 'Yêu cầu hủy đơn cần mã đơn',
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
