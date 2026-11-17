import { z } from 'zod'
import { AttributeValues } from './attributes.ts'
import { PageQuery, pageOf } from './pagination.ts'
import { PublicImage } from './products.ts'
import { AdminRefund } from './refunds.ts'

/** Trạng thái đơn hàng (GLOSSARY "Trạng thái đơn hàng"). */
export const OrderStatus = z.enum(['pending_payment', 'processing', 'completed', 'cancelled'])
export type OrderStatus = z.infer<typeof OrderStatus>

/** Trạng thái thanh toán; `deposit_paid` chỉ có ở đơn đặt trước (đã cọc, chưa trả đủ). M6 thêm hoàn tiền. */
export const PaymentStatus = z.enum(['unpaid', 'deposit_paid', 'paid'])
export type PaymentStatus = z.infer<typeof PaymentStatus>

/** Trạng thái giao hàng; `returned`: kho đã nhận hàng hoàn về sau giao thất bại (M6a). */
export const FulfillmentStatus = z.enum(['not_prepared', 'preparing', 'handed_over', 'delivered', 'failed', 'returned'])
export type FulfillmentStatus = z.infer<typeof FulfillmentStatus>

/** Đơn hàng sẵn (qua giỏ hàng) hay đơn đặt trước (GLOSSARY "Đơn đặt trước"). */
export const OrderKind = z.enum(['standard', 'preorder'])
export type OrderKind = z.infer<typeof OrderKind>

/**
 * Giảm số tiền cố định, hoặc giảm theo tỷ lệ có mức giảm tối đa (GLOSSARY "Mã giảm giá"). Khai ở đây vì đơn chụp loại mã;
 * `vouchers.ts` import file này.
 */
export const VoucherKind = z.enum(['fixed', 'percent'])
export type VoucherKind = z.infer<typeof VoucherKind>

/**
 * Phần đặt trước của đơn, chụp lúc đặt: mức cọc, tiền cọc, phần còn lại (gồm phí giao), thời gian giao dự kiến và số
 * ngày được trả phần còn lại sau khi hàng về.
 */
export const OrderPreorder = z.object({
  /** Đợt của đơn; trang quản trị dẫn tới chi tiết đợt. */
  campaignId: z.string(),
  depositPercent: z.number(),
  depositAmount: z.number(),
  remainingAmount: z.number(),
  deliveryFrom: z.string(),
  deliveryTo: z.string(),
  remainderDays: z.number(),
  /** Lúc cọc thành công; `null` khi chưa cọc. */
  depositPaidAt: z.string().nullable(),
  /** Số cái đã được giữ từ hàng về, trên tổng số lượng của đơn (ADR 0013). */
  arrivedQuantity: z.number(),
  quantity: z.number(),
  /** Lúc hàng về đủ và hạn trả phần còn lại; `null` khi chưa về đủ. */
  arrivedAt: z.string().nullable(),
  remainderDueAt: z.string().nullable(),
  /** Lúc bị gắn cờ quá hạn trả phần còn lại; `null` khi chưa quá hạn hoặc đã trả đủ. */
  remainderOverdueAt: z.string().nullable(),
  /** Thời gian giao dự kiến hiện tại của đợt; khác `deliveryFrom`/`deliveryTo` (lúc đặt) khi nhân viên đã đổi. */
  currentDeliveryFrom: z.string(),
  currentDeliveryTo: z.string(),
})
export type OrderPreorder = z.infer<typeof OrderPreorder>

/** Vì sao đơn chưa thanh toán bị hủy: quá hạn giữ hàng, khách tự hủy, hay nhân viên hủy. */
export const OrderCancelReason = z.enum(['expired', 'customer', 'staff'])
export type OrderCancelReason = z.infer<typeof OrderCancelReason>

/**
 * Vì sao nhân viên hủy đơn đã nhận tiền (M6a): khách đổi ý, quá hạn trả phần còn lại, không nhập được hàng, giao thất
 * bại, khác. Chỉ có ở đơn đã nhận tiền; khi đó `cancelReason` là `staff`.
 */
export const OrderCancelCause = z.enum([
  'changed_mind',
  'remainder_overdue',
  'supply_failed',
  'delivery_failed',
  'other',
])
export type OrderCancelCause = z.infer<typeof OrderCancelCause>

/** Một khoản hoàn như khách thấy: số tiền, đang hoàn hay đã hoàn, ngày tạo và ngày xong. Không có ghi chú nội bộ. */
export const PublicRefund = z.object({
  amount: z.number(),
  status: z.enum(['refunding', 'refunded']),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})
export type PublicRefund = z.infer<typeof PublicRefund>

/** Dòng đơn như lúc đặt mua. */
export const OrderLineView = z.object({
  variantId: z.string(),
  sku: z.string(),
  productName: z.string(),
  attributes: AttributeValues,
  image: PublicImage.nullable(),
  price: z.number(),
  quantity: z.number(),
  lineTotal: z.number(),
  /** Phần tiền giảm của mã chia cho dòng này; 0 khi đơn không dùng mã hoặc dòng ngoài phạm vi mã. */
  discount: z.number(),
  /** Lần nhận hàng hoàn về gần nhất (M6a): số nhập lại tồn và số hỏng/mất; 0 khi chưa có. */
  returnedQuantity: z.number(),
  writtenOffQuantity: z.number(),
})
export type OrderLineView = z.infer<typeof OrderLineView>

/**
 * Đơn hàng như khách thấy: qua link có token (`GET /api/orders/:code?token=…`), và trong tài khoản (ticket 11).
 * Mọi thứ là snapshot lúc đặt mua.
 */
export const PublicOrder = z.object({
  code: z.number(),
  kind: OrderKind,
  /** Có khi và chỉ khi đơn đặt trước. */
  preorder: OrderPreorder.nullable(),
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  fulfillmentStatus: FulfillmentStatus,
  createdAt: z.string(),
  /** Hạn giữ hàng khi đơn còn chờ thanh toán; `null` khi không còn hạn. */
  reservedUntil: z.string().nullable(),
  /** Có khi đơn `cancelled`. */
  cancelReason: OrderCancelReason.nullable(),
  /** Có khi nhân viên hủy đơn đã nhận tiền. */
  cancelCause: OrderCancelCause.nullable(),
  cancelledAt: z.string().nullable(),
  address: z.object({
    recipientName: z.string(),
    phone: z.string(),
    email: z.string(),
    provinceCode: z.string(),
    provinceName: z.string(),
    wardCode: z.string(),
    wardName: z.string(),
    streetAddress: z.string(),
  }),
  note: z.string(),
  lines: z.array(OrderLineView),
  subtotal: z.number(),
  /** Mã giảm giá đã dùng lúc đặt; `null` khi không dùng mã. */
  voucherCode: z.string().nullable(),
  /** Tiền giảm của mã, trừ vào tiền hàng; 0 khi không dùng mã. */
  discount: z.number(),
  shippingFee: z.number(),
  total: z.number(),
  /** Phiên bản chính sách đổi trả, bảo hành gắn với sản phẩm trong đơn lúc đặt mua. */
  policies: z.array(z.object({ slug: z.string(), title: z.string(), version: z.number() })),
  /** Lời đồng ý chính sách bảo mật của khách vãng lai lúc đặt; `null` khi khách đặt lúc đã đăng nhập. */
  privacyConsent: z.object({ policyVersion: z.number(), consentedAt: z.string() }).nullable(),
  /** Thông tin xuất hóa đơn công ty như lúc đặt; `null` khi không xuất hóa đơn công ty. */
  invoice: z.object({ companyName: z.string(), taxCode: z.string(), address: z.string() }).nullable(),
  /** Bàn giao vận chuyển: đơn vị vận chuyển, mã vận đơn, lúc bàn giao; `null` khi chưa bàn giao. */
  shipment: z.object({ carrier: z.string(), trackingNumber: z.string(), handedOverAt: z.string() }).nullable(),
  /** VND, tổng mọi khoản tiền đã về cho đơn. */
  received: z.number(),
  /** Các khoản hoàn chưa thất bại, cũ trước (ADR 0014). */
  refunds: z.array(PublicRefund),
})
export type PublicOrder = z.infer<typeof PublicOrder>

/** Một đơn trong lịch sử mua của khách (`GET /api/account/orders`). */
export const AccountOrderSummary = z.object({
  code: z.number(),
  kind: OrderKind,
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  fulfillmentStatus: FulfillmentStatus,
  createdAt: z.string(),
  total: z.number(),
  /** Tổng số món (cộng số lượng các dòng). */
  itemCount: z.number(),
})
export type AccountOrderSummary = z.infer<typeof AccountOrderSummary>

/** Query string của `GET /api/account/orders`, mới nhất trước. */
export const AccountOrderQuery = PageQuery.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type AccountOrderQuery = z.infer<typeof AccountOrderQuery>

export const AccountOrderPage = pageOf(AccountOrderSummary)
export type AccountOrderPage = z.infer<typeof AccountOrderPage>

/**
 * Query string của `GET /api/admin/orders`. Không truyền gì thì là hàng chờ soạn: đơn đã trả đủ, chưa chuẩn bị, cũ
 * trước. Mỗi bộ lọc trạng thái nhận `all` để bỏ lọc. `q` tìm theo mã đơn, số điện thoại hoặc email.
 */
export const AdminOrderQuery = PageQuery.extend({
  status: z.union([OrderStatus, z.literal('all')]).default('processing'),
  paymentStatus: z.union([PaymentStatus, z.literal('all')]).default('paid'),
  fulfillmentStatus: z.union([FulfillmentStatus, z.literal('all')]).default('not_prepared'),
  /** Đơn hàng sẵn hay đơn đặt trước (ticket 10). */
  kind: z.union([OrderKind, z.literal('all')]).default('all'),
  /** Đơn đặt trước của một đợt. */
  campaignId: z.uuid().optional(),
  /** `true`: chỉ đơn đặt trước quá hạn trả phần còn lại (đã cọc, chưa trả đủ). */
  remainderOverdue: z.stringbool().optional(),
  /** Đơn đã dùng mã giảm giá này (không phân biệt hoa thường). */
  voucherCode: z.string().trim().max(40).optional(),
  /** `open`: chỉ đơn có hoàn tiền chưa xong (chờ hoàn hoặc cổng đang xử lý). */
  refund: z.literal('open').optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['oldest', 'newest']).default('oldest'),
})
export type AdminOrderQuery = z.infer<typeof AdminOrderQuery>

export const AdminOrderSummary = AccountOrderSummary.extend({
  recipientName: z.string(),
  phone: z.string(),
  email: z.string(),
  provinceName: z.string(),
})
export type AdminOrderSummary = z.infer<typeof AdminOrderSummary>

export const AdminOrderPage = pageOf(AdminOrderSummary)
export type AdminOrderPage = z.infer<typeof AdminOrderPage>

/** Đường báo tiền về (`payment_source`). */
export const PaymentSource = z.enum(['webhook', 'query', 'simulator', 'return'])
export type PaymentSource = z.infer<typeof PaymentSource>

/** Khoản một giao dịch thu: trả đủ đơn hàng sẵn, tiền cọc hay phần còn lại của đơn đặt trước. */
export const PaymentPurpose = z.enum(['full', 'deposit', 'remainder'])
export type PaymentPurpose = z.infer<typeof PaymentPurpose>

/** Lý do khoản tiền cần đối soát. */
export const ReconciliationReason = z.enum(['amount_mismatch', 'paid_after_cancel', 'extra_payment'])
export type ReconciliationReason = z.infer<typeof ReconciliationReason>

export const ReconciliationStatus = z.enum(['open', 'resolved'])
export type ReconciliationStatus = z.infer<typeof ReconciliationStatus>

/**
 * Cách đóng mục cần đối soát: khôi phục đơn, đã xử lý ngoài hệ thống, tạo một hoàn tiền bằng số tiền của mục
 * (`refunded`), hoặc hệ thống tự đóng mục lệch tiền khi khoản sau làm đơn đủ tiền (`settled_by_payment`, không có
 * người đóng).
 */
export const ReconciliationResolution = z.enum(['restored', 'handled_externally', 'settled_by_payment', 'refunded'])
export type ReconciliationResolution = z.infer<typeof ReconciliationResolution>

/** Mục cần đối soát của một khoản tiền; `resolution`, `resolvedBy`, `resolvedAt` có khi đã đóng. */
export const ReconciliationDetail = z.object({
  id: z.string(),
  reason: ReconciliationReason,
  status: ReconciliationStatus,
  resolution: ReconciliationResolution.nullable(),
  note: z.string().nullable(),
  resolvedBy: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
  resolvedAt: z.string().nullable(),
})
export type ReconciliationDetail = z.infer<typeof ReconciliationDetail>

/** Khoản tiền cổng báo về cho đơn; `reconciliation` có khi khoản đó bị gắn cờ cần đối soát. */
export const AdminPaymentTransaction = z.object({
  id: z.string(),
  purpose: PaymentPurpose,
  amount: z.number(),
  reference: z.string(),
  paidAt: z.string(),
  source: PaymentSource,
  reconciliation: ReconciliationDetail.nullable(),
  /** VND còn hoàn qua cổng được: 0 khi cổng đang dùng không hoàn được giao dịch này (ví dụ giao dịch giả lập trên VNPAY). */
  gatewayRefundable: z.number(),
})
export type AdminPaymentTransaction = z.infer<typeof AdminPaymentTransaction>

/** Ai làm một việc trong lịch sử đơn. Khách có `email` khi đã đăng nhập; người cầm link tra cứu thì `null`. */
export const OrderHistoryActor = z.discriminatedUnion('type', [
  z.object({ type: z.literal('staff'), id: z.string(), name: z.string(), email: z.string() }),
  z.object({ type: z.literal('customer'), id: z.string().nullable(), email: z.string().nullable() }),
  z.object({ type: z.literal('system') }),
])
export type OrderHistoryActor = z.infer<typeof OrderHistoryActor>

/**
 * Một dòng lịch sử thao tác, cũ trước: một sự kiện đơn (`action` là loại sự kiện như `paid`, `cancelled`). Mỗi thao tác
 * một dòng; bản audit của thao tác nhân viên xem ở trang Nhật ký kiểm toán.
 */
export const OrderHistoryEntry = z.object({
  action: z.string(),
  actor: OrderHistoryActor,
  data: z.unknown(),
  at: z.string(),
})
export type OrderHistoryEntry = z.infer<typeof OrderHistoryEntry>

/** Chi tiết đơn ở trang quản trị: mọi thứ khách thấy, thêm giao dịch thanh toán và lịch sử thao tác. */
export const AdminOrder = PublicOrder.extend({
  /** Tài khoản khách đặt hoặc được gắn đơn; `null` với đơn vãng lai. */
  customerId: z.string().nullable(),
  /** Mã giảm giá như lúc đặt (loại, mức giảm), kèm id để mở trang mã; `null` khi đơn không dùng mã. */
  voucher: z
    .object({
      id: z.string(),
      code: z.string(),
      kind: VoucherKind,
      amount: z.number().nullable(),
      percent: z.number().nullable(),
      maxDiscount: z.number().nullable(),
    })
    .nullable(),
  /** Tiền hàng sau giảm, là số tiền ngưỡng miễn phí giao và tiền cọc tính trên đó. */
  subtotalAfterDiscount: z.number(),
  payments: z.array(AdminPaymentTransaction),
  /** Ghi chú nội bộ lúc hủy đơn đã nhận tiền. */
  cancelNote: z.string().nullable(),
  /** VND: tổng đã hoàn xong, tổng đang hoàn (chờ hoàn hoặc cổng đang xử lý); đã nhận ở `received`. ADR 0014. */
  refunded: z.number(),
  refunding: z.number(),
  /** Còn hoàn được: đã nhận trừ mọi khoản hoàn chưa thất bại. */
  refundable: z.number(),
  /**
   * Tổng phần các giao dịch còn hoàn qua cổng được (chưa trừ khoản chờ hoàn, vì chính khoản đó sẽ đi qua cổng). Khoản chờ
   * hoàn có số tiền lớn hơn số này thì chỉ hoàn bằng chuyển khoản.
   */
  gatewayRefundable: z.number(),
  /** Mọi khoản hoàn kể cả thất bại, đủ thông tin nội bộ; thay cho `refunds` của khách. */
  refunds: z.array(AdminRefund),
  history: z.array(OrderHistoryEntry),
})
export type AdminOrder = z.infer<typeof AdminOrder>

/** Body của `POST /api/admin/orders/:code/hand-over`: một đơn là một kiện, một mã vận đơn. */
export const HandoverRequest = z.object({
  carrier: z.string().trim().min(1, 'Cần đơn vị vận chuyển').max(100),
  trackingNumber: z.string().trim().min(1, 'Cần mã vận đơn').max(100),
})
export type HandoverRequest = z.infer<typeof HandoverRequest>

/** Body của `POST /api/admin/orders/:code/redeliver`: giao lại đơn giao thất bại với đơn vị vận chuyển và mã vận đơn mới. */
export const RedeliverRequest = HandoverRequest
export type RedeliverRequest = HandoverRequest

/**
 * Body của `POST /api/admin/orders/:code/return-to-stock`: với mỗi dòng đơn (theo biến thể), số nhập lại tồn và số
 * hỏng/mất; tổng hai số bằng số lượng của dòng, kiểm ở API. Mọi dòng của đơn phải có mặt đúng một lần.
 */
export const ReturnToStockRequest = z.object({
  lines: z
    .array(
      z.object({
        variantId: z.string(),
        restocked: z.number().int().min(0),
        writtenOff: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(100),
})
export type ReturnToStockRequest = z.infer<typeof ReturnToStockRequest>

/**
 * Body của `POST /api/admin/orders/:code/cancel-paid`: lý do và số tiền đề xuất hoàn (0 tới số còn hoàn được). Số hoàn
 * thấp hơn số còn hoàn được thì ghi chú bắt buộc; `supply_failed` luôn hoàn đủ. Kiểm ở API vì cần số tiền của đơn.
 */
export const CancelPaidOrderRequest = z.object({
  cause: OrderCancelCause,
  refundAmount: z.number().int().min(0, 'Số tiền hoàn không âm'),
  note: z.string().trim().max(2000).optional(),
})
export type CancelPaidOrderRequest = z.input<typeof CancelPaidOrderRequest>
