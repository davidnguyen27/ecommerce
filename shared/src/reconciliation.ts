import { z } from 'zod'
import { OrderStatus, PaymentStatus, PaymentSource, ReconciliationDetail, ReconciliationStatus } from './orders.ts'
import { PageQuery, pageOf } from './pagination.ts'

/** Query của `GET /api/admin/reconciliation`; mặc định các mục chưa xử lý, cũ trước. */
export const ReconciliationQuery = PageQuery.extend({
  status: z.union([ReconciliationStatus, z.literal('all')]).default('open'),
})
export type ReconciliationQuery = z.infer<typeof ReconciliationQuery>

/** Một dòng của danh sách cần đối soát: khoản tiền, kèm số tiền của đơn và tổng đơn đã nhận để so. */
export const ReconciliationListItem = ReconciliationDetail.extend({
  /** VND, số tiền của khoản bị gắn cờ. */
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
    /** Tổng mọi khoản tiền đã về cho đơn. */
    received: z.number(),
    recipientName: z.string(),
  }),
})
export type ReconciliationListItem = z.infer<typeof ReconciliationListItem>

export const ReconciliationPage = pageOf(ReconciliationListItem)
export type ReconciliationPage = z.infer<typeof ReconciliationPage>

/** Body của "Đã xử lý ngoài hệ thống": ghi chú bắt buộc (số tiền, mã giao dịch ngân hàng). */
export const ResolveReconciliationRequest = z.object({
  note: z
    .string({ error: 'Nhập ghi chú: số tiền, mã giao dịch ngân hàng' })
    .trim()
    .min(1, 'Nhập ghi chú: số tiền, mã giao dịch ngân hàng')
    .max(2000),
})
export type ResolveReconciliationRequest = z.infer<typeof ResolveReconciliationRequest>
