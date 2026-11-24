import { z } from 'zod'
import { OrderStatus, PaymentStatus, PaymentSource, ReconciliationDetail, ReconciliationStatus } from './orders.ts'
import { PageQuery, pageOf } from './pagination.ts'

/** Query of `GET /api/admin/reconciliation`; defaults to unresolved items, oldest first. */
export const ReconciliationQuery = PageQuery.extend({
  status: z.union([ReconciliationStatus, z.literal('all')]).default('open'),
})
export type ReconciliationQuery = z.infer<typeof ReconciliationQuery>

/** A reconciliation row: the payment, with the order total and total received to compare. */
export const ReconciliationListItem = ReconciliationDetail.extend({
  /** VND of the flagged payment. */
  amount: z.number(),
  receivedAt: z.string(),
  reference: z.string(),
  source: PaymentSource,
  createdAt: z.string(),
  order: z.object({
    code: z.number(),
    status: OrderStatus,
    paymentStatus: PaymentStatus,
    total: z.number(),
    /** Total of every payment received for the order. */
    received: z.number(),
    recipientName: z.string(),
  }),
})
export type ReconciliationListItem = z.infer<typeof ReconciliationListItem>

export const ReconciliationPage = pageOf(ReconciliationListItem)
export type ReconciliationPage = z.infer<typeof ReconciliationPage>

/** Body of "Đã xử lý ngoài hệ thống": a required note (amount, bank transaction ref). */
export const ResolveReconciliationRequest = z.object({
  note: z
    .string({ error: 'Nhập ghi chú: số tiền, mã giao dịch ngân hàng' })
    .trim()
    .min(1, 'Nhập ghi chú: số tiền, mã giao dịch ngân hàng')
    .max(2000),
})
export type ResolveReconciliationRequest = z.infer<typeof ResolveReconciliationRequest>
