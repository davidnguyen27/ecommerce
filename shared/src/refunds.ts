import { z } from 'zod'

/**
 * Where a refund came from: cancelling a paid order, resolving a reconciliation item, recreating a failed refund, or a
 * return after delivery (M6b).
 */
export const RefundOrigin = z.enum(['cancellation', 'reconciliation', 'retry', 'return'])
export type RefundOrigin = z.infer<typeof RefundOrigin>

/**
 * Refund status (GLOSSARY "Hoàn tiền", ADR 0014): awaiting accounting, gateway processing, refunded, failed. Manual
 * refunds go straight from `pending` to `succeeded`.
 */
export const RefundStatus = z.enum(['pending', 'processing', 'succeeded', 'failed'])
export type RefundStatus = z.infer<typeof RefundStatus>

/** Refunded via the gateway's refund command, or by bank transfer outside the system and then recorded. */
export const RefundMethod = z.enum(['vnpay', 'manual'])
export type RefundMethod = z.infer<typeof RefundMethod>

const Actor = z.object({ id: z.string(), name: z.string(), email: z.string() })

/** A refund on the admin page. `retriedById` is set once this failed refund was recreated. */
export const AdminRefund = z.object({
  id: z.string(),
  amount: z.number(),
  origin: RefundOrigin,
  status: RefundStatus,
  method: RefundMethod.nullable(),
  reconciliationItemId: z.string().nullable(),
  retryOfId: z.string().nullable(),
  retriedById: z.string().nullable(),
  paymentTransactionId: z.string().nullable(),
  bankReference: z.string().nullable(),
  /** `YYYY-MM-DD`. */
  transferredOn: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: Actor,
  createdAt: z.string(),
  executedBy: Actor.nullable(),
  executedAt: z.string().nullable(),
  settledBy: Actor.nullable(),
  completedAt: z.string().nullable(),
})
export type AdminRefund = z.infer<typeof AdminRefund>

const Note = z.string().trim().max(2000)

/**
 * Body of `POST /api/admin/refunds/:id/manual`: accounting paid by bank transfer outside the system. Records only the
 * bank transaction ref and date, never the customer's account number.
 */
export const ManualRefundRequest = z.object({
  bankReference: z
    .string({ error: 'Nhập mã giao dịch ngân hàng' })
    .trim()
    .min(1, 'Nhập mã giao dịch ngân hàng')
    .max(100),
  /** Transfer date, `YYYY-MM-DD`. */
  transferredOn: z.iso.date({ error: 'Nhập ngày chuyển' }),
  note: Note.optional(),
})
export type ManualRefundRequest = z.input<typeof ManualRefundRequest>

/**
 * Body of `POST /api/admin/refunds/:id/settle`: settles a gateway-processing refund after checking the merchant portal.
 */
export const SettleRefundRequest = z.object({
  outcome: z.enum(['succeeded', 'failed']),
  note: Note.min(1, 'Nhập ghi chú: đã kiểm gì trên cổng'),
})
export type SettleRefundRequest = z.input<typeof SettleRefundRequest>

/** Body of `POST /api/admin/refunds/:id/retry`: recreates a failed refund, at most its amount. */
export const RetryRefundRequest = z.object({
  amount: z.number().int().positive('Số tiền phải lớn hơn 0'),
  note: Note.optional(),
})
export type RetryRefundRequest = z.input<typeof RetryRefundRequest>

/** A refund as customers see it: amount, refunding or refunded, created and completed dates. No internal notes. */
export const PublicRefund = z.object({
  amount: z.number(),
  status: z.enum(['refunding', 'refunded']),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})
export type PublicRefund = z.infer<typeof PublicRefund>
