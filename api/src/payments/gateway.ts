/** Yêu cầu tạo link thanh toán cho một đơn. */
export type PaymentLinkRequest = {
  /** Mã đơn, cũng là `orderCode` của PayOS. */
  orderCode: number
  /** VND, tổng phải trả. */
  amount: number
  /** Nội dung chuyển khoản; PayOS giới hạn 25 ký tự. */
  description: string
  /** Trang khách quay về sau khi thanh toán. */
  returnUrl: string
  /** Trang khách quay về khi bấm hủy ở cổng. */
  cancelUrl: string
  /** Link hết hạn cùng lúc với hạn giữ hàng. */
  expiresAt: Date
}

/** Một khoản tiền đã về cho đơn, theo cổng thanh toán. */
export type PaymentTransaction = {
  /** Mã tham chiếu giao dịch, duy nhất; dùng để không ghi một khoản hai lần. */
  reference: string
  amount: number
  paidAt: Date
}

/** Trạng thái thanh toán của một đơn khi hỏi cổng. */
export type PaymentInfo = {
  status: 'pending' | 'paid' | 'cancelled' | 'expired'
  amountPaid: number
  transactions: PaymentTransaction[]
}

/**
 * Cổng thanh toán (ADR 0008). Bản thật là PayOS (ticket 12); local dùng cổng giả lập; test dùng bản trong bộ nhớ.
 * Kiểm chữ ký webhook không nằm ở đây: đó là hàm thuần trên checksum key.
 */
export interface PaymentGateway {
  /** Tạo link thanh toán; lỗi thì ném để đơn không được tạo. */
  createLink(request: PaymentLinkRequest): Promise<{ checkoutUrl: string }>
  /** Hỏi cổng các khoản đã về cho đơn. */
  getPayment(orderCode: number): Promise<PaymentInfo>
  /** Hủy link của đơn; lỗi chỉ cần log, không chặn việc hủy đơn. */
  cancelLink(orderCode: number): Promise<void>
}

const PENDING: PaymentInfo = { status: 'pending', amountPaid: 0, transactions: [] }

/** Bản giả cho test: ghi lại link đã tạo, đã hủy; trạng thái truy vấn do test đặt; giả lập được lỗi tạo link. */
export class InMemoryPaymentGateway implements PaymentGateway {
  readonly created: PaymentLinkRequest[] = []
  readonly cancelled: number[] = []
  readonly payments = new Map<number, PaymentInfo>()
  /** Đặt `true` để mọi lần tạo link sau đó đều lỗi, như cổng không trả lời. */
  failCreate = false

  async createLink(request: PaymentLinkRequest) {
    if (this.failCreate) throw new Error('Cổng thanh toán giả lập lỗi')
    this.created.push(request)
    return { checkoutUrl: `https://pay.test/${request.orderCode}` }
  }

  async getPayment(orderCode: number) {
    return this.payments.get(orderCode) ?? PENDING
  }

  async cancelLink(orderCode: number) {
    this.cancelled.push(orderCode)
  }
}

/** Đường dẫn trang cổng giả lập trên web. */
export const SIMULATOR_PATH = '/thanh-toan-gia-lap'

/**
 * Cổng giả lập cho local và smoke, khi chưa có khóa PayOS (spec "Thanh toán"): link trỏ tới trang
 * `/thanh-toan-gia-lap` của chính website, mang mã đơn, số tiền và trang quay về trong query.
 * Chưa có khoản nào về; ticket 05 và 06 thêm nút giả lập đã thanh toán và hết hạn.
 */
export class SimulatorPaymentGateway implements PaymentGateway {
  constructor(private readonly siteUrl: string) {}

  async createLink(request: PaymentLinkRequest) {
    const url = new URL(SIMULATOR_PATH, this.siteUrl)
    url.searchParams.set('orderCode', String(request.orderCode))
    url.searchParams.set('amount', String(request.amount))
    url.searchParams.set('expiresAt', request.expiresAt.toISOString())
    url.searchParams.set('returnUrl', request.returnUrl)
    url.searchParams.set('cancelUrl', request.cancelUrl)
    return { checkoutUrl: url.toString() }
  }

  async getPayment() {
    return PENDING
  }

  async cancelLink() {}
}

/**
 * Chọn cổng thanh toán. Chưa có PayOS (ticket 12) nên luôn là cổng giả lập; ticket 12 thêm PayOS khi có đủ khóa
 * và chặn khởi động ở production khi thiếu khóa.
 */
export function paymentGatewayFromEnv(_env: NodeJS.ProcessEnv, siteUrl: string): PaymentGateway {
  return new SimulatorPaymentGateway(siteUrl)
}
