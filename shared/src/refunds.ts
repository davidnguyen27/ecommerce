import { z } from 'zod'

/**
 * Hoàn tiền sinh ra từ đâu: hủy đơn đã nhận tiền, giải quyết mục cần đối soát, tạo lại từ một khoản thất bại, hay trả
 * hàng sau khi giao (M6b).
 */
export const RefundOrigin = z.enum(['cancellation', 'reconciliation', 'retry', 'return'])
export type RefundOrigin = z.infer<typeof RefundOrigin>

/**
 * Trạng thái của một khoản hoàn (GLOSSARY "Hoàn tiền", ADR 0014): chờ kế toán thực hiện, cổng đang xử lý, đã hoàn,
 * thất bại. Hoàn thủ công đi thẳng từ `pending` tới `succeeded`.
 */
export const RefundStatus = z.enum(['pending', 'processing', 'succeeded', 'failed'])
export type RefundStatus = z.infer<typeof RefundStatus>

/** Hoàn qua lệnh hoàn của cổng, hay chuyển khoản ngoài hệ thống rồi ghi lại. */
export const RefundMethod = z.enum(['vnpay', 'manual'])
export type RefundMethod = z.infer<typeof RefundMethod>

const Actor = z.object({ id: z.string(), name: z.string(), email: z.string() })

/** Một khoản hoàn ở trang quản trị. `retriedById` có khi khoản thất bại này đã được tạo lại. */
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
 * Body của `POST /api/admin/refunds/:id/manual`: kế toán đã chuyển khoản ngoài hệ thống. Chỉ ghi mã giao dịch ngân hàng
 * và ngày chuyển, không ghi số tài khoản của khách.
 */
export const ManualRefundRequest = z.object({
  bankReference: z
    .string({ error: 'Nhập mã giao dịch ngân hàng' })
    .trim()
    .min(1, 'Nhập mã giao dịch ngân hàng')
    .max(100),
  /** Ngày chuyển, `YYYY-MM-DD`. */
  transferredOn: z.iso.date({ error: 'Nhập ngày chuyển' }),
  note: Note.optional(),
})
export type ManualRefundRequest = z.input<typeof ManualRefundRequest>

/** Body của `POST /api/admin/refunds/:id/settle`: chốt khoản cổng đang xử lý sau khi kiểm trên cổng merchant. */
export const SettleRefundRequest = z.object({
  outcome: z.enum(['succeeded', 'failed']),
  note: Note.min(1, 'Nhập ghi chú: đã kiểm gì trên cổng'),
})
export type SettleRefundRequest = z.input<typeof SettleRefundRequest>

/** Body của `POST /api/admin/refunds/:id/retry`: tạo lại khoản thất bại, số tiền không vượt khoản đó. */
export const RetryRefundRequest = z.object({
  amount: z.number().int().positive('Số tiền phải lớn hơn 0'),
  note: Note.optional(),
})
export type RetryRefundRequest = z.input<typeof RetryRefundRequest>
