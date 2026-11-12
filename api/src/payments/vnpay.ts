import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { PaymentGatewayError, type PaymentGateway, type PaymentInfo, type PaymentLinkRequest } from './gateway.ts'

// Theo tài liệu VNPAY (https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html và
// .../truy-van-hoan-tien/querydr&refund.html, đọc 2026-11-11). Những điểm đánh dấu "kiểm trên sandbox" tài liệu chưa
// nói rõ; ticket 16 kiểm.

/**
 * Địa chỉ VNPAY theo môi trường. Bản production không có trong tài liệu đã đọc: lấy theo hiểu biết chung, phải kiểm
 * lại khi ký hợp đồng.
 */
export const VNPAY_HOSTS = {
  sandbox: {
    payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    apiUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
  },
  production: {
    payUrl: 'https://pay.vnpay.vn/vpcpay.html',
    apiUrl: 'https://merchant.vnpay.vn/merchant_webapi/api/transaction',
  },
} as const

export type VnpayEnv = keyof typeof VNPAY_HOSTS

export type VnpayKeys = {
  /** `vnp_TmnCode`, mã định danh kết nối. */
  tmnCode: string
  /** `vnp_HashSecret`, ký URL thanh toán, IPN và truy vấn. */
  hashSecret: string
  env: VnpayEnv
}

const VERSION = '2.1.0'

/** HMAC-SHA512 (hex), cách VNPAY ký mọi thứ. */
export function vnpayHmac(text: string, secret: string) {
  return createHmac('sha512', secret).update(text, 'utf8').digest('hex')
}

/** Encode như `urlencode` của PHP, cách mẫu PHP/Java của VNPAY ký: khoảng trắng thành `+`. */
const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, '+')

/**
 * Chuỗi ký của URL thanh toán và IPN: mọi tham số `vnp_*` có giá trị, trừ `vnp_SecureHash`/`vnp_SecureHashType`,
 * sắp tăng dần theo tên, `key=value` đã encode, nối bằng `&`. Dùng luôn làm query của URL thanh toán.
 */
export function vnpaySignData(params: Record<string, unknown>) {
  return Object.entries(params)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].startsWith('vnp_') &&
        entry[0] !== 'vnp_SecureHash' &&
        entry[0] !== 'vnp_SecureHashType' &&
        typeof entry[1] === 'string' &&
        entry[1] !== '',
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&')
}

const sameHex = (actual: unknown, expected: string) => {
  if (typeof actual !== 'string' || !/^[0-9a-f]+$/i.test(actual)) return false
  const a = Buffer.from(actual.toLowerCase(), 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Tham số VNPAY gửi về (IPN, trang quay về) có đúng chữ ký không; so sánh thời gian hằng. */
export function isValidVnpaySignature(params: Record<string, unknown>, hashSecret: string) {
  return sameHex(params.vnp_SecureHash, vnpayHmac(vnpaySignData(params), hashSecret))
}

const VN_OFFSET_MS = 7 * 60 * 60_000

/** `yyyyMMddHHmmss` theo GMT+7, định dạng ngày giờ của VNPAY. */
export function vnDateTime(date: Date) {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().replace(/\D/g, '').slice(0, 14)
}

/** Đọc `yyyyMMddHHmmss` (GMT+7); sai định dạng thì `null`. */
export function parseVnDateTime(text: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text)
  if (!m) return null
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * `vnp_TxnRef` của đơn: mã đơn, `T`, giờ tạo link (`yyyyMMddHHmmss`, GMT+7). VNPAY không cho trùng trong ngày; mã đơn
 * chỉ duy nhất trong một DB (reset DB thì đánh lại), nên ghép thêm giờ tạo. Giờ này cũng là `vnp_TransactionDate` khi
 * truy vấn, nên không phải lưu riêng.
 */
export function txnRef(orderCode: number, createdAt: Date) {
  return `${orderCode}T${vnDateTime(createdAt)}`
}

/** Mã đơn và giờ tạo trong `vnp_TxnRef` do `txnRef` tạo; mã lạ thì `null`. */
export function parseTxnRef(ref: string): { orderCode: number; createDate: string } | null {
  const m = /^(\d{1,15})T(\d{14})$/.exec(ref)
  return m ? { orderCode: Number(m[1]), createDate: m[2]! } : null
}

/** `vnp_OrderInfo`: VNPAY đòi tiếng Việt không dấu, không ký tự đặc biệt, tối đa 255 ký tự. */
export function asciiOrderInfo(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255)
}

/** Kết quả thanh toán VNPAY gửi trong IPN và trả trong truy vấn: thành công khi cả hai mã là `00` (tài liệu). */
export const isVnpaySuccess = (params: { vnp_ResponseCode?: unknown; vnp_TransactionStatus?: unknown }) =>
  params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00'

const QueryResponse = z.looseObject({
  vnp_ResponseId: z.string().optional(),
  vnp_Command: z.string().optional(),
  vnp_ResponseCode: z.string(),
  vnp_Message: z.string().optional(),
  vnp_TmnCode: z.string().optional(),
  vnp_TxnRef: z.string().optional(),
  vnp_Amount: z.string().optional(),
  vnp_BankCode: z.string().optional(),
  vnp_PayDate: z.string().optional(),
  vnp_TransactionNo: z.string().optional(),
  vnp_TransactionType: z.string().optional(),
  vnp_TransactionStatus: z.string().optional(),
  vnp_OrderInfo: z.string().optional(),
  vnp_PromotionCode: z.string().optional(),
  vnp_PromotionAmount: z.string().optional(),
  vnp_SecureHash: z.string().optional(),
})
type QueryResponse = z.infer<typeof QueryResponse>

/** Thứ tự trường của chuỗi ký response truy vấn, nối bằng `|` (tài liệu querydr). */
const QUERY_RESPONSE_FIELDS = [
  'vnp_ResponseId',
  'vnp_Command',
  'vnp_ResponseCode',
  'vnp_Message',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_BankCode',
  'vnp_PayDate',
  'vnp_TransactionNo',
  'vnp_TransactionType',
  'vnp_TransactionStatus',
  'vnp_OrderInfo',
  'vnp_PromotionCode',
  'vnp_PromotionAmount',
] as const

/**
 * Cổng VNPAY (ADR 0010). Link thanh toán là URL ký sẵn, không gọi VNPAY; truy vấn gọi API `querydr` bằng `fetch`,
 * không tự thử lại. `vnp_OrderInfo` không mang thông tin khách.
 */
export class VnpayPaymentGateway implements PaymentGateway {
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => Date

  constructor(
    private readonly options: VnpayKeys & {
      /** `vnp_IpAddr` khi truy vấn: IP máy chủ gọi VNPAY. */
      serverIp?: string
      fetch?: typeof globalThis.fetch
      now?: () => Date
      /** `vnp_RequestId` của truy vấn; test truyền giá trị cố định. */
      requestId?: () => string
    },
  ) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? (() => new Date())
  }

  async createLink(request: PaymentLinkRequest) {
    const now = this.now()
    const ref = txnRef(request.orderCode, now)
    const params = {
      vnp_Version: VERSION,
      vnp_Command: 'pay',
      vnp_TmnCode: this.options.tmnCode,
      vnp_Amount: String(request.amount * 100),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: ref,
      vnp_OrderInfo: asciiOrderInfo(request.description),
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: request.returnUrl,
      vnp_IpAddr: request.clientIp,
      vnp_CreateDate: vnDateTime(now),
      vnp_ExpireDate: vnDateTime(request.expiresAt),
      // Không gửi `vnp_BankCode`: khách tự chọn ATM, thẻ quốc tế hay QR ở trang VNPAY.
    }
    const query = vnpaySignData(params)
    const checkoutUrl = `${VNPAY_HOSTS[this.options.env].payUrl}?${query}&vnp_SecureHash=${vnpayHmac(query, this.options.hashSecret)}`
    return { checkoutUrl, gatewayReference: ref }
  }

  async getPayment(gatewayReference: string): Promise<PaymentInfo> {
    const parsed = parseTxnRef(gatewayReference)
    if (!parsed) throw new PaymentGatewayError(`VNPAY: mã giao dịch lạ ${gatewayReference}`)
    const { tmnCode, hashSecret } = this.options
    const request = {
      vnp_RequestId: (this.options.requestId ?? (() => randomUUID().replace(/-/g, '')))(),
      vnp_Version: VERSION,
      vnp_Command: 'querydr',
      vnp_TmnCode: tmnCode,
      vnp_TxnRef: gatewayReference,
      vnp_OrderInfo: `Truy van don ${parsed.orderCode}`,
      vnp_TransactionDate: parsed.createDate,
      vnp_CreateDate: vnDateTime(this.now()),
      vnp_IpAddr: this.options.serverIp ?? '127.0.0.1',
    }
    // Kiểm trên sandbox: tài liệu chỉ ghi `hashWithSecureType`, coi như HMAC-SHA512 như URL thanh toán.
    const signed = [
      request.vnp_RequestId,
      request.vnp_Version,
      request.vnp_Command,
      request.vnp_TmnCode,
      request.vnp_TxnRef,
      request.vnp_TransactionDate,
      request.vnp_CreateDate,
      request.vnp_IpAddr,
      request.vnp_OrderInfo,
    ].join('|')
    const body = await this.call({ ...request, vnp_SecureHash: vnpayHmac(signed, hashSecret) })

    // 91: VNPAY chưa có giao dịch nào cho mã này, tức khách chưa trả.
    if (body.vnp_ResponseCode === '91') return { status: 'pending', transactions: [] }
    if (body.vnp_ResponseCode !== '00') {
      throw new PaymentGatewayError(`VNPAY querydr ${body.vnp_ResponseCode}: ${body.vnp_Message ?? ''}`)
    }
    const expected = vnpayHmac(QUERY_RESPONSE_FIELDS.map((field) => body[field] ?? '').join('|'), hashSecret)
    if (!sameHex(body.vnp_SecureHash, expected)) throw new PaymentGatewayError('VNPAY: response truy vấn sai chữ ký')

    if (isVnpaySuccess(body)) return { status: 'paid', transactions: [this.transaction(body)] }
    // 01: chưa hoàn tất (khách chưa trả xong); 02: lỗi; các mã khác (hoàn tiền, nghi gian lận) để nhân viên xem.
    if (body.vnp_TransactionStatus === '01') return { status: 'pending', transactions: [] }
    return { status: 'failed', transactions: [] }
  }

  async cancelLink() {
    // VNPAY không có API hủy URL thanh toán chưa trả (ADR 0010): URL tự hết hạn theo `vnp_ExpireDate`; tiền về cho
    // đơn đã hủy thành cần đối soát.
  }

  private transaction(body: QueryResponse) {
    const amount = Number(body.vnp_Amount) / 100
    if (!Number.isInteger(amount) || amount <= 0 || !body.vnp_TransactionNo) {
      throw new PaymentGatewayError('VNPAY: response truy vấn thiếu số tiền hay mã giao dịch')
    }
    return {
      reference: body.vnp_TransactionNo,
      amount,
      paidAt: (body.vnp_PayDate && parseVnDateTime(body.vnp_PayDate)) || this.now(),
      payload: body,
    }
  }

  /** POST JSON tới API giao dịch; mọi lỗi thành `PaymentGatewayError`. */
  private async call(body: Record<string, string>) {
    let res: Response
    try {
      res = await this.fetch(VNPAY_HOSTS[this.options.env].apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      throw new PaymentGatewayError('VNPAY: không gọi được API', { cause: err })
    }
    if (!res.ok) throw new PaymentGatewayError(`VNPAY trả HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const result = QueryResponse.safeParse(await res.json().catch(() => undefined))
    if (!result.success) throw new PaymentGatewayError('VNPAY: response không đúng định dạng', { cause: result.error })
    return result.data
  }
}
