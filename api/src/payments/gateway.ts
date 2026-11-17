import { randomUUID } from 'node:crypto'
import type { PaymentPurpose, PaymentSource } from '../generated/prisma/client.ts'

/** Yêu cầu tạo link thanh toán cho một đơn. */
export type PaymentLinkRequest = {
  /** Mã đơn khách thấy. */
  orderCode: number
  /** Khoản link thu: trả đủ, cọc hay phần còn lại. Một đơn có thể có nhiều link. */
  purpose: PaymentPurpose
  /** VND, số tiền link đòi. */
  amount: number
  /** Mô tả khách thấy ở trang thanh toán. */
  description: string
  /** Trang khách quay về sau khi thanh toán (hay bỏ ngang). */
  returnUrl: string
  /** Link hết hạn cùng lúc với hạn giữ hàng. */
  expiresAt: Date
  /** IP của khách đặt mua (VNPAY đòi `vnp_IpAddr`). */
  clientIp: string
}

/** Link vừa tạo: trang khách tới để trả tiền, và mã đơn bên cổng để truy vấn sau (`payment_link.gateway_reference`). */
export type PaymentLink = { checkoutUrl: string; gatewayReference: string }

/** Một khoản tiền đã về cho đơn, theo cổng thanh toán. */
export type PaymentTransaction = {
  /** Mã tham chiếu giao dịch, duy nhất; dùng để không ghi một khoản hai lần. */
  reference: string
  amount: number
  paidAt: Date
  /** Bản ghi gốc của cổng, lưu làm payload của giao dịch. */
  payload?: object
}

/** Trạng thái thanh toán của một đơn khi hỏi cổng. */
export type PaymentInfo = {
  status: 'pending' | 'paid' | 'failed'
  transactions: PaymentTransaction[]
}

/** Một giao dịch đã về, như đã lưu (`payment_transaction`): đủ để cổng biết có hoàn được không và hoàn thế nào. */
export type StoredTransaction = {
  reference: string
  amount: number
  source: PaymentSource
  payload: unknown
}

/** Yêu cầu hoàn một phần hay toàn bộ một giao dịch gốc qua cổng (ADR 0014). */
export type RefundRequest = {
  /** Id khoản hoàn; cổng dùng làm mã yêu cầu nên không trùng giữa các lần gọi. */
  refundId: string
  orderCode: number
  /** VND, > 0, không vượt phần chưa hoàn của giao dịch. */
  amount: number
  /** Hoàn hết giao dịch (chưa từng hoàn qua cổng và số tiền bằng giao dịch) hay một phần. */
  full: boolean
  transaction: StoredTransaction
  /** Id nhân viên thực hiện. */
  createdBy: string
}

/**
 * Kết quả cổng trả ngay: đã hoàn, cổng đang xử lý (chốt tay sau, ADR 0014), hoặc bị từ chối. `message` là lý do đọc được,
 * `payload` là dữ liệu gốc lưu vào khoản hoàn.
 */
export type RefundResult = { status: 'succeeded' | 'processing' | 'rejected'; message: string; payload: object }

/** Cổng không trả lời, trả lỗi hoặc trả dữ liệu không tin được; checkout đổi thành 502. */
export class PaymentGatewayError extends Error {
  override name = 'PaymentGatewayError'
}

/**
 * Cổng thanh toán (ADR 0010). Bản thật là VNPAY (`vnpay.ts`), chọn ở `gateway-from-env.ts`; local dùng cổng giả
 * lập; test dùng bản trong bộ nhớ. Kiểm chữ ký IPN không nằm ở đây: đó là hàm thuần trên khóa bí mật.
 */
export interface PaymentGateway {
  /** Tạo link thanh toán; lỗi thì ném để đơn không được tạo. */
  createLink(request: PaymentLinkRequest): Promise<PaymentLink>
  /** Hỏi cổng các khoản đã về cho đơn mang mã `gatewayReference`. */
  getPayment(gatewayReference: string): Promise<PaymentInfo>
  /** Hủy link của đơn; lỗi chỉ cần log, không chặn việc hủy đơn. */
  cancelLink(gatewayReference: string): Promise<void>
  /** Giao dịch này có hoàn qua chính cổng này được không (giao dịch giả lập không hoàn qua VNPAY được, và ngược lại). */
  canRefund(transaction: StoredTransaction): boolean
  /** Gửi lệnh hoàn; cổng không trả lời hay trả dữ liệu không tin được thì ném `PaymentGatewayError`. */
  refund(request: RefundRequest): Promise<RefundResult>
}

const PENDING: PaymentInfo = { status: 'pending', transactions: [] }

/**
 * Mã đơn bên cổng của cổng giả: link trả đủ là `String(orderCode)` như M3; link khác thêm mục đích và một số phân biệt,
 * để mọi link của một đơn khác mã nhau.
 */
function fakeReference(request: PaymentLinkRequest, distinct: number | string) {
  return request.purpose === 'full' ? String(request.orderCode) : `${request.orderCode}-${request.purpose}-${distinct}`
}

/**
 * Bản giả cho test: ghi lại link đã tạo, đã hủy; trạng thái truy vấn do test đặt; giả lập được lỗi. Mã đơn bên cổng
 * theo `fakeReference`, số phân biệt đếm từ 1 theo đơn và mục đích.
 */
export class InMemoryPaymentGateway implements PaymentGateway {
  readonly created: PaymentLinkRequest[] = []
  readonly cancelled: string[] = []
  /** Trạng thái truy vấn theo mã đơn bên cổng. */
  readonly payments = new Map<string, PaymentInfo>()
  /** Đặt `true` để mọi lần tạo link sau đó đều lỗi, như cổng không trả lời. */
  failCreate = false
  /** Đặt `true` để mọi lần truy vấn sau đó đều lỗi. */
  failGetPayment = false
  /** Đặt `true` để mọi lần hủy link sau đó đều lỗi. */
  failCancel = false
  /** Đặt `false` để mọi giao dịch đều không hoàn qua cổng được (chỉ hoàn thủ công). */
  allowRefund = true
  /** Các lệnh hoàn đã nhận. */
  readonly refunds: RefundRequest[] = []
  /** Kết quả cho các lệnh hoàn sau đó, lấy lần lượt; hết thì là `succeeded`. Phần tử `'error'` giả lập cổng không trả lời. */
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
    const status = this.refundResults.shift() ?? 'succeeded'
    if (status === 'error') throw new PaymentGatewayError('Cổng thanh toán giả lập không trả lời')
    return { status, message: `Giả lập: ${status}`, payload: { status, amount: request.amount } }
  }
}

/** Đường dẫn trang cổng giả lập trên web. */
export const SIMULATOR_PATH = '/thanh-toan-gia-lap'

/**
 * Cổng giả lập cho local và smoke, khi chưa có khóa VNPAY (spec "Thanh toán"): link trỏ tới trang
 * `/thanh-toan-gia-lap` của chính website, mang mã đơn, mã link (`ref`), số tiền, hạn và trang quay về trong query. Truy vấn luôn là
 * chưa trả: tiền giả lập về qua nút "Giả lập đã thanh toán", ghi nhận thẳng.
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

  /** Chỉ giao dịch giả lập: tiền thật hay tiền sandbox không hoàn bằng nút giả lập. */
  canRefund(transaction: StoredTransaction) {
    return transaction.source === 'simulator'
  }

  /**
   * Hoàn giả lập để local và bản demo chạy đủ các nhánh (spec M6a): chữ số cuối của số tiền là `1` thì cổng đang xử lý,
   * `2` thì bị từ chối, còn lại thì đã hoàn.
   */
  async refund(request: RefundRequest): Promise<RefundResult> {
    const last = request.amount % 10
    const status = last === 1 ? 'processing' : last === 2 ? 'rejected' : 'succeeded'
    return { status, message: `Cổng giả lập: ${status}`, payload: { simulator: true, status, amount: request.amount } }
  }
}
