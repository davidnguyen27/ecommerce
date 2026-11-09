/** Yêu cầu tạo link thanh toán cho một đơn. */
export type PaymentLinkRequest = {
  /** Mã đơn khách thấy. */
  orderCode: number
  /** VND, tổng phải trả. */
  amount: number
  /** Mô tả khách thấy ở trang thanh toán. */
  description: string
  /** Trang khách quay về sau khi thanh toán (hay bỏ ngang). */
  returnUrl: string
  /** Link hết hạn cùng lúc với hạn giữ hàng. */
  expiresAt: Date
}

/** Link vừa tạo: trang khách tới để trả tiền, và mã đơn bên cổng để truy vấn sau (`order.gateway_reference`). */
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

/** Cổng không trả lời, trả lỗi hoặc trả dữ liệu không tin được; checkout đổi thành 502. */
export class PaymentGatewayError extends Error {
  override name = 'PaymentGatewayError'
}

/**
 * Cổng thanh toán (ADR 0009). Bản thật là ZaloPay (`zalopay.ts`), chọn ở `gateway-from-env.ts`; local dùng cổng giả
 * lập; test dùng bản trong bộ nhớ. Kiểm MAC của callback không nằm ở đây: đó là hàm thuần trên khóa callback.
 */
export interface PaymentGateway {
  /** Tạo link thanh toán; lỗi thì ném để đơn không được tạo. */
  createLink(request: PaymentLinkRequest): Promise<PaymentLink>
  /** Hỏi cổng các khoản đã về cho đơn mang mã `gatewayReference`. */
  getPayment(gatewayReference: string): Promise<PaymentInfo>
  /** Hủy link của đơn; lỗi chỉ cần log, không chặn việc hủy đơn. */
  cancelLink(gatewayReference: string): Promise<void>
}

const PENDING: PaymentInfo = { status: 'pending', transactions: [] }

/**
 * Bản giả cho test: ghi lại link đã tạo, đã hủy; trạng thái truy vấn do test đặt; giả lập được lỗi. Mã đơn bên cổng
 * là `String(orderCode)`.
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

  async createLink(request: PaymentLinkRequest) {
    if (this.failCreate) throw new Error('Cổng thanh toán giả lập lỗi')
    this.created.push(request)
    return { checkoutUrl: `https://pay.test/${request.orderCode}`, gatewayReference: String(request.orderCode) }
  }

  async getPayment(gatewayReference: string) {
    if (this.failGetPayment) throw new Error('Cổng thanh toán giả lập lỗi')
    return this.payments.get(gatewayReference) ?? PENDING
  }

  async cancelLink(gatewayReference: string) {
    if (this.failCancel) throw new Error('Cổng thanh toán giả lập lỗi')
    this.cancelled.push(gatewayReference)
  }
}

/** Đường dẫn trang cổng giả lập trên web. */
export const SIMULATOR_PATH = '/thanh-toan-gia-lap'

/**
 * Cổng giả lập cho local và smoke, khi chưa có khóa ZaloPay (spec "Thanh toán"): link trỏ tới trang
 * `/thanh-toan-gia-lap` của chính website, mang mã đơn, số tiền, hạn và trang quay về trong query. Truy vấn luôn là
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
    return { checkoutUrl: url.toString(), gatewayReference: String(request.orderCode) }
  }

  async getPayment() {
    return PENDING
  }

  async cancelLink() {}
}
