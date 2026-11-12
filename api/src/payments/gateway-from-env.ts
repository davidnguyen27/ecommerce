import { z } from 'zod'
import { SimulatorPaymentGateway, type PaymentGateway } from './gateway.ts'
import { VnpayPaymentGateway, type VnpayKeys } from './vnpay.ts'

/** Khóa để trống hay chỉ có khoảng trắng coi như chưa đặt (`.env.example` để trống). */
const optional = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined)

const PaymentEnv = z.object({
  NODE_ENV: optional,
  VNPAY_TMN_CODE: optional,
  VNPAY_HASH_SECRET: optional,
  /** Mặc định `sandbox`: thanh toán thật cần đặt rõ `production` (quyết định 2026-11-11, chỉ chạy sandbox trước). */
  VNPAY_ENV: optional.pipe(
    z.enum(['sandbox', 'production'], { error: 'VNPAY_ENV chỉ nhận sandbox hoặc production' }).default('sandbox'),
  ),
  /** `vnp_IpAddr` khi API truy vấn VNPAY: IP máy chủ; mặc định 127.0.0.1. */
  VNPAY_SERVER_IP: optional,
  /**
   * `allow`: cho cổng giả lập, hay VNPAY sandbox, dù `NODE_ENV=production`. Chỉ dùng cho smoke/CI và chạy image trên
   * máy.
   */
  PAYMENT_SIMULATOR: optional,
})

const KEY_NAMES = ['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET'] as const

/** Đường IPN trên API (`routes/payments.ts`); khai với VNPAY, không gửi theo từng đơn. */
export const VNPAY_IPN_PATH = '/api/payments/vnpay/ipn'

/** Khóa VNPAY khi đặt đủ cả hai; chưa đặt khóa nào thì `undefined`; đặt thiếu thì ném vì đó là cấu hình sai. */
export function vnpayKeysFromEnv(env: NodeJS.ProcessEnv): VnpayKeys | undefined {
  const parsed = PaymentEnv.parse(env)
  const missing = KEY_NAMES.filter((name) => !parsed[name])
  if (missing.length === KEY_NAMES.length) return undefined
  if (missing.length > 0) throw new Error(`Cấu hình VNPAY thiếu ${missing.join(', ')}`)
  return { tmnCode: parsed.VNPAY_TMN_CODE!, hashSecret: parsed.VNPAY_HASH_SECRET!, env: parsed.VNPAY_ENV }
}

/**
 * Chọn cổng thanh toán (spec "Thanh toán", ADR 0010): đủ khóa VNPAY thì dùng VNPAY; chưa có khóa thì dùng cổng giả
 * lập. Với `NODE_ENV=production`, thiếu khóa hay khóa sandbox đều làm API không khởi động (cổng giả lập cho ai cũng báo
 * được "đã thanh toán", sandbox không nhận tiền thật), trừ khi bật rõ `PAYMENT_SIMULATOR=allow`. Image Docker luôn chạy
 * `NODE_ENV=production`, nên smoke/CI và docker compose local phải đặt dòng đó.
 */
export function paymentGatewayFromEnv(env: NodeJS.ProcessEnv, siteUrl: string): PaymentGateway {
  const keys = vnpayKeysFromEnv(env)
  const { NODE_ENV, PAYMENT_SIMULATOR, VNPAY_SERVER_IP } = PaymentEnv.parse(env)
  const guarded = NODE_ENV === 'production' && PAYMENT_SIMULATOR !== 'allow'
  if (keys) {
    if (guarded && keys.env === 'sandbox') {
      throw new Error(
        'NODE_ENV=production đang dùng VNPAY sandbox, không nhận tiền thật. Đặt VNPAY_ENV=production với khóa thật; ' +
          'chỉ khi chạy thử image trên máy mới đặt PAYMENT_SIMULATOR=allow.',
      )
    }
    return new VnpayPaymentGateway({ ...keys, serverIp: VNPAY_SERVER_IP })
  }
  if (guarded) {
    throw new Error(
      `NODE_ENV=production cần ${KEY_NAMES.join(', ')} (đăng ký sandbox ở pay.vnpaytest.vn/dev-registration). ` +
        'Chỉ khi chạy thử image trên máy mới đặt PAYMENT_SIMULATOR=allow để dùng cổng giả lập.',
    )
  }
  return new SimulatorPaymentGateway(siteUrl)
}
