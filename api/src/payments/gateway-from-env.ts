import { z } from 'zod'
import { SimulatorPaymentGateway, type PaymentGateway } from './gateway.ts'
import { ZaloPayPaymentGateway, type ZaloPayKeys } from './zalopay.ts'

/** Khóa để trống hay chỉ có khoảng trắng coi như chưa đặt (`.env.example` để trống). */
const optional = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined)

const PaymentEnv = z.object({
  NODE_ENV: optional,
  ZALOPAY_APP_ID: optional,
  ZALOPAY_KEY1: optional,
  ZALOPAY_KEY2: optional,
  /** Mặc định `sandbox`: thanh toán thật cần đặt rõ `production` (quyết định 2026-11-09, chỉ chạy sandbox trước). */
  ZALOPAY_ENV: optional.pipe(
    z.enum(['sandbox', 'production'], { error: 'ZALOPAY_ENV chỉ nhận sandbox hoặc production' }).default('sandbox'),
  ),
  /** URL ZaloPay gọi khi tiền về, ví dụ qua tunnel khi thử sandbox trên máy; mặc định theo SITE_URL. */
  ZALOPAY_CALLBACK_URL: optional,
  /**
   * `allow`: cho cổng giả lập, hay ZaloPay sandbox, dù `NODE_ENV=production`. Chỉ dùng cho smoke/CI và chạy image
   * trên máy.
   */
  PAYMENT_SIMULATOR: optional,
})

const KEY_NAMES = ['ZALOPAY_APP_ID', 'ZALOPAY_KEY1', 'ZALOPAY_KEY2'] as const

/** Đường callback ZaloPay trên API (`routes/payments.ts`). */
export const ZALOPAY_CALLBACK_PATH = '/api/payments/zalopay/callback'

/** Khóa ZaloPay khi đặt đủ cả ba; chưa đặt khóa nào thì `undefined`; đặt thiếu thì ném vì đó là cấu hình sai. */
export function zalopayKeysFromEnv(env: NodeJS.ProcessEnv): ZaloPayKeys | undefined {
  const parsed = PaymentEnv.parse(env)
  const missing = KEY_NAMES.filter((name) => !parsed[name])
  if (missing.length === KEY_NAMES.length) return undefined
  if (missing.length > 0) throw new Error(`Cấu hình ZaloPay thiếu ${missing.join(', ')}`)
  return {
    appId: parsed.ZALOPAY_APP_ID!,
    key1: parsed.ZALOPAY_KEY1!,
    key2: parsed.ZALOPAY_KEY2!,
    env: parsed.ZALOPAY_ENV,
  }
}

/**
 * Chọn cổng thanh toán (spec "Thanh toán", ADR 0009): đủ khóa ZaloPay thì dùng ZaloPay; chưa có khóa thì dùng cổng giả
 * lập. Với `NODE_ENV=production`, thiếu khóa hay khóa sandbox đều làm API không khởi động (cổng giả lập cho ai cũng báo
 * được "đã thanh toán", sandbox không nhận tiền thật), trừ khi bật rõ `PAYMENT_SIMULATOR=allow`. Image Docker luôn chạy
 * `NODE_ENV=production`, nên smoke/CI và docker compose local phải đặt dòng đó.
 */
export function paymentGatewayFromEnv(env: NodeJS.ProcessEnv, siteUrl: string): PaymentGateway {
  const keys = zalopayKeysFromEnv(env)
  const { NODE_ENV, PAYMENT_SIMULATOR, ZALOPAY_CALLBACK_URL } = PaymentEnv.parse(env)
  const guarded = NODE_ENV === 'production' && PAYMENT_SIMULATOR !== 'allow'
  if (keys) {
    if (guarded && keys.env === 'sandbox') {
      throw new Error(
        'NODE_ENV=production đang dùng ZaloPay sandbox, không nhận tiền thật. Đặt ZALOPAY_ENV=production với khóa ' +
          'thật; chỉ khi chạy thử image trên máy mới đặt PAYMENT_SIMULATOR=allow.',
      )
    }
    return new ZaloPayPaymentGateway({
      ...keys,
      callbackUrl: ZALOPAY_CALLBACK_URL ?? new URL(ZALOPAY_CALLBACK_PATH, siteUrl).toString(),
    })
  }
  if (guarded) {
    throw new Error(
      `NODE_ENV=production cần ${KEY_NAMES.join(', ')} (lấy ở sbmc.zalopay.vn cho sandbox, mc.zalopay.vn cho thật). ` +
        'Chỉ khi chạy thử image trên máy mới đặt PAYMENT_SIMULATOR=allow để dùng cổng giả lập.',
    )
  }
  return new SimulatorPaymentGateway(siteUrl)
}
