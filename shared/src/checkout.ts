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

/** Danh sách dòng giỏ 1–`MAX_CART_LINES` dòng, mỗi biến thể một dòng (giỏ đã cộng dồn). */
const linesOf = <T extends z.ZodType<{ variantId: string }>>(line: T) =>
  z
    .array(line)
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

/** Các dòng giỏ hàng gửi lên `quote`. */
export const CartLines = linesOf(CartLine)

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
  /** Chính sách đổi trả, bảo hành đang xuất bản của các sản phẩm còn bán trong giỏ, để trang đặt mua hiện link. */
  policies: z.array(z.object({ slug: z.string(), title: z.string() })),
})
export type CheckoutQuote = z.infer<typeof CheckoutQuote>

/** Thời hạn giữ hàng của đơn chưa thanh toán, cũng là thời hạn của link thanh toán. Chờ chủ doanh nghiệp xác nhận. */
export const RESERVATION_MINUTES = 15

/** Một dòng đặt mua: dòng giỏ kèm giá khách đã thấy, để server từ chối khi giá đã đổi. */
export const CheckoutLine = CartLine.extend({ price: z.number().int().positive() })
export type CheckoutLine = z.infer<typeof CheckoutLine>

/** Số điện thoại Việt Nam 10 số bắt đầu bằng 0; nhận cả `+84`, dấu cách, chấm, gạch và lưu về dạng `0xxxxxxxxx`. */
export const PhoneNumber = z
  .string()
  .transform((value) => value.replace(/[\s.-]/g, '').replace(/^\+84/, '0'))
  .pipe(z.string().regex(/^0\d{9}$/, 'Số điện thoại gồm 10 số, bắt đầu bằng 0'))

/** Thông tin nhận hàng. Phường/xã được API kiểm thuộc đúng tỉnh/thành (danh mục ở `@ecommerce/shared/wards`). */
export const ShippingAddress = z.object({
  recipientName: z.string().trim().min(1, 'Cần tên người nhận').max(200),
  phone: PhoneNumber,
  email: z
    .email('Email không hợp lệ')
    .max(254)
    .transform((email) => email.toLowerCase()),
  provinceCode: ProvinceCode,
  wardCode: z.string().regex(/^\d{5}$/, 'Phường/xã không hợp lệ'),
  streetAddress: z.string().trim().min(1, 'Cần số nhà, tên đường').max(500),
})
export type ShippingAddress = z.input<typeof ShippingAddress>

/** `GET /api/account/shipping-address`: địa chỉ của lần đặt mua thành công gần nhất; `null` khi chưa đặt lần nào. */
export const LastShippingAddress = z.object({ address: ShippingAddress.nullable() })
export type LastShippingAddress = z.infer<typeof LastShippingAddress>

/** Mã số thuế: 10 số, hoặc 13 số có gạch nối trước 3 số cuối (chi nhánh), ví dụ `0101234567-001`. */
export const TaxCode = z
  .string()
  .trim()
  .regex(/^\d{10}(-\d{3})?$/, 'Mã số thuế gồm 10 số, hoặc 13 số dạng 0101234567-001')

/** Thông tin xuất hóa đơn công ty; đã gửi thì cần đủ cả ba trường. */
export const InvoiceInfo = z.object({
  companyName: z.string().trim().min(1, 'Cần tên công ty').max(300),
  taxCode: TaxCode,
  address: z.string().trim().min(1, 'Cần địa chỉ xuất hóa đơn').max(500),
})
export type InvoiceInfo = z.infer<typeof InvoiceInfo>

/** Body của `POST /api/checkout`. Kèm access token của khách thì đơn gắn với tài khoản. */
export const CheckoutRequest = z.object({
  lines: linesOf(CheckoutLine),
  address: ShippingAddress,
  note: z.string().trim().max(1000).default(''),
  /** Ô "Tôi đồng ý với chính sách bảo mật": khách vãng lai phải tick; khách đã đăng nhập đã đồng ý lúc đăng ký. */
  acceptPrivacyPolicy: z.boolean().optional(),
  /** Xuất hóa đơn công ty, không bắt buộc. */
  invoice: InvoiceInfo.optional(),
})
export type CheckoutRequest = z.input<typeof CheckoutRequest>

/** Vì sao một dòng không đặt được như khách đã thấy; cùng dạng với thay đổi dòng ở trang giỏ. */
export const CheckoutLineChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('price'), from: z.number(), to: z.number() }),
  z.object({ kind: z.literal('discontinued') }),
  /** Không còn đủ số lượng đã chọn; không bao giờ kèm số còn lại (ADR 0006). */
  z.object({ kind: z.literal('out_of_stock') }),
])
export type CheckoutLineChange = z.infer<typeof CheckoutLineChange>

/** `error.details` của 409 khi đặt mua: thay đổi của từng dòng có vấn đề. Không có gì được ghi. */
export const CheckoutConflictDetails = z.object({
  lines: z.array(z.object({ variantId: z.string(), change: CheckoutLineChange })),
})
export type CheckoutConflictDetails = z.infer<typeof CheckoutConflictDetails>

/** Response 201 của `POST /api/checkout`. `token` chỉ có trong response này; server chỉ lưu hash. */
export const CheckoutResult = z.object({
  code: z.number(),
  token: z.string(),
  /** Trang thanh toán của cổng (cổng giả lập khi chạy local). */
  checkoutUrl: z.string(),
  /** Quá thời điểm này mà chưa thanh toán thì đơn bị hủy, hàng được nhả. */
  reservedUntil: z.string(),
})
export type CheckoutResult = z.infer<typeof CheckoutResult>
