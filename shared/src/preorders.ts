import { z } from 'zod'
import { AuditActor } from './audit.ts'
import { AttributeValues } from './attributes.ts'
import { PageQuery, pageOf } from './pagination.ts'
import { ProductStatus, VariantStatus } from './products.ts'

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
