import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { PaymentGatewayError, type PaymentGateway, type PaymentInfo, type PaymentLinkRequest } from './gateway.ts'

const sortKeys = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  )

function fieldText(value: unknown): string {
  if (value === null || value === undefined || value === 'null' || value === 'undefined') return ''
  // Như SDK chính thức: mảng thành JSON, mỗi phần tử object có key xếp alphabet.
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((v) => (v && typeof v === 'object' ? sortKeys(v as Record<string, unknown>) : v)))
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Chữ ký PayOS của `data`: HMAC-SHA256 (hex) trên `key=value` xếp theo alphabet, nối bằng `&`; `null` thành rỗng. */
export function payosSignature(data: Record<string, unknown>, checksumKey: string) {
  const text = Object.keys(data)
    .sort()
    .map((key) => `${key}=${fieldText(data[key])}`)
    .join('&')
  return createHmac('sha256', checksumKey).update(text).digest('hex')
}

/** Webhook có đúng chữ ký của PayOS không; so sánh thời gian hằng. */
export function isValidPayosSignature(data: Record<string, unknown>, signature: string, checksumKey: string) {
  const expected = Buffer.from(payosSignature(data, checksumKey), 'hex')
  const actual = Buffer.from(signature, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** PayOS gửi giờ Việt Nam không kèm múi giờ, dạng `2026-11-02 10:15:30`; không đọc được thì `null`. */
export function parsePayosDateTime(text: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(text)
  if (!match) return null
  const date = new Date(`${match[1]}T${match[2]}+07:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Gốc API PayOS; PayOS không có môi trường sandbox (ADR 0008). */
export const PAYOS_API_URL = 'https://api-merchant.payos.vn'

export type PayosKeys = { clientId: string; apiKey: string; checksumKey: string }

const STATUS: Record<string, PaymentInfo['status']> = {
  PENDING: 'pending',
  // Ngân hàng đang xử lý: tiền chưa về.
  PROCESSING: 'pending',
  PAID: 'paid',
  UNDERPAID: 'underpaid',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  FAILED: 'failed',
}

const Envelope = z.object({
  code: z.string(),
  desc: z.string().optional(),
  data: z.unknown(),
  signature: z.string().optional(),
})
const CreatedLink = z.looseObject({ checkoutUrl: z.url() })
const Transaction = z.looseObject({
  reference: z.string().min(1),
  amount: z.number().int().positive(),
  transactionDateTime: z.string(),
})
const PaymentLink = z.looseObject({
  status: z.string().refine((s) => s in STATUS),
  amountPaid: z.number().int().nonnegative(),
  transactions: z.array(Transaction),
})

/**
 * Cổng PayOS thật qua API v2 (https://payos.vn/docs/api/), gọi bằng `fetch` theo cách SDK `@payos/node` 2.0.5 làm:
 * header `x-client-id`/`x-api-key`, envelope `{ code, desc, data, signature }` với `code` `00` là thành công,
 * và kiểm chữ ký `data` của response khi PayOS gửi kèm. Không tự thử lại: tạo link nằm trong transaction đặt mua.
 */
export class PayosPaymentGateway implements PaymentGateway {
  private readonly fetch: typeof globalThis.fetch

  constructor(private readonly options: PayosKeys & { fetch?: typeof globalThis.fetch; baseUrl?: string }) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async createLink(request: PaymentLinkRequest) {
    const body = {
      orderCode: request.orderCode,
      amount: request.amount,
      description: request.description,
      returnUrl: request.returnUrl,
      cancelUrl: request.cancelUrl,
      expiredAt: Math.floor(request.expiresAt.getTime() / 1000),
    }
    // PayOS chỉ ký năm trường này khi tạo link (webhook thì ký mọi trường của `data`).
    const signed =
      `amount=${body.amount}&cancelUrl=${body.cancelUrl}&description=${body.description}` +
      `&orderCode=${body.orderCode}&returnUrl=${body.returnUrl}`
    const signature = createHmac('sha256', this.options.checksumKey).update(signed).digest('hex')
    const data = await this.call('POST', '/v2/payment-requests', { ...body, signature })
    return { checkoutUrl: this.read(CreatedLink, data).checkoutUrl }
  }

  async getPayment(orderCode: number): Promise<PaymentInfo> {
    const link = this.read(PaymentLink, await this.call('GET', `/v2/payment-requests/${orderCode}`))
    return {
      status: STATUS[link.status]!,
      amountPaid: link.amountPaid,
      transactions: link.transactions.map((t) => {
        const paidAt = parsePayosDateTime(t.transactionDateTime)
        if (!paidAt) throw new PaymentGatewayError(`PayOS: không đọc được giờ giao dịch ${t.transactionDateTime}`)
        return { reference: t.reference, amount: t.amount, paidAt, payload: t }
      }),
    }
  }

  async cancelLink(orderCode: number) {
    await this.call('POST', `/v2/payment-requests/${orderCode}/cancel`, { cancellationReason: 'Đơn đã hủy' })
  }

  private read<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
    const result = schema.safeParse(data)
    if (!result.success) throw new PaymentGatewayError('PayOS: response không đúng định dạng', { cause: result.error })
    return result.data
  }

  /** Gọi API, trả `data` đã kiểm chữ ký; mọi lỗi thành `PaymentGatewayError`. */
  private async call(method: 'GET' | 'POST', path: string, body?: object): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetch(new URL(path, this.options.baseUrl ?? PAYOS_API_URL), {
        method,
        headers: {
          'x-client-id': this.options.clientId,
          'x-api-key': this.options.apiKey,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        // Đặt mua chờ cổng trong transaction 30 giây; chừa thời gian cho phần còn lại.
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      throw new PaymentGatewayError('PayOS: không gọi được API', { cause: err })
    }
    if (!res.ok) throw new PaymentGatewayError(`PayOS trả HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)

    const envelope = this.read(Envelope, await res.json().catch(() => undefined))
    if (envelope.code !== '00' || !envelope.data) {
      throw new PaymentGatewayError(`PayOS ${envelope.code}: ${envelope.desc ?? ''}`)
    }
    const data = envelope.data
    if (envelope.signature) {
      const valid =
        typeof data === 'object' &&
        !Array.isArray(data) &&
        isValidPayosSignature(data as Record<string, unknown>, envelope.signature, this.options.checksumKey)
      if (!valid) throw new PaymentGatewayError('PayOS: chữ ký response không khớp')
    }
    return data
  }
}
