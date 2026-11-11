import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { PaymentGatewayError, type PaymentGateway, type PaymentInfo, type PaymentLinkRequest } from './gateway.ts'

// Theo tài liệu ZaloPay v2 (https://developers.zalopay.vn/v2/general/overview.html, đọc 2026-11-09) và repo mẫu
// chính thức https://github.com/zalopay-samples/quickstart-payment-gateway. Những điểm đánh dấu "kiểm trên sandbox"
// chưa xác minh được từ tài liệu; ticket 16 kiểm trên sandbox.

/** Gốc API ZaloPay theo môi trường. */
export const ZALOPAY_HOSTS = {
  sandbox: 'https://sb-openapi.zalopay.vn',
  production: 'https://openapi.zalopay.vn',
} as const

export type ZaloPayEnv = keyof typeof ZALOPAY_HOSTS

export type ZaloPayKeys = {
  appId: string
  /** Ký request gửi ZaloPay (tạo đơn, truy vấn). */
  key1: string
  /** Kiểm MAC callback ZaloPay gửi về. */
  key2: string
  env: ZaloPayEnv
}

/** HMAC-SHA256 (hex), cách ZaloPay ký mọi thứ; `text` là chuỗi đã nối theo từng API. */
export function zalopayMac(text: string, key: string) {
  return createHmac('sha256', key).update(text).digest('hex')
}

/** Callback có đúng MAC (key2 trên chuỗi `data` gốc) không; so sánh thời gian hằng. */
export function isValidZaloPayCallback(data: string, mac: string, key2: string) {
  const expected = Buffer.from(zalopayMac(data, key2), 'hex')
  const actual = Buffer.from(/^[0-9a-f]+$/i.test(mac) ? mac : '', 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const VN_OFFSET_MS = 7 * 60 * 60_000

/**
 * `app_trans_id` của đơn: `yymmdd` theo GMT+7 của lúc tạo, `_`, mã đơn, `_`, đoạn ngẫu nhiên. ZaloPay đòi tiền tố ngày
 * hiện tại và không cho trùng trong app (lỗi -68). Mã đơn chỉ duy nhất trong một DB: reset DB thì đánh lại từ đầu, và
 * merchant sandbox công khai dùng chung cho mọi người, nên cần thêm đoạn ngẫu nhiên. Tối đa 6+1+15+1+8 = 31 ký tự
 * (ZaloPay cho 40). Truy vấn dùng `gateway_reference` đã lưu, nên không cần dựng lại chuỗi này.
 */
export function appTransId(orderCode: number, now: Date, nonce = randomBytes(4).toString('hex')) {
  const vn = new Date(now.getTime() + VN_OFFSET_MS).toISOString()
  return `${vn.slice(2, 4)}${vn.slice(5, 7)}${vn.slice(8, 10)}_${orderCode}_${nonce}`
}

/** Mã đơn trong `app_trans_id` do `appTransId` tạo (nhận cả dạng cũ không có đoạn ngẫu nhiên); mã lạ thì `null`. */
export function orderCodeFromAppTransId(id: string): number | null {
  const match = /^\d{6}_(\d{1,15})(?:_[0-9a-f]{8})?$/.exec(id)
  return match ? Number(match[1]) : null
}

/** ZaloPay giới hạn `expire_duration_seconds` từ 5 phút tới 30 ngày. */
const MIN_EXPIRY_SECONDS = 300
const MAX_EXPIRY_SECONDS = 2_592_000

const Result = z.looseObject({
  return_code: z.number().int(),
  return_message: z.string().optional(),
  sub_return_code: z.number().int().optional(),
  sub_return_message: z.string().optional(),
})
const Created = z.looseObject({ order_url: z.url() })
// Tài liệu liệt kê `amount`, `discount_amount`, `zp_trans_id`, `is_processing`, không có `server_time`; sandbox
// (2026-11-10, đơn chưa trả) trả đúng các trường đó. Phòng khi có thì đọc, thiếu thì lấy giờ truy vấn.
const Paid = z.looseObject({
  zp_trans_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  amount: z.number().int().positive(),
  server_time: z.number().int().positive().optional(),
})

/**
 * Cổng ZaloPay thật (ADR 0009) qua API v2, gọi bằng `fetch`. Không tự thử lại: tạo link nằm trong transaction đặt mua.
 * `app_user` là mã đơn: không gửi email hay số điện thoại khách cho cổng.
 */
export class ZaloPayPaymentGateway implements PaymentGateway {
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => Date

  constructor(
    private readonly options: ZaloPayKeys & {
      /** URL ZaloPay gọi khi tiền về; không đặt thì ZaloPay dùng URL cấu hình ở trang merchant. */
      callbackUrl?: string
      fetch?: typeof globalThis.fetch
      baseUrl?: string
      now?: () => Date
      /** Đoạn ngẫu nhiên cuối `app_trans_id`; test truyền giá trị cố định. */
      nonce?: () => string
    },
  ) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? (() => new Date())
  }

  async createLink(request: PaymentLinkRequest) {
    const now = this.now()
    const order = {
      app_id: this.options.appId,
      app_trans_id: appTransId(request.orderCode, now, this.options.nonce?.()),
      app_user: String(request.orderCode),
      app_time: String(now.getTime()),
      amount: String(request.amount),
      item: '[]',
      embed_data: JSON.stringify({ redirecturl: request.returnUrl }),
      description: request.description,
      // Rỗng: khách tự chọn ví, thẻ hay ngân hàng ở trang ZaloPay.
      bank_code: '',
      expire_duration_seconds: String(
        Math.min(
          MAX_EXPIRY_SECONDS,
          Math.max(MIN_EXPIRY_SECONDS, Math.round((request.expiresAt.getTime() - now.getTime()) / 1000)),
        ),
      ),
      ...(this.options.callbackUrl ? { callback_url: this.options.callbackUrl } : {}),
    }
    const mac = zalopayMac(
      [
        order.app_id,
        order.app_trans_id,
        order.app_user,
        order.amount,
        order.app_time,
        order.embed_data,
        order.item,
      ].join('|'),
      this.options.key1,
    )
    const body = await this.call('/v2/create', { ...order, mac })
    if (body.return_code !== 1) throw this.failure(body)
    return { checkoutUrl: this.read(Created, body).order_url, gatewayReference: order.app_trans_id }
  }

  async getPayment(gatewayReference: string): Promise<PaymentInfo> {
    const { appId, key1 } = this.options
    const body = await this.call('/v2/query', {
      app_id: appId,
      app_trans_id: gatewayReference,
      mac: zalopayMac(`${appId}|${gatewayReference}|${key1}`, key1),
    })
    switch (body.return_code) {
      case 1: {
        const paid = this.read(Paid, body)
        const paidAt = paid.server_time ? new Date(paid.server_time) : this.now()
        return {
          status: 'paid',
          transactions: [{ reference: String(paid.zp_trans_id), amount: paid.amount, paidAt, payload: body }],
        }
      }
      case 2:
        return { status: 'failed', transactions: [] }
      case 3:
        // Chưa trả, hoặc ZaloPay đang xử lý (`is_processing`): tiền chưa về.
        return { status: 'pending', transactions: [] }
      default:
        throw this.failure(body)
    }
  }

  async cancelLink() {
    // ZaloPay không có API hủy đơn chưa thanh toán (ADR 0009): trang thanh toán tự hết hạn theo
    // `expire_duration_seconds`; tiền về cho đơn đã hủy thành cần đối soát.
  }

  private failure(body: z.infer<typeof Result>) {
    return new PaymentGatewayError(
      `ZaloPay ${body.return_code}/${body.sub_return_code ?? ''}: ${body.sub_return_message ?? body.return_message ?? ''}`,
    )
  }

  private read<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
    const result = schema.safeParse(data)
    if (!result.success)
      throw new PaymentGatewayError('ZaloPay: response không đúng định dạng', { cause: result.error })
    return result.data
  }

  /** POST form-urlencoded (đã thử trên sandbox 2026-11-10: tạo đơn và truy vấn đều nhận); mọi lỗi thành `PaymentGatewayError`. */
  private async call(path: string, form: Record<string, string>) {
    let res: Response
    try {
      res = await this.fetch(new URL(path, this.options.baseUrl ?? ZALOPAY_HOSTS[this.options.env]), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        // Đặt mua chờ cổng trong transaction 30 giây; chừa thời gian cho phần còn lại.
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      throw new PaymentGatewayError('ZaloPay: không gọi được API', { cause: err })
    }
    if (!res.ok) throw new PaymentGatewayError(`ZaloPay trả HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return this.read(Result, await res.json().catch(() => undefined))
  }
}
