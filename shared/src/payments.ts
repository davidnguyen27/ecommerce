import { z } from 'zod'

/**
 * VNPAY IPN query reporting a payment result (ADR 0010). The signature is checked over all original `vnp_*` params
 * before parsing; the schema keeps only the fields we use and passes the rest through.
 */
export const VnpayIpnQuery = z.looseObject({
  vnp_TxnRef: z.string(),
  /** VND ×100. */
  vnp_Amount: z.string().regex(/^\d+$/),
  /** `00` with `vnp_TransactionStatus` `00` is a successful payment. */
  vnp_ResponseCode: z.string(),
  vnp_TransactionStatus: z.string(),
  /** VNPAY transaction number, used as the payment reference. */
  vnp_TransactionNo: z.string(),
  /** `yyyyMMddHHmmss`, GMT+7. */
  vnp_PayDate: z.string().optional(),
})
export type VnpayIpnQuery = z.infer<typeof VnpayIpnQuery>

/**
 * IPN reply (VNPAY docs): `00` received, `01` order not found, `02` already confirmed, `97` bad signature, `99` other
 * error. `00` and `02` stop VNPAY resending; other codes make it retry.
 */
export type VnpayIpnResult = { RspCode: '00' | '01' | '02' | '97' | '99'; Message: string }

/** The simulator's "Giả lập đã thanh toán" button: order code and amount (the total, or another to test a mismatch). */
export const SimulatedPaymentRequest = z.object({
  orderCode: z.number().int().positive(),
  amount: z.number().int().positive('Số tiền phải lớn hơn 0'),
  /** Link ref (`ref` on the simulator URL), so the transaction gets the right purpose; missing means full payment. */
  gatewayReference: z.string().min(1).max(100).optional(),
})
export type SimulatedPaymentRequest = z.infer<typeof SimulatedPaymentRequest>

/** The simulator's "Giả lập hết hạn" button: the reservation expires now. */
export const SimulatedExpiryRequest = z.object({ orderCode: z.number().int().positive() })
export type SimulatedExpiryRequest = z.infer<typeof SimulatedExpiryRequest>
