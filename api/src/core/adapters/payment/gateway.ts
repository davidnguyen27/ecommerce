import { randomUUID } from 'node:crypto'
import type { PaymentPurpose, PaymentSource } from '../../../generated/prisma/client.ts'

/** Request to create a payment link for an order. */
export type PaymentLinkRequest = {
  /** Order code the customer sees. */
  orderCode: number
  /** What the link collects: full, deposit or remaining balance. An order can have several links. */
  purpose: PaymentPurpose
  /** VND the link asks for. */
  amount: number
  /** Description shown on the payment page. */
  description: string
  /** Page the customer returns to after paying (or abandoning). */
  returnUrl: string
  /** The link expires with the reservation. */
  expiresAt: Date
  /** Client IP (VNPAY requires `vnp_IpAddr`). */
  clientIp: string
}

/** A new link: the page to pay on, and the gateway reference for later queries (`payment_link.gateway_reference`). */
export type PaymentLink = { checkoutUrl: string; gatewayReference: string }

/** Money received for an order, per the gateway. */
export type PaymentTransaction = {
  /** Unique transaction reference; keeps a payment from being recorded twice. */
  reference: string
  amount: number
  paidAt: Date
  /** The gateway's raw record, stored as the transaction payload. */
  payload?: object
}

/** An order's payment status when queried at the gateway. */
export type PaymentInfo = {
  status: 'pending' | 'paid' | 'failed'
  transactions: PaymentTransaction[]
}

/** A received transaction as stored (`payment_transaction`): enough for the gateway to tell if and how to refund it. */
export type StoredTransaction = {
  reference: string
  amount: number
  source: PaymentSource
  payload: unknown
}

/** Request to refund part or all of an original transaction via the gateway (ADR 0014). */
export type RefundRequest = {
  /** Refund id; the gateway uses it as the request id, so calls never collide. */
  refundId: string
  orderCode: number
  /** VND, > 0, at most the transaction's unrefunded part. */
  amount: number
  /** Full refund (never refunded via gateway and amount equals the transaction) or partial. */
  full: boolean
  transaction: StoredTransaction
  /** Acting staff id. */
  createdBy: string
}

/**
 * Immediate gateway result: refunded, processing (settled by hand later, ADR 0014) or rejected. `message` is a
 * readable reason, `payload` the raw data stored on the refund.
 */
export type RefundResult = { status: 'succeeded' | 'processing' | 'rejected'; message: string; payload: object }

/** No reply, an error or untrustworthy data from the gateway; checkout turns it into 502. */
export class PaymentGatewayError extends Error {
  override name = 'PaymentGatewayError'
}

/**
 * Payment gateway (ADR 0010). The real one is VNPAY (`vnpay.ts`), picked in `gateway-from-env.ts`; locally a
 * simulator; in tests an in-memory fake. IPN signature checks live elsewhere: they are pure functions of the secret.
 */
export interface PaymentGateway {
  /** Creates a payment link; throws on error so the order is not created. */
  createLink(request: PaymentLinkRequest): Promise<PaymentLink>
  /** Asks the gateway what was paid for the order with reference `gatewayReference`. */
  getPayment(gatewayReference: string): Promise<PaymentInfo>
  /** Cancels the order's link; errors need only be logged, they never block the cancel. */
  cancelLink(gatewayReference: string): Promise<void>
  /** Whether this gateway can refund the transaction (simulated ones not via VNPAY, and vice versa). */
  canRefund(transaction: StoredTransaction): boolean
  /** Sends a refund command; no reply or untrustworthy data throws `PaymentGatewayError`. */
  refund(request: RefundRequest): Promise<RefundResult>
}

const PENDING: PaymentInfo = { status: 'pending', transactions: [] }

/**
 * Fake gateway reference: a full-payment link is `String(orderCode)` as in M3; other links add the purpose and a
 * counter, so every link of an order differs.
 */
function fakeReference(request: PaymentLinkRequest, distinct: number | string) {
  return request.purpose === 'full' ? String(request.orderCode) : `${request.orderCode}-${request.purpose}-${distinct}`
}

/**
 * Test fake: records created and cancelled links; query status set by tests; can simulate errors. References follow
 * `fakeReference`, counters from 1 per order and purpose.
 */
export class InMemoryPaymentGateway implements PaymentGateway {
  readonly created: PaymentLinkRequest[] = []
  readonly cancelled: string[] = []
  /** Query status by gateway reference. */
  readonly payments = new Map<string, PaymentInfo>()
  /** Set `true` to make every later link creation fail, as if the gateway did not reply. */
  failCreate = false
  /** Set `true` to make every later query fail. */
  failGetPayment = false
  /** Set `true` to make every later link cancel fail. */
  failCancel = false
  /** Set `false` so no transaction is refundable via the gateway (manual refunds only). */
  allowRefund = true
  /** Runs after receiving a refund command, before replying: lets tests interleave while the gateway is processing. */
  beforeRefundResult?: (request: RefundRequest) => Promise<void>
  /** Refund commands received. */
  readonly refunds: RefundRequest[] = []
  /** Results for later refund commands, in order; then `succeeded`. An `'error'` entry simulates no reply. */
  readonly refundResults: (RefundResult['status'] | 'error')[] = []

  async createLink(request: PaymentLinkRequest) {
    if (this.failCreate) throw new Error('Cổng thanh toán giả lập lỗi')
    this.created.push(request)
    const sequence = this.created.filter(
      (r) => r.orderCode === request.orderCode && r.purpose === request.purpose,
    ).length
    const gatewayReference = fakeReference(request, sequence)
    return { checkoutUrl: `https://pay.test/${gatewayReference}`, gatewayReference }
  }

  async getPayment(gatewayReference: string) {
    if (this.failGetPayment) throw new Error('Cổng thanh toán giả lập lỗi')
    return this.payments.get(gatewayReference) ?? PENDING
  }

  async cancelLink(gatewayReference: string) {
    if (this.failCancel) throw new Error('Cổng thanh toán giả lập lỗi')
    this.cancelled.push(gatewayReference)
  }

  canRefund() {
    return this.allowRefund
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    this.refunds.push(request)
    await this.beforeRefundResult?.(request)
    const status = this.refundResults.shift() ?? 'succeeded'
    if (status === 'error') throw new PaymentGatewayError('Cổng thanh toán giả lập không trả lời')
    return { status, message: `Giả lập: ${status}`, payload: { status, amount: request.amount } }
  }
}

/** Path of the simulator page on the website. */
export const SIMULATOR_PATH = '/thanh-toan-gia-lap'

/**
 * Local and smoke simulator when there are no VNPAY keys (spec "Thanh toán"): links point to the website's own
 * `/thanh-toan-gia-lap` page with order code, link ref, amount, expiry and return page in the query. Queries always say
 * unpaid: simulated money arrives via the "Giả lập đã thanh toán" button, recorded directly.
 */
export class SimulatorPaymentGateway implements PaymentGateway {
  constructor(private readonly siteUrl: string) {}

  async createLink(request: PaymentLinkRequest) {
    const url = new URL(SIMULATOR_PATH, this.siteUrl)
    url.searchParams.set('orderCode', String(request.orderCode))
    url.searchParams.set('amount', String(request.amount))
    url.searchParams.set('expiresAt', request.expiresAt.toISOString())
    url.searchParams.set('returnUrl', request.returnUrl)
    const gatewayReference = fakeReference(request, randomUUID().slice(0, 8))
    url.searchParams.set('ref', gatewayReference)
    return { checkoutUrl: url.toString(), gatewayReference }
  }

  async getPayment() {
    return PENDING
  }

  async cancelLink() {}

  /** Simulated transactions only: real or sandbox money is not refunded by the simulator. */
  canRefund(transaction: StoredTransaction) {
    return transaction.source === 'simulator'
  }

  /**
   * Simulated refunds so local and demo cover every branch (spec M6a): amount ending in `1` is processing, `2`
   * rejected, anything else refunded.
   */
  async refund(request: RefundRequest): Promise<RefundResult> {
    const last = request.amount % 10
    const status = last === 1 ? 'processing' : last === 2 ? 'rejected' : 'succeeded'
    return { status, message: `Cổng giả lập: ${status}`, payload: { simulator: true, status, amount: request.amount } }
  }
}
