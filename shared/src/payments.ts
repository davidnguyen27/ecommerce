import { z } from 'zod'

/**
 * Callback ZaloPay báo tiền về (ADR 0009). MAC kiểm trên chuỗi `data` gốc trước khi parse `data`; `type` 1 là đơn
 * thanh toán.
 */
export const ZaloPayCallback = z.object({
  /** Chuỗi JSON, parse bằng `ZaloPayCallbackData` sau khi kiểm MAC. */
  data: z.string(),
  /** HMAC-SHA256 (hex) bằng key2 trên `data`. */
  mac: z.string(),
  type: z.number().int().optional(),
})
export type ZaloPayCallback = z.infer<typeof ZaloPayCallback>

/** Nội dung `data` của callback; schema chỉ giữ các trường hệ thống dùng, các trường khác được giữ nguyên. */
export const ZaloPayCallbackData = z.looseObject({
  app_trans_id: z.string(),
  /** VND. Kiểm trên sandbox: có tính `discount_amount`/`user_fee_amount` không. */
  amount: z.number().int().positive(),
  /** Mã giao dịch ZaloPay, dùng làm mã tham chiếu của khoản tiền. */
  zp_trans_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  /** Giờ ZaloPay ghi nhận, Unix ms. */
  server_time: z.number().int().positive(),
})
export type ZaloPayCallbackData = z.infer<typeof ZaloPayCallbackData>

/** Trả lời callback, luôn kèm HTTP 200: `1` đã nhận, `-1` sai MAC, `0` lỗi phía hệ thống để ZaloPay gửi lại. */
export type ZaloPayCallbackResult = { return_code: 1 | 0 | -1; return_message: string }

/** Nút "Giả lập đã thanh toán" của cổng giả lập: mã đơn và số tiền (đúng tổng, hoặc số khác để thử lệch tiền). */
export const SimulatedPaymentRequest = z.object({
  orderCode: z.number().int().positive(),
  amount: z.number().int().positive('Số tiền phải lớn hơn 0'),
})
export type SimulatedPaymentRequest = z.infer<typeof SimulatedPaymentRequest>

/** Nút "Giả lập hết hạn" của cổng giả lập: đơn hết hạn giữ hàng ngay. */
export const SimulatedExpiryRequest = z.object({ orderCode: z.number().int().positive() })
export type SimulatedExpiryRequest = z.infer<typeof SimulatedExpiryRequest>
