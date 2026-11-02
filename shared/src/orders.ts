import { z } from 'zod'
import { AttributeValues } from './attributes.ts'
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
})
export type PublicOrder = z.infer<typeof PublicOrder>
