import { z } from 'zod'
import { AttributeValues } from './attributes.ts'
import { PageQuery, pageOf } from './pagination.ts'
import { PublicImage } from './products.ts'

/** Trạng thái đơn hàng (GLOSSARY "Trạng thái đơn hàng"). */
export const OrderStatus = z.enum(['pending_payment', 'processing', 'completed', 'cancelled'])
export type OrderStatus = z.infer<typeof OrderStatus>

/** Trạng thái thanh toán; M4 thêm đặt cọc, M6 thêm hoàn tiền. */
export const PaymentStatus = z.enum(['unpaid', 'paid'])
export type PaymentStatus = z.infer<typeof PaymentStatus>

/** Trạng thái giao hàng. */
export const FulfillmentStatus = z.enum(['not_prepared', 'preparing', 'handed_over', 'delivered', 'failed'])
export type FulfillmentStatus = z.infer<typeof FulfillmentStatus>

/** Vì sao đơn chưa thanh toán bị hủy: quá hạn giữ hàng, khách tự hủy, hay nhân viên hủy. */
export const OrderCancelReason = z.enum(['expired', 'customer', 'staff'])
export type OrderCancelReason = z.infer<typeof OrderCancelReason>

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
})
export type OrderLineView = z.infer<typeof OrderLineView>

/**
 * Đơn hàng như khách thấy: qua link có token (`GET /api/orders/:code?token=…`), và trong tài khoản (ticket 11).
 * Mọi thứ là snapshot lúc đặt mua.
 */
export const PublicOrder = z.object({
  code: z.number(),
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  fulfillmentStatus: FulfillmentStatus,
  createdAt: z.string(),
  /** Hạn giữ hàng khi đơn còn chờ thanh toán; `null` khi không còn hạn. */
  reservedUntil: z.string().nullable(),
  /** Có khi đơn `cancelled`. */
  cancelReason: OrderCancelReason.nullable(),
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
})
export type PublicOrder = z.infer<typeof PublicOrder>

/** Một đơn trong lịch sử mua của khách (`GET /api/account/orders`). */
export const AccountOrderSummary = z.object({
  code: z.number(),
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
export const PaymentSource = z.enum(['webhook', 'query', 'simulator'])
export type PaymentSource = z.infer<typeof PaymentSource>

/** Lý do khoản tiền cần đối soát. */
export const ReconciliationReason = z.enum(['amount_mismatch', 'paid_after_cancel', 'extra_payment'])
export type ReconciliationReason = z.infer<typeof ReconciliationReason>

export const ReconciliationStatus = z.enum(['open', 'resolved'])
export type ReconciliationStatus = z.infer<typeof ReconciliationStatus>

/** Cách đóng mục cần đối soát: khôi phục đơn, hoặc đã xử lý ngoài hệ thống (hoàn tiền tay…). */
export const ReconciliationResolution = z.enum(['restored', 'handled_externally'])
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
  amount: z.number(),
  reference: z.string(),
  paidAt: z.string(),
  source: PaymentSource,
  reconciliation: ReconciliationDetail.nullable(),
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
 * Một dòng lịch sử thao tác, cũ trước: sự kiện đơn (`source: event`, `action` là loại sự kiện như `paid`), hoặc bản
 * audit của nhân viên trên đơn (`source: audit`, `action` như `order.cancel`, `data` là `{ before, after }`).
 */
export const OrderHistoryEntry = z.object({
  source: z.enum(['event', 'audit']),
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
  payments: z.array(AdminPaymentTransaction),
  history: z.array(OrderHistoryEntry),
})
export type AdminOrder = z.infer<typeof AdminOrder>

/** Body của `POST /api/admin/orders/:code/hand-over`: một đơn là một kiện, một mã vận đơn. */
export const HandoverRequest = z.object({
  carrier: z.string().trim().min(1, 'Cần đơn vị vận chuyển').max(100),
  trackingNumber: z.string().trim().min(1, 'Cần mã vận đơn').max(100),
})
export type HandoverRequest = z.infer<typeof HandoverRequest>
