import { z } from 'zod'
import { SimulatorPaymentGateway, type PaymentGateway } from './gateway.ts'
import { VnpayPaymentGateway, type VnpayKeys } from './vnpay.ts'

/** Empty or whitespace-only keys count as unset (`.env.example` leaves them empty). */
const optional = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined)

const PaymentEnv = z.object({
  NODE_ENV: optional,
  VNPAY_TMN_CODE: optional,
  VNPAY_HASH_SECRET: optional,
  /** Defaults to `sandbox`: real payments need an explicit `production` (decided 2026-11-11, sandbox first). */
  VNPAY_ENV: optional.pipe(
    z.enum(['sandbox', 'production'], { error: 'VNPAY_ENV chỉ nhận sandbox hoặc production' }).default('sandbox'),
  ),
  /** `vnp_IpAddr` when the API queries VNPAY: the server IP; defaults to 127.0.0.1. */
  VNPAY_SERVER_IP: optional,
  /**
   * `allow`: permits the simulator, or VNPAY sandbox, even with `NODE_ENV=production`. Only for smoke/CI and running
   * the image locally.
   */
  PAYMENT_SIMULATOR: optional,
})

const KEY_NAMES = ['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET'] as const

/** IPN path on the API (`routes/payments.ts`); registered with VNPAY, not sent per order. */
export const VNPAY_IPN_PATH = '/api/payments/vnpay/ipn'

/** VNPAY keys when both are set; `undefined` when neither; throws when only one, since that is a misconfiguration. */
export function vnpayKeysFromEnv(env: NodeJS.ProcessEnv): VnpayKeys | undefined {
  const parsed = PaymentEnv.parse(env)
  const missing = KEY_NAMES.filter((name) => !parsed[name])
  if (missing.length === KEY_NAMES.length) return undefined
  if (missing.length > 0) throw new Error(`Cấu hình VNPAY thiếu ${missing.join(', ')}`)
  return { tmnCode: parsed.VNPAY_TMN_CODE!, hashSecret: parsed.VNPAY_HASH_SECRET!, env: parsed.VNPAY_ENV }
}

/**
 * Picks the payment gateway (spec "Thanh toán", ADR 0010): VNPAY with full keys, else the simulator. With
 * `NODE_ENV=production`, missing or sandbox keys stop the API (the simulator lets anyone report "paid", sandbox takes
 * no real money) unless `PAYMENT_SIMULATOR=allow`. The Docker image always runs `NODE_ENV=production`, so smoke/CI and
 * local docker compose must set that line.
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
