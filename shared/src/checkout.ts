import { z } from 'zod'
import { AttributeValues } from './attributes.ts'
import { PublicImage } from './products.ts'
import { ProvinceCode } from './regions.ts'

/** Số cái tối đa của một biến thể trong một đơn. */
export const MAX_QUANTITY_PER_VARIANT = 5

/** Số dòng tối đa trong giỏ hàng. */
export const MAX_CART_LINES = 50

/** Một dòng giỏ hàng gửi lên server: biến thể và số lượng. */
export const CartLine = z.object({
  variantId: z.uuid(),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(MAX_QUANTITY_PER_VARIANT, `Tối đa ${MAX_QUANTITY_PER_VARIANT} cái mỗi biến thể`),
})
export type CartLine = z.infer<typeof CartLine>

/** Các dòng giỏ hàng; mỗi biến thể một dòng (giỏ đã cộng dồn). Dùng chung cho `quote` và đặt mua. */
export const CartLines = z
  .array(CartLine)
  .min(1, 'Giỏ hàng đang trống')
  .max(MAX_CART_LINES)
  .superRefine((lines, ctx) => {
    const seen = new Set<string>()
    lines.forEach((line, index) => {
      if (seen.has(line.variantId)) {
        ctx.addIssue({ code: 'custom', path: [index, 'variantId'], message: 'Biến thể bị lặp trong giỏ' })
      }
      seen.add(line.variantId)
    })
  })

/** Body của `POST /api/checkout/quote`. Thiếu `provinceCode` (trang giỏ hàng) thì không tính phí giao. */
export const CheckoutQuoteRequest = z.object({
  lines: CartLines,
  provinceCode: ProvinceCode.optional(),
})
export type CheckoutQuoteRequest = z.infer<typeof CheckoutQuoteRequest>

/**
 * Một dòng như khách sẽ mua lúc này, đọc từ phiên bản đang xuất bản. `discontinued` là biến thể không còn bán:
 * ngừng bán, sản phẩm không còn xuất bản hoặc không tồn tại; khi đó các trường của biến thể là `null`.
 */
export const QuoteLine = z.object({
  variantId: z.string(),
  quantity: z.number(),
  /** `null` khi sản phẩm không còn xuất bản. */
  product: z.object({ slug: z.string(), name: z.string() }).nullable(),
  sku: z.string().nullable(),
  attributes: AttributeValues.nullable(),
  /** Ảnh của biến thể, không có thì ảnh đầu tiên của sản phẩm. */
  image: PublicImage.nullable(),
  /** Giá bán hiện tại. */
  price: z.number().nullable(),
  compareAtPrice: z.number().nullable(),
  /** Giá × số lượng; `null` khi dòng không mua được. */
  lineTotal: z.number().nullable(),
  discontinued: z.boolean(),
  /** Còn hàng hay hết, không bao giờ kèm số lượng (ADR 0006). */
  inStock: z.boolean(),
})
export type QuoteLine = z.infer<typeof QuoteLine>

/** Response của `POST /api/checkout/quote`; không ghi gì. */
export const CheckoutQuote = z.object({
  lines: z.array(QuoteLine),
  /** Có ít nhất một sản phẩm chỉ giao đường bộ: trang hiện lưu ý thời gian giao lâu hơn. */
  groundShippingOnly: z.boolean(),
  /** Tổng tiền hàng của các dòng mua được (còn bán và còn hàng). */
  subtotal: z.number(),
  freeShippingThreshold: z.number().nullable(),
  /** `null` khi chưa chọn tỉnh/thành; 0 khi được miễn phí giao. */
  shippingFee: z.number().nullable(),
  /** Tổng phải trả = tổng tiền hàng + phí giao; `null` khi chưa chọn tỉnh/thành. */
  total: z.number().nullable(),
})
export type CheckoutQuote = z.infer<typeof CheckoutQuote>
