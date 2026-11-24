import { z } from 'zod'
import { AttributeValues } from './attributes.ts'
import { PublicImage } from './products.ts'
import { ProvinceCode } from './regions.ts'
import { VoucherCodeInput, VoucherConflict, VoucherQuote } from './vouchers.ts'

/** Max units of one variant per order. */
export const MAX_QUANTITY_PER_VARIANT = 5

/** Max lines in the cart. */
export const MAX_CART_LINES = 50

/** A cart line sent to the server: variant and quantity. */
export const CartLine = z.object({
  variantId: z.uuid(),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(MAX_QUANTITY_PER_VARIANT, `Tối đa ${MAX_QUANTITY_PER_VARIANT} cái mỗi biến thể`),
})
export type CartLine = z.infer<typeof CartLine>

/** 1–`MAX_CART_LINES` cart lines, one per variant (the cart has merged them). */
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

/** Cart lines sent to `quote`. */
export const CartLines = linesOf(CartLine)

/**
 * The email and phone being typed, sent with a voucher quote to check per-customer uses. Incomplete (malformed) values
 * count as absent, without form errors.
 */
export const QuoteContact = {
  email: z
    .email()
    .transform((email) => email.toLowerCase())
    .optional()
    .catch(undefined),
  phone: z
    .lazy(() => PhoneNumber)
    .optional()
    .catch(undefined),
}

/**
 * Body of `POST /api/checkout/quote`. Without `provinceCode` (cart page) no shipping fee is computed. `voucherCode` is
 * the code typed on the checkout page.
 */
export const CheckoutQuoteRequest = z.object({
  lines: CartLines,
  provinceCode: ProvinceCode.optional(),
  voucherCode: VoucherCodeInput.optional(),
  ...QuoteContact,
})
export type CheckoutQuoteRequest = z.infer<typeof CheckoutQuoteRequest>

/**
 * A line as the customer would buy it now, read from the live version. `discontinued` means not for sale anymore
 * (discontinued, product unpublished or missing); the variant fields are then `null`.
 */
export const QuoteLine = z.object({
  variantId: z.string(),
  quantity: z.number(),
  /** `null` when the product is no longer published. */
  product: z.object({ slug: z.string(), name: z.string() }).nullable(),
  sku: z.string().nullable(),
  attributes: AttributeValues.nullable(),
  /** The variant's image, else the product's first. */
  image: PublicImage.nullable(),
  /** Current sale price. */
  price: z.number().nullable(),
  compareAtPrice: z.number().nullable(),
  /** Price × quantity; `null` when the line cannot be bought. */
  lineTotal: z.number().nullable(),
  discontinued: z.boolean(),
  /** Whether there is enough stock for the line's quantity, never with a count (ADR 0006). */
  inStock: z.boolean(),
})
export type QuoteLine = z.infer<typeof QuoteLine>

/** Response of `POST /api/checkout/quote`; writes nothing. */
export const CheckoutQuote = z.object({
  lines: z.array(QuoteLine),
  /** At least one product ships by ground only: the page notes the longer delivery. */
  groundShippingOnly: z.boolean(),
  /** Goods total of the buyable lines (on sale and in stock). */
  subtotal: z.number(),
  /** Voucher result; `null` when no code was sent. */
  voucher: VoucherQuote.nullable(),
  /** Voucher discount, 0 without a code or when it does not apply. */
  discount: z.number(),
  /** Threshold compared with goods after discount. */
  freeShippingThreshold: z.number().nullable(),
  /** `null` before a province is picked; 0 with free shipping. Computed on goods after discount. */
  shippingFee: z.number().nullable(),
  /** Total due = goods − discount + shipping; `null` before a province is picked. */
  total: z.number().nullable(),
  /** Fee and total without the voucher, for comparison; equal to the two above when there is no discount. */
  shippingFeeWithoutVoucher: z.number().nullable(),
  totalWithoutVoucher: z.number().nullable(),
  /** Published returns and warranty policies of the products on sale in the cart, linked on the checkout page. */
  policies: z.array(z.object({ slug: z.string(), title: z.string() })),
})
export type CheckoutQuote = z.infer<typeof CheckoutQuote>

/** How long an unpaid order holds stock, also the payment link's lifetime. Pending owner confirmation. */
export const RESERVATION_MINUTES = 15

/** A checkout line: a cart line with the price seen, so the server rejects changed prices. */
export const CheckoutLine = CartLine.extend({ price: z.number().int().positive() })
export type CheckoutLine = z.infer<typeof CheckoutLine>

/** 10-digit Vietnamese phone starting with 0; accepts `+84`, spaces, dots, dashes and stores `0xxxxxxxxx`. */
export const PhoneNumber = z
  .string()
  .transform((value) => value.replace(/[\s.-]/g, '').replace(/^\+84/, '0'))
  .pipe(z.string().regex(/^0\d{9}$/, 'Số điện thoại gồm 10 số, bắt đầu bằng 0'))

/** Shipping info. The API checks the ward belongs to the province (list in `@ecommerce/shared/wards`). */
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

/** `GET /api/account/shipping-address`: address of the latest successful checkout; `null` if none yet. */
export const LastShippingAddress = z.object({ address: ShippingAddress.nullable() })
export type LastShippingAddress = z.infer<typeof LastShippingAddress>

/** Tax code: 10 digits, or 13 with a dash before the last 3 (branch), e.g. `0101234567-001`. */
export const TaxCode = z
  .string()
  .trim()
  .regex(/^\d{10}(-\d{3})?$/, 'Mã số thuế gồm 10 số, hoặc 13 số dạng 0101234567-001')

/** Company invoice info; when sent, all three fields are required. */
export const InvoiceInfo = z.object({
  companyName: z.string().trim().min(1, 'Cần tên công ty').max(300),
  taxCode: TaxCode,
  address: z.string().trim().min(1, 'Cần địa chỉ xuất hóa đơn').max(500),
})
export type InvoiceInfo = z.infer<typeof InvoiceInfo>

/** Body of `POST /api/checkout`. A customer access token links the order to the account. */
export const CheckoutRequest = z.object({
  lines: linesOf(CheckoutLine),
  address: ShippingAddress,
  note: z.string().trim().max(1000).default(''),
  /** The "Tôi đồng ý với chính sách bảo mật" box: guests must tick it; signed-in customers agreed at sign-up. */
  acceptPrivacyPolicy: z.boolean().optional(),
  /** Company invoice, optional. */
  invoice: InvoiceInfo.optional(),
  /** Voucher code and discount the customer saw; a difference at order time gives 409 with `details.voucher`. */
  voucherCode: VoucherCodeInput.optional(),
  discount: z.number().int().min(0).default(0),
})
export type CheckoutRequest = z.input<typeof CheckoutRequest>

/** Why a line cannot be ordered as seen; same shape as cart line changes. */
export const CheckoutLineChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('price'), from: z.number(), to: z.number() }),
  z.object({ kind: z.literal('discontinued') }),
  /** Not enough for the chosen quantity; never with the remaining count (ADR 0006). */
  z.object({ kind: z.literal('out_of_stock') }),
])
export type CheckoutLineChange = z.infer<typeof CheckoutLineChange>

/**
 * `error.details` of a checkout 409: changes per problem line, or (when every line is fine) the voucher no longer as
 * seen. Nothing is written.
 */
export const CheckoutConflictDetails = z.object({
  lines: z.array(z.object({ variantId: z.string(), change: CheckoutLineChange })),
  voucher: VoucherConflict.optional(),
})
export type CheckoutConflictDetails = z.infer<typeof CheckoutConflictDetails>

/** 201 response of `POST /api/checkout`. `token` appears only here; the server stores only its hash. */
export const CheckoutResult = z.object({
  code: z.number(),
  token: z.string(),
  /** The gateway's payment page (the simulator locally). */
  checkoutUrl: z.string(),
  /** Unpaid by this time, the order is cancelled and its stock released. */
  reservedUntil: z.string(),
})
export type CheckoutResult = z.infer<typeof CheckoutResult>
