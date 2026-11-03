import { z } from 'zod'
import { SimulatorPaymentGateway, type PaymentGateway } from './gateway.ts'
import { PayosPaymentGateway, type PayosKeys } from './payos.ts'

/** Khóa để trống hay chỉ có khoảng trắng coi như chưa đặt (`.env.example` để trống). */
const optional = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined)

const PaymentEnv = z.object({
  NODE_ENV: optional,
  PAYOS_CLIENT_ID: optional,
  PAYOS_API_KEY: optional,
  PAYOS_CHECKSUM_KEY: optional,
  /** `allow`: cho cổng giả lập dù `NODE_ENV=production`, chỉ dùng cho smoke/CI và chạy image trên máy. */
  PAYMENT_SIMULATOR: optional,
})

const KEY_NAMES = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'] as const

/** Khóa PayOS khi đặt đủ cả ba; chưa đặt khóa nào thì `undefined`; đặt thiếu thì ném vì đó là cấu hình sai. */
export function payosKeysFromEnv(env: NodeJS.ProcessEnv): PayosKeys | undefined {
  const parsed = PaymentEnv.parse(env)
  const missing = KEY_NAMES.filter((name) => !parsed[name])
  if (missing.length === KEY_NAMES.length) return undefined
  if (missing.length > 0) throw new Error(`Cấu hình PayOS thiếu ${missing.join(', ')}`)
  return { clientId: parsed.PAYOS_CLIENT_ID!, apiKey: parsed.PAYOS_API_KEY!, checksumKey: parsed.PAYOS_CHECKSUM_KEY! }
}

/**
 * Chọn cổng thanh toán (spec "Thanh toán"): đủ khóa PayOS thì dùng PayOS; chưa có khóa thì dùng cổng giả lập, trừ
 * khi `NODE_ENV=production`: khi đó ném để API không khởi động, vì cổng giả lập cho ai cũng báo được "đã thanh toán".
 * Image Docker luôn chạy `NODE_ENV=production`, nên smoke/CI phải bật rõ `PAYMENT_SIMULATOR=allow`.
 */
export function paymentGatewayFromEnv(env: NodeJS.ProcessEnv, siteUrl: string): PaymentGateway {
  const keys = payosKeysFromEnv(env)
  if (keys) return new PayosPaymentGateway(keys)
  const { NODE_ENV, PAYMENT_SIMULATOR } = PaymentEnv.parse(env)
  if (NODE_ENV === 'production' && PAYMENT_SIMULATOR !== 'allow') {
    throw new Error(
      `NODE_ENV=production cần ${KEY_NAMES.join(', ')} (lấy ở my.payos.vn, kênh thanh toán). ` +
        'Chỉ khi chạy thử image trên máy mới đặt PAYMENT_SIMULATOR=allow để dùng cổng giả lập.',
    )
  }
  return new SimulatorPaymentGateway(siteUrl)
}
