import { z } from 'zod'

/**
 * Query của IPN VNPAY báo kết quả thanh toán (ADR 0010). Chữ ký kiểm trên toàn bộ tham số `vnp_*` gốc trước khi parse;
 * schema chỉ giữ các trường hệ thống dùng, các trường khác được giữ nguyên.
 */
export const VnpayIpnQuery = z.looseObject({
  vnp_TxnRef: z.string(),
  /** VND ×100. */
  vnp_Amount: z.string().regex(/^\d+$/),
  /** `00` cùng `vnp_TransactionStatus` `00` mới là trả thành công. */
  vnp_ResponseCode: z.string(),
  vnp_TransactionStatus: z.string(),
  /** Mã giao dịch VNPAY, dùng làm mã tham chiếu của khoản tiền. */
  vnp_TransactionNo: z.string(),
  /** `yyyyMMddHHmmss`, GMT+7. */
  vnp_PayDate: z.string().optional(),
})
export type VnpayIpnQuery = z.infer<typeof VnpayIpnQuery>

/**
 * Trả lời IPN (tài liệu VNPAY): `00` đã nhận, `01` không thấy đơn, `02` đã xác nhận trước đó, `97` sai chữ ký, `99` lỗi
 * khác. `00` và `02` làm VNPAY thôi gửi; mã khác VNPAY gửi lại.
 */
export type VnpayIpnResult = { RspCode: '00' | '01' | '02' | '97' | '99'; Message: string }

/** Nút "Giả lập đã thanh toán" của cổng giả lập: mã đơn và số tiền (đúng tổng, hoặc số khác để thử lệch tiền). */
export const SimulatedPaymentRequest = z.object({
  orderCode: z.number().int().positive(),
  amount: z.number().int().positive('Số tiền phải lớn hơn 0'),
})
export type SimulatedPaymentRequest = z.infer<typeof SimulatedPaymentRequest>

/** Nút "Giả lập hết hạn" của cổng giả lập: đơn hết hạn giữ hàng ngay. */
export const SimulatedExpiryRequest = z.object({ orderCode: z.number().int().positive() })
export type SimulatedExpiryRequest = z.infer<typeof SimulatedExpiryRequest>
