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
