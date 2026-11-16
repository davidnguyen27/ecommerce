import { z } from 'zod'
import { AuditActor } from './audit.ts'
import { OrderKind } from './orders.ts'
import { PageQuery, pageOf } from './pagination.ts'

/** Giảm số tiền cố định, hoặc giảm theo tỷ lệ có mức giảm tối đa (GLOSSARY "Mã giảm giá"). */
export const VoucherKind = z.enum(['fixed', 'percent'])
export type VoucherKind = z.infer<typeof VoucherKind>

/** Sắp tới, đang chạy, hết hạn, đã tắt; tính từ thời hạn và thời điểm tắt, không lưu. */
export const VoucherStatus = z.enum(['upcoming', 'active', 'expired', 'disabled'])
export type VoucherStatus = z.infer<typeof VoucherStatus>

/** Trần giảm theo Nghị định 81/2018 (spec M5, chờ chủ DN xác nhận). */
export const VOUCHER_MAX_PERCENT = 50

/** Chữ và số, 4–20 ký tự; khách gõ không phân biệt hoa thường nên lưu chữ hoa. */
export const VoucherCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{4,20}$/, 'Mã gồm 4–20 chữ cái hoặc chữ số, không dấu, không khoảng trắng')
  .transform((code) => code.toUpperCase())

const Money = z.number().int().min(0).max(1_000_000_000)

const VoucherFields = z.object({
  /** Ghi chú nội bộ, khách không thấy. */
  description: z.string().trim().max(500),
  kind: VoucherKind,
  /** VND, chỉ với `fixed`. */
  amount: Money.min(1_000, 'Ít nhất 1.000 đ').nullable(),
  /** Phần trăm, chỉ với `percent`. */
  percent: z.number().int().min(1, 'Ít nhất 1%').max(VOUCHER_MAX_PERCENT, `Tối đa ${VOUCHER_MAX_PERCENT}%`).nullable(),
  /** VND, bắt buộc với `percent`. */
  maxDiscount: Money.min(1_000, 'Ít nhất 1.000 đ').nullable(),
  /** Tiền hàng tối thiểu của các dòng thuộc phạm vi, VND. */
  minSubtotal: Money,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  saleTypes: z
    .array(OrderKind)
    .min(1, 'Chọn ít nhất một hình thức bán')
    .refine((types) => new Set(types).size === types.length, 'Hình thức bán bị trùng'),
  /** Trống là không giới hạn. */
  totalLimit: z.number().int().min(1, 'Ít nhất 1 lượt').max(1_000_000).nullable(),
  perCustomerLimit: z.number().int().min(1, 'Ít nhất 1 lượt').max(1_000),
  /** Trống là mọi thương hiệu. */
  brandIds: z.array(z.uuid()).max(200),
  /** Trống là mọi danh mục; một danh mục gồm cả con cháu. */
  categoryIds: z.array(z.uuid()).max(200),
})

/** Ràng buộc giữa các trường, dùng cho cả tạo và cho bản đã ghép sau khi sửa. */
const voucherRules = (v: z.infer<typeof VoucherFields>, ctx: z.RefinementCtx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if (v.kind === 'fixed') {
    if (v.amount === null) issue('amount', 'Nhập số tiền giảm')
    if (v.percent !== null) issue('percent', 'Mã giảm số tiền không có tỷ lệ')
    if (v.maxDiscount !== null) issue('maxDiscount', 'Mã giảm số tiền không có mức giảm tối đa')
  } else {
    if (v.percent === null) issue('percent', 'Nhập tỷ lệ giảm')
    if (v.maxDiscount === null) issue('maxDiscount', 'Nhập mức giảm tối đa')
    if (v.amount !== null) issue('amount', 'Mã giảm theo tỷ lệ không có số tiền cố định')
  }
  if (new Date(v.endsAt) <= new Date(v.startsAt)) issue('endsAt', 'Thời điểm kết thúc phải sau thời điểm bắt đầu')
}

const withDefaults = VoucherFields.extend({
  description: VoucherFields.shape.description.default(''),
  amount: VoucherFields.shape.amount.default(null),
  percent: VoucherFields.shape.percent.default(null),
  maxDiscount: VoucherFields.shape.maxDiscount.default(null),
  minSubtotal: Money.default(0),
  totalLimit: VoucherFields.shape.totalLimit.default(null),
  perCustomerLimit: VoucherFields.shape.perCustomerLimit.default(1),
  brandIds: VoucherFields.shape.brandIds.default([]),
  categoryIds: VoucherFields.shape.categoryIds.default([]),
})

/** Tạo một mã giảm giá. */
export const VoucherCreate = withDefaults.extend({ code: VoucherCode }).superRefine(voucherRules)
export type VoucherCreate = z.input<typeof VoucherCreate>

/** Một mã đầy đủ sau khi ghép phần sửa vào mã hiện có; API dùng để kiểm lại ràng buộc giữa các trường. */
export const VoucherDraft = VoucherFields.superRefine(voucherRules)

/**
 * Sửa mã: chỉ gửi các trường muốn đổi; chuỗi mã không đổi được. Khi mã đã có lượt dùng thì chỉ đổi được mô tả, thời
 * điểm kết thúc và tổng lượt (không thấp hơn số đã dùng).
 */
export const VoucherUpdate = VoucherFields.partial()
export type VoucherUpdate = z.input<typeof VoucherUpdate>

/** Các trường vẫn sửa được khi mã đã có lượt dùng. */
export const VOUCHER_FIELDS_EDITABLE_AFTER_USE = ['description', 'endsAt', 'totalLimit'] as const

export const VoucherQuery = PageQuery.extend({
  status: z.enum([...VoucherStatus.options, 'all']).default('all'),
  /** Tìm theo một phần chuỗi mã, không phân biệt hoa thường. */
  q: z.string().trim().max(20).optional(),
})
export type VoucherQuery = z.infer<typeof VoucherQuery>

export const Voucher = z.object({
  id: z.string(),
  code: z.string(),
  description: z.string(),
  kind: VoucherKind,
  amount: z.number().nullable(),
  percent: z.number().nullable(),
  maxDiscount: z.number().nullable(),
  minSubtotal: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
  saleTypes: z.array(OrderKind),
  totalLimit: z.number().nullable(),
  perCustomerLimit: z.number(),
  brands: z.array(z.object({ id: z.string(), name: z.string() })),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
  status: VoucherStatus,
  /** Số lượt đã dùng: số đơn chưa hủy có mã này. */
  used: z.number(),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
  createdBy: AuditActor,
})
export type Voucher = z.infer<typeof Voucher>

export const VoucherPage = pageOf(Voucher)
export type VoucherPage = z.infer<typeof VoucherPage>
