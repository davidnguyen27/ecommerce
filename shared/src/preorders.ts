import { z } from 'zod'
import { AuditActor } from './audit.ts'
import { AttributeValues } from './attributes.ts'
import { CartLine, InvoiceInfo, ShippingAddress } from './checkout.ts'
import { PageQuery, pageOf } from './pagination.ts'
import { PreorderOffer, ProductStatus, PublicImage, VariantStatus } from './products.ts'
import { ProvinceCode } from './regions.ts'

/** Trạng thái nhập hàng của đợt; "đã về kho" tính theo từng đơn, không nằm ở đây. */
export const PreorderSupplyStatus = z.enum(['not_ordered', 'ordered', 'in_transit', 'issue'])
export type PreorderSupplyStatus = z.infer<typeof PreorderSupplyStatus>

/** Một biến thể nhận đặt trong đợt và số suất của nó. */
export const PreorderCampaignVariantInput = z.object({
  variantId: z.uuid(),
  allocation: z.number().int().min(1, 'Số suất ít nhất là 1').max(100_000),
})
export type PreorderCampaignVariantInput = z.infer<typeof PreorderCampaignVariantInput>

const Variants = z
  .array(PreorderCampaignVariantInput)
  .min(1, 'Cần ít nhất một biến thể')
  .max(200)
  .superRefine((variants, ctx) => {
    const seen = new Set<string>()
    variants.forEach(({ variantId }, index) => {
      if (seen.has(variantId))
        ctx.addIssue({ code: 'custom', path: [index, 'variantId'], message: 'Biến thể bị trùng' })
      seen.add(variantId)
    })
  })

const CampaignFields = z.object({
  /** Phần trăm tiền hàng khách cọc. */
  depositPercent: z.number().int().min(10, 'Mức cọc từ 10%').max(100, 'Mức cọc tối đa 100%'),
  /** Thời gian giao dự kiến, `YYYY-MM-DD`. */
  deliveryFrom: z.iso.date(),
  deliveryTo: z.iso.date(),
  /** Hạn đóng nhận đặt, ISO 8601; phải ở tương lai khi tạo hoặc khi đổi. */
  closesAt: z.iso.datetime({ offset: true }),
  /** Số ngày khách được trả phần còn lại từ lúc hàng về. */
  remainderDays: z.number().int().min(1, 'Ít nhất 1 ngày').max(90),
  supplyStatus: PreorderSupplyStatus,
  supplyNote: z.string().trim().max(2000),
  /** Toàn bộ biến thể của đợt sau khi lưu: thêm biến thể mới, sửa suất, bỏ biến thể chưa có đơn. */
  variants: Variants,
})

const deliveryOrder = (value: { deliveryFrom?: string; deliveryTo?: string }, ctx: z.RefinementCtx) => {
  if (value.deliveryFrom && value.deliveryTo && value.deliveryFrom > value.deliveryTo) {
    ctx.addIssue({ code: 'custom', path: ['deliveryTo'], message: 'Ngày giao muộn nhất phải sau ngày sớm nhất' })
  }
}

/** Mở một đợt đặt trước cho một sản phẩm. */
export const PreorderCampaignCreate = CampaignFields.extend({
  productId: z.uuid(),
  remainderDays: CampaignFields.shape.remainderDays.default(7),
  supplyStatus: PreorderSupplyStatus.default('not_ordered'),
  supplyNote: CampaignFields.shape.supplyNote.default(''),
}).superRefine(deliveryOrder)
export type PreorderCampaignCreate = z.input<typeof PreorderCampaignCreate>

/**
 * Sửa đợt: chỉ gửi các trường muốn đổi. Khi đợt đã có đơn thì mức cọc và số ngày trả phần còn lại bị khóa, suất không
 * thấp hơn số đã dùng, và không bỏ được biến thể đã có đơn. Đợt đã đóng thì không đổi được hạn đóng.
 */
export const PreorderCampaignUpdate = CampaignFields.partial().superRefine(deliveryOrder)
export type PreorderCampaignUpdate = z.input<typeof PreorderCampaignUpdate>

export const PreorderCampaignQuery = PageQuery.extend({
  state: z.enum(['open', 'closed', 'all']).default('all'),
  productId: z.uuid().optional(),
})
export type PreorderCampaignQuery = z.infer<typeof PreorderCampaignQuery>

const CampaignHeader = z.object({
  id: z.string(),
  product: z.object({ id: z.string(), name: z.string(), slug: z.string(), status: ProductStatus }),
  depositPercent: z.number(),
  deliveryFrom: z.string(),
  deliveryTo: z.string(),
  closesAt: z.string(),
  remainderDays: z.number(),
  supplyStatus: PreorderSupplyStatus,
  supplyNote: z.string(),
  /** Có khi nhân viên đóng tay. */
  closedAt: z.string().nullable(),
  /** Đang nhận đặt: chưa đóng tay và chưa tới hạn đóng. */
  isOpen: z.boolean(),
  createdAt: z.string(),
  createdBy: AuditActor,
})

/** Một biến thể của đợt: suất và số đã dùng (tổng số lượng của đơn đặt trước chưa hủy). */
export const PreorderCampaignVariant = z.object({
  variantId: z.string(),
  sku: z.string(),
  attributes: AttributeValues,
  status: VariantStatus,
  allocation: z.number(),
  used: z.number(),
})
export type PreorderCampaignVariant = z.infer<typeof PreorderCampaignVariant>

export const PreorderCampaign = CampaignHeader.extend({ variants: z.array(PreorderCampaignVariant) })
export type PreorderCampaign = z.infer<typeof PreorderCampaign>

export const PreorderCampaignPage = pageOf(
  CampaignHeader.extend({ variantCount: z.number(), totalAllocation: z.number(), totalUsed: z.number() }),
)
export type PreorderCampaignPage = z.infer<typeof PreorderCampaignPage>

// Khách đặt trước (ADR 0012): không qua giỏ hàng, mỗi đơn một biến thể.

/**
 * Tiền cọc của đơn đặt trước: phần trăm của đợt trên tiền hàng, làm tròn lên 1.000 VND, không vượt tiền hàng. API và
 * trang đặt trước dùng chung để khách thấy đúng số sẽ trả.
 */
export const depositFor = (subtotal: number, percent: number) =>
  Math.min(subtotal, Math.ceil((subtotal * percent) / 100 / 1000) * 1000)

/** Body của `POST /api/preorders/quote`. Thiếu `provinceCode` thì chưa tính phí giao. */
export const PreorderQuoteRequest = z.object({
  variantId: z.uuid(),
  quantity: CartLine.shape.quantity,
  provinceCode: ProvinceCode.optional(),
})
export type PreorderQuoteRequest = z.infer<typeof PreorderQuoteRequest>

/**
 * Báo giá đặt trước như khách sẽ đặt lúc này; không ghi gì. `offer` là đợt đang mở của biến thể (`null` khi không có),
 * `problem` là lý do chưa đặt được với số lượng này (`null` khi đặt được). Các khoản tiền phụ thuộc phí giao là `null`
 * khi chưa chọn tỉnh/thành.
 */
export const PreorderQuote = z.object({
  variantId: z.string(),
  quantity: z.number(),
  /** `null` khi biến thể không còn bán (ngừng bán, sản phẩm không còn xuất bản, không tồn tại). */
  product: z.object({ slug: z.string(), name: z.string() }).nullable(),
  sku: z.string().nullable(),
  attributes: AttributeValues.nullable(),
  image: PublicImage.nullable(),
  price: z.number().nullable(),
  offer: PreorderOffer.extend({ remainderDays: z.number() }).nullable(),
  /** Chỉ `in_stock`, `campaign`, `sold_out`, `discontinued`: giá và mức cọc là của chính báo giá này. */
  problem: z.lazy(() => PreorderChange).nullable(),
  subtotal: z.number().nullable(),
  depositAmount: z.number().nullable(),
  shippingFee: z.number().nullable(),
  total: z.number().nullable(),
  /** Tổng phải trả trừ tiền cọc, gồm phí giao. */
  remainingAmount: z.number().nullable(),
  /** Chính sách đặt trước đang xuất bản; `null` khi chưa có, lúc đó chưa đặt trước được. */
  preorderPolicy: z.object({ slug: z.string(), title: z.string() }).nullable(),
  /** Chính sách đổi trả, bảo hành đang xuất bản của sản phẩm. */
  policies: z.array(z.object({ slug: z.string(), title: z.string() })),
  groundShippingOnly: z.boolean(),
})
export type PreorderQuote = z.infer<typeof PreorderQuote>

/**
 * Body của `POST /api/preorders`. `campaignId`, `price` và `depositPercent` là thứ khách đã thấy: khác hiện tại thì 409.
 * Kèm access token của khách thì đơn gắn với tài khoản.
 */
export const PreorderRequest = z.object({
  variantId: z.uuid(),
  quantity: CartLine.shape.quantity,
  campaignId: z.uuid(),
  price: z.number().int().positive(),
  depositPercent: z.number().int().min(10).max(100),
  address: ShippingAddress,
  note: z.string().trim().max(1000).default(''),
  /** Khách vãng lai phải tick, như đặt mua. */
  acceptPrivacyPolicy: z.boolean().optional(),
  /** Mọi khách phải tick: đã đọc điều kiện cọc, hủy/hoàn và hạn trả phần còn lại. */
  acceptPreorderPolicy: z.boolean().optional(),
  invoice: InvoiceInfo.optional(),
})
export type PreorderRequest = z.input<typeof PreorderRequest>

/** Vì sao không đặt trước được như khách đã thấy. Không bao giờ kèm số suất còn lại (ADR 0006). */
export const PreorderChange = z.discriminatedUnion('kind', [
  /** Đã có hàng sẵn: mua ngay thay vì đặt trước. */
  z.object({ kind: z.literal('in_stock') }),
  z.object({ kind: z.literal('price'), from: z.number(), to: z.number() }),
  z.object({ kind: z.literal('deposit'), from: z.number(), to: z.number() }),
  /** Đợt khách thấy đã đóng hoặc đã thay bằng đợt khác (thời gian giao có thể khác). */
  z.object({ kind: z.literal('campaign') }),
  /** Không còn đủ suất cho số lượng đã chọn. */
  z.object({ kind: z.literal('sold_out') }),
  /** Biến thể ngừng bán hoặc sản phẩm không còn xuất bản. */
  z.object({ kind: z.literal('discontinued') }),
])
export type PreorderChange = z.infer<typeof PreorderChange>

/** `error.details` của 409 khi đặt trước. Không có gì được ghi. */
export const PreorderConflictDetails = z.object({ change: PreorderChange })
export type PreorderConflictDetails = z.infer<typeof PreorderConflictDetails>
