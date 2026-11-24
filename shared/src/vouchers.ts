import { z } from 'zod'
import { AuditActor } from './audit.ts'
import { OrderKind, OrderStatus, PaymentStatus, VoucherKind } from './orders.ts'
import { PageQuery, pageOf } from './pagination.ts'

/** Upcoming, active, expired, disabled; derived from validity and disable time, not stored. */
export const VoucherStatus = z.enum(['upcoming', 'active', 'expired', 'disabled'])
export type VoucherStatus = z.infer<typeof VoucherStatus>

/** Discount cap per Decree 81/2018 (spec M5, pending owner confirmation). */
export const VOUCHER_MAX_PERCENT = 50

/** Letters and digits, 4–20 characters; customers type it case-insensitively, so it is stored uppercase. */
export const VoucherCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{4,20}$/, 'Mã gồm 4–20 chữ cái hoặc chữ số, không dấu, không khoảng trắng')
  .transform((code) => code.toUpperCase())

const Money = z.number().int().min(0).max(1_000_000_000)

const VoucherFields = z.object({
  /** Internal note, hidden from customers. */
  description: z.string().trim().max(500),
  kind: VoucherKind,
  /** VND, `fixed` only. */
  amount: Money.min(1_000, 'Ít nhất 1.000 đ').nullable(),
  /** Percentage, `percent` only. */
  percent: z.number().int().min(1, 'Ít nhất 1%').max(VOUCHER_MAX_PERCENT, `Tối đa ${VOUCHER_MAX_PERCENT}%`).nullable(),
  /** VND, required for `percent`. */
  maxDiscount: Money.min(1_000, 'Ít nhất 1.000 đ').nullable(),
  /** Minimum goods of in-scope lines, VND. */
  minSubtotal: Money,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  saleTypes: z
    .array(OrderKind)
    .min(1, 'Chọn ít nhất một hình thức bán')
    .refine((types) => new Set(types).size === types.length, 'Hình thức bán bị trùng'),
  /** Empty means unlimited. */
  totalLimit: z.number().int().min(1, 'Ít nhất 1 lượt').max(1_000_000).nullable(),
  perCustomerLimit: z.number().int().min(1, 'Ít nhất 1 lượt').max(1_000),
  /** Empty means every brand. */
  brandIds: z.array(z.uuid()).max(200),
  /** Empty means every category; a category includes its descendants. */
  categoryIds: z.array(z.uuid()).max(200),
})

/** Cross-field rules, used on create and on the merged version after an edit. */
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

/** Creates a voucher. */
export const VoucherCreate = withDefaults.extend({ code: VoucherCode }).superRefine(voucherRules)
export type VoucherCreate = z.input<typeof VoucherCreate>

/** A full voucher after merging the edit into the current one; the API rechecks cross-field rules on it. */
export const VoucherDraft = VoucherFields.superRefine(voucherRules)

/**
 * Edits a voucher: send only the fields to change; the code itself is fixed. Once used, only the description, end time
 * and total uses (not below used) can change.
 */
export const VoucherUpdate = VoucherFields.partial()
export type VoucherUpdate = z.input<typeof VoucherUpdate>

/** Fields still editable once the voucher has been used. */
export const VOUCHER_FIELDS_EDITABLE_AFTER_USE = ['description', 'endsAt', 'totalLimit'] as const

export const VoucherQuery = PageQuery.extend({
  status: z.enum([...VoucherStatus.options, 'all']).default('all'),
  /** Searches part of the code, case-insensitive. */
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
  /** Uses: uncancelled orders with this voucher. */
  used: z.number(),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
  createdBy: AuditActor,
})
export type Voucher = z.infer<typeof Voucher>

export const VoucherPage = pageOf(Voucher)
export type VoucherPage = z.infer<typeof VoucherPage>

/**
 * An order that used the voucher (`GET /api/admin/vouchers/:id/orders`), newest first. Cancelled orders stay listed
 * with `counted` `false`: they take no use.
 */
export const VoucherOrder = z.object({
  code: z.number(),
  kind: OrderKind,
  recipientName: z.string(),
  email: z.string(),
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  discount: z.number(),
  total: z.number(),
  createdAt: z.string(),
  counted: z.boolean(),
})
export type VoucherOrder = z.infer<typeof VoucherOrder>

export const VoucherOrderPage = pageOf(VoucherOrder)
export type VoucherOrderPage = z.infer<typeof VoucherOrderPage>

// Customers apply a voucher at checkout or pre-order.

/**
 * Why the voucher does not work for this order. `disabled` shows to customers as expired; `changed` only at order time:
 * the discount differs from what was seen (price or cart changed), so the customer reviews and confirms.
 */
export const VoucherReason = z.enum([
  'not_found',
  'not_started',
  'expired',
  'disabled',
  'exhausted',
  'customer_limit',
  'below_minimum',
  'not_applicable',
  'sale_type',
  'changed',
])
export type VoucherReason = z.infer<typeof VoucherReason>

/** The code typed, sent with quote and checkout; a malformed one reports `not_found` instead of a form error. */
export const VoucherCodeInput = z.string().trim().min(1).max(40)

/**
 * Voucher result in a quote. `lines` is the discount per line; `shortfall` the goods still missing to reach the
 * minimum.
 */
export const VoucherQuote = z.discriminatedUnion('applied', [
  z.object({
    applied: z.literal(true),
    code: z.string(),
    discount: z.number(),
    lines: z.array(z.object({ variantId: z.string(), discount: z.number() })),
  }),
  z.object({
    applied: z.literal(false),
    code: z.string(),
    reason: VoucherReason,
    shortfall: z.number().optional(),
  }),
])
export type VoucherQuote = z.infer<typeof VoucherQuote>

/**
 * `error.details.voucher` of a 409 when ordering with a voucher: the reason, the new discount when it still applies
 * (`changed`), and the total without the voucher so the customer can continue without it.
 */
export const VoucherConflict = z.object({
  code: z.string(),
  reason: VoucherReason,
  discount: z.number().nullable(),
  shortfall: z.number().optional(),
  totalWithoutVoucher: z.number(),
  /** Pre-orders only: the deposit without the voucher, what the customer pays now if continuing without it. */
  depositAmountWithoutVoucher: z.number().optional(),
})
export type VoucherConflict = z.infer<typeof VoucherConflict>
