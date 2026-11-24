import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  PaymentGatewayError,
  type PaymentGateway,
  type PaymentInfo,
  type PaymentLinkRequest,
  type RefundRequest,
  type RefundResult,
  type StoredTransaction,
} from './gateway.ts'

// Per the VNPAY docs (https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html and
// .../truy-van-hoan-tien/querydr&refund.html, read 2026-11-11). Points marked "check on sandbox" are unclear in the
// docs; ticket 16 checks them.

/**
 * VNPAY hosts per environment. Production is not in the docs read: taken from general knowledge, recheck when the
 * contract is signed.
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
  /** `vnp_TmnCode`, the merchant terminal id. */
  tmnCode: string
  /** `vnp_HashSecret`, signs payment URLs, IPN and queries. */
  hashSecret: string
  env: VnpayEnv
}

const VERSION = '2.1.0'

/** HMAC-SHA512 (hex), how VNPAY signs everything. */
export function vnpayHmac(text: string, secret: string) {
  return createHmac('sha512', secret).update(text, 'utf8').digest('hex')
}

/** Encodes like PHP's `urlencode`, as VNPAY's PHP/Java samples sign: spaces become `+`. */
const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, '+')

/**
 * Signing string of payment URLs and IPN: every non-empty `vnp_*` param except `vnp_SecureHash`/`vnp_SecureHashType`,
 * sorted by name, encoded `key=value`, joined with `&`. Also used as the payment URL query.
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

/** Whether params from VNPAY (IPN, return page) are correctly signed; constant-time comparison. */
export function isValidVnpaySignature(params: Record<string, unknown>, hashSecret: string) {
  return sameHex(params.vnp_SecureHash, vnpayHmac(vnpaySignData(params), hashSecret))
}

const VN_OFFSET_MS = 7 * 60 * 60_000

/** `yyyyMMddHHmmss` in GMT+7, VNPAY's date format. */
export function vnDateTime(date: Date) {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().replace(/\D/g, '').slice(0, 14)
}

/** Parses `yyyyMMddHHmmss` (GMT+7); bad format gives `null`. */
export function parseVnDateTime(text: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text)
  if (!m) return null
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The order's `vnp_TxnRef`: order code, `T`, link creation time (`yyyyMMddHHmmss`, GMT+7). VNPAY forbids repeats
 * within a day and order codes are unique only per DB (a reset renumbers), so the time is appended. It is also the
 * query's `vnp_TransactionDate`, so nothing extra is stored.
 */
export function txnRef(orderCode: number, createdAt: Date) {
  return `${orderCode}T${vnDateTime(createdAt)}`
}

/** Order code and creation time from a `vnp_TxnRef` made by `txnRef`; unknown refs give `null`. */
export function parseTxnRef(ref: string): { orderCode: number; createDate: string } | null {
  const m = /^(\d{1,15})T(\d{14})$/.exec(ref)
  return m ? { orderCode: Number(m[1]), createDate: m[2]! } : null
}

/** `vnp_OrderInfo`: VNPAY requires Vietnamese without diacritics or special characters, at most 255 characters. */
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

/** VNPAY payment result in IPN and queries: success when both codes are `00` (docs). */
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

/** Field order of the query response signing string, joined with `|` (querydr docs). */
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

/** Field order of the refund response signing string, joined with `|` (querydr&refund docs, read 2026-11-17). */
const REFUND_RESPONSE_FIELDS = [
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
] as const

/**
 * The original transaction's `vnp_TxnRef` from the stored payload (IPN, return page and query all carry it); without
 * it the transaction cannot be refunded via VNPAY.
 */
function storedTxnRef(transaction: StoredTransaction) {
  const payload = transaction.payload as { vnp_TxnRef?: unknown } | null
  const ref = typeof payload?.vnp_TxnRef === 'string' ? payload.vnp_TxnRef : null
  return ref && parseTxnRef(ref) ? ref : null
}

/**
 * Maps the refund result (docs): `00` with status `00` is refunded; with `05` (VNPAY processing) or `06` (sent to the
 * bank) is processing; `94` (a refund already in progress) is processing too; anything else is rejected.
 */
export function refundOutcome(body: { vnp_ResponseCode?: string; vnp_TransactionStatus?: string }) {
  if (body.vnp_ResponseCode === '94') return 'processing' as const
  if (body.vnp_ResponseCode !== '00') return 'rejected' as const
  if (body.vnp_TransactionStatus === '00') return 'succeeded' as const
  if (body.vnp_TransactionStatus === '05' || body.vnp_TransactionStatus === '06') return 'processing' as const
  return 'rejected' as const
}

/**
 * VNPAY gateway (ADR 0010). Payment links are pre-signed URLs, no VNPAY call; queries call `querydr` via `fetch`
 * without retries. `vnp_OrderInfo` carries no customer data.
 */
export class VnpayPaymentGateway implements PaymentGateway {
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => Date

  constructor(
    private readonly options: VnpayKeys & {
      /** `vnp_IpAddr` for queries: the IP of the server calling VNPAY. */
      serverIp?: string
      fetch?: typeof globalThis.fetch
      now?: () => Date
      /** Query `vnp_RequestId`; tests pass a fixed value. */
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
      // No `vnp_BankCode`: the customer picks ATM, international card or QR on the VNPAY page.
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
    // Check on sandbox: the docs only say `hashWithSecureType`; assumed HMAC-SHA512 like payment URLs.
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

    // 91: VNPAY has no transaction for this ref, i.e. not paid yet.
    if (body.vnp_ResponseCode === '91') return { status: 'pending', transactions: [] }
    if (body.vnp_ResponseCode !== '00') {
      throw new PaymentGatewayError(`VNPAY querydr ${body.vnp_ResponseCode}: ${body.vnp_Message ?? ''}`)
    }
    const expected = vnpayHmac(QUERY_RESPONSE_FIELDS.map((field) => body[field] ?? '').join('|'), hashSecret)
    if (!sameHex(body.vnp_SecureHash, expected)) throw new PaymentGatewayError('VNPAY: response truy vấn sai chữ ký')

    if (isVnpaySuccess(body)) return { status: 'paid', transactions: [this.transaction(body)] }
    // 01: incomplete (customer has not finished paying); 02: error; other codes (refunded, suspected fraud) for staff.
    if (body.vnp_TransactionStatus === '01') return { status: 'pending', transactions: [] }
    return { status: 'failed', transactions: [] }
  }

  canRefund(transaction: StoredTransaction) {
    return transaction.source !== 'simulator' && storedTxnRef(transaction) !== null
  }

  /**
   * `refund` command (ADR 0014): full (`02`) or partial (`03`) refund of an original transaction. Signing string in the
   * docs' field order, joined with `|`, HMAC-SHA512 like every other command (docs only say `hashWithSecureType`; not
   * yet verified on sandbox, ticket 06). A `00` response must be correctly signed; error codes carry nothing to trust.
   */
  async refund(request: RefundRequest): Promise<RefundResult> {
    const ref = storedTxnRef(request.transaction)
    const parsed = ref && parseTxnRef(ref)
    if (!ref || !parsed)
      throw new PaymentGatewayError('VNPAY: giao dịch gốc thiếu vnp_TxnRef, không hoàn qua cổng được')
    const { tmnCode, hashSecret } = this.options
    const body = {
      // Refund id without dashes: 32 alphanumerics, unique within the day as the docs require.
      vnp_RequestId: request.refundId.replace(/-/g, ''),
      vnp_Version: VERSION,
      vnp_Command: 'refund',
      vnp_TmnCode: tmnCode,
      vnp_TransactionType: request.full ? '02' : '03',
      vnp_TxnRef: ref,
      vnp_Amount: String(request.amount * 100),
      vnp_TransactionNo: request.transaction.reference,
      vnp_TransactionDate: parsed.createDate,
      vnp_CreateBy: request.createdBy.replace(/-/g, ''),
      vnp_CreateDate: vnDateTime(this.now()),
      vnp_IpAddr: this.options.serverIp ?? '127.0.0.1',
      vnp_OrderInfo: `Hoan tien don ${request.orderCode}`,
    }
    const signed = [
      body.vnp_RequestId,
      body.vnp_Version,
      body.vnp_Command,
      body.vnp_TmnCode,
      body.vnp_TransactionType,
      body.vnp_TxnRef,
      body.vnp_Amount,
      body.vnp_TransactionNo,
      body.vnp_TransactionDate,
      body.vnp_CreateBy,
      body.vnp_CreateDate,
      body.vnp_IpAddr,
      body.vnp_OrderInfo,
    ].join('|')
    const response = await this.call({ ...body, vnp_SecureHash: vnpayHmac(signed, hashSecret) })
    if (response.vnp_ResponseCode === '00') {
      const expected = vnpayHmac(REFUND_RESPONSE_FIELDS.map((field) => response[field] ?? '').join('|'), hashSecret)
      if (!sameHex(response.vnp_SecureHash, expected))
        throw new PaymentGatewayError('VNPAY: response hoàn tiền sai chữ ký')
    }
    const status = refundOutcome(response)
    const message = `VNPAY ${response.vnp_ResponseCode}/${response.vnp_TransactionStatus ?? '-'}: ${response.vnp_Message ?? ''}`
    return { status, message: message.trim(), payload: response }
  }

  async cancelLink() {
    // VNPAY has no API to cancel an unpaid payment URL (ADR 0010): it expires via `vnp_ExpireDate`; money for a
    // cancelled order needs reconciliation.
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

  /** POSTs JSON to the transaction API; every error becomes `PaymentGatewayError`. */
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
