import { z } from 'zod'

/**
 * Webhook PayOS báo một khoản chuyển khoản. Chữ ký kiểm trên `data` gốc (mọi trường) trước khi parse;
 * schema chỉ giữ các trường hệ thống dùng.
 */
export const PayosWebhook = z.object({
  /** `00` là thành công. */
  code: z.string(),
  signature: z.string().regex(/^[0-9a-f]{64}$/i),
  data: z.looseObject({
    orderCode: z.number().int(),
    amount: z.number().int(),
    reference: z.string().min(1),
    /** Giờ Việt Nam, dạng `2026-11-02 10:15:30`. */
    transactionDateTime: z.string(),
    code: z.string(),
  }),
})
export type PayosWebhook = z.infer<typeof PayosWebhook>

/** Nút "Giả lập đã thanh toán" của cổng giả lập: mã đơn và số tiền (đúng tổng, hoặc số khác để thử lệch tiền). */
export const SimulatedPaymentRequest = z.object({
  orderCode: z.number().int().positive(),
  amount: z.number().int().positive('Số tiền phải lớn hơn 0'),
})
export type SimulatedPaymentRequest = z.infer<typeof SimulatedPaymentRequest>
