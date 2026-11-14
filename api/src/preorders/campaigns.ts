import { ErrorCode, type PreorderCampaign } from '@ecommerce/shared'
import { ACTOR_SELECT } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'

/** Đợt đang mở (GLOSSARY "Đợt đặt trước"): chưa đóng tay và chưa tới hạn đóng. */
export const isCampaignOpen = (campaign: { closedAt: Date | null; closesAt: Date }, now = new Date()) =>
  campaign.closedAt === null && campaign.closesAt > now

/** Điều kiện Prisma của đợt đang mở, dùng cho truy vấn danh sách. */
export const openCampaignWhere = (now = new Date()) =>
  ({ closedAt: null, closesAt: { gt: now } }) satisfies Prisma.PreorderCampaignWhereInput

/**
 * Số đã dùng của từng biến thể trong các đợt: tổng số lượng của đơn đặt trước chưa hủy, theo đợt rồi theo biến thể.
 * Tính khi cần, không lưu thành bộ đếm. Đợt hay biến thể chưa có đơn thì không có trong kết quả (tức là 0).
 */
export async function usedAllocations(db: DbClient, campaignIds: string[]) {
  const used = new Map<string, Map<string, number>>()
  if (campaignIds.length === 0) return used
  const rows = await db.$queryRaw<{ campaignId: string; variantId: string; used: bigint }[]>`
    SELECT o."preorder_campaign_id" AS "campaignId", l."variant_id" AS "variantId", SUM(l."quantity") AS "used"
    FROM "order" o JOIN "order_line" l ON l."order_id" = o."id"
    WHERE o."preorder_campaign_id" IN (${Prisma.join(campaignIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND o."status" <> 'cancelled'
    GROUP BY o."preorder_campaign_id", l."variant_id"`
  for (const row of rows) {
    const byVariant = used.get(row.campaignId) ?? new Map<string, number>()
    byVariant.set(row.variantId, Number(row.used))
    used.set(row.campaignId, byVariant)
  }
  return used
}

/** Điều khách thấy về một biến thể đang nhận đặt trước: đợt, mức cọc, thời gian giao dự kiến. */
export type PreorderOffer = { campaignId: string; depositPercent: number; deliveryFrom: string; deliveryTo: string }

/**
 * Những biến thể đang nhận đặt trước (GLOSSARY "Đang nhận đặt trước"), theo id biến thể: sản phẩm đã xuất bản, biến
 * thể không ngừng bán, hết hàng sẵn (`on_hand - reserved <= 0`), thuộc đợt đang mở và số đã dùng còn dưới suất.
 * Còn một cái hàng sẵn là không đặt trước được. Như `inStockIds`, không bao giờ trả số lượng hay số suất (ADR 0006).
 */
export async function preorderOffers(db: DbClient, variantIds: readonly string[], now = new Date()) {
  const offers = new Map<string, PreorderOffer>()
  if (variantIds.length === 0) return offers
  const rows = await db.$queryRaw<
    { variantId: string; campaignId: string; depositPercent: number; deliveryFrom: Date; deliveryTo: Date }[]
  >`
    SELECT cv."variant_id"::text AS "variantId", c."id"::text AS "campaignId", c."deposit_percent" AS "depositPercent",
      c."delivery_from" AS "deliveryFrom", c."delivery_to" AS "deliveryTo"
    FROM "preorder_campaign_variant" cv
    JOIN "preorder_campaign" c ON c."id" = cv."campaign_id"
    JOIN "product_variant" v ON v."id" = cv."variant_id"
    JOIN "product" p ON p."id" = c."product_id"
    WHERE cv."variant_id" = ANY(${[...variantIds]}::uuid[])
      AND c."closed_at" IS NULL AND c."closes_at" > ${now}
      AND p."status" = 'published' AND v."status" = 'active'
      AND v."on_hand" - v."reserved" <= 0
      AND cv."allocation" > COALESCE((
        SELECT SUM(l."quantity") FROM "order_line" l JOIN "order" o ON o."id" = l."order_id"
        WHERE o."preorder_campaign_id" = c."id" AND l."variant_id" = cv."variant_id" AND o."status" <> 'cancelled'
      ), 0)`
  for (const row of rows) {
    offers.set(row.variantId, {
      campaignId: row.campaignId,
      depositPercent: row.depositPercent,
      deliveryFrom: day(row.deliveryFrom),
      deliveryTo: day(row.deliveryTo),
    })
  }
  return offers
}

export const CAMPAIGN_INCLUDE = {
  product: { select: { id: true, name: true, slug: true, status: true } },
  createdBy: { select: ACTOR_SELECT },
  variants: {
    include: { variant: { select: { sku: true, attributes: true, status: true, sortOrder: true } } },
  },
} as const satisfies Prisma.PreorderCampaignInclude

type CampaignRow = Prisma.PreorderCampaignGetPayload<{ include: typeof CAMPAIGN_INCLUDE }>

const day = (date: Date) => date.toISOString().slice(0, 10)

/** Phần đầu đợt dùng chung cho danh sách và chi tiết; ngày giao lưu kiểu DATE, trả `YYYY-MM-DD`. */
export function toCampaignHeader(campaign: CampaignRow, now = new Date()) {
  return {
    id: campaign.id,
    product: campaign.product,
    depositPercent: campaign.depositPercent,
    deliveryFrom: day(campaign.deliveryFrom),
    deliveryTo: day(campaign.deliveryTo),
    closesAt: campaign.closesAt.toISOString(),
    remainderDays: campaign.remainderDays,
    supplyStatus: campaign.supplyStatus,
    supplyNote: campaign.supplyNote,
    closedAt: campaign.closedAt?.toISOString() ?? null,
    isOpen: isCampaignOpen(campaign, now),
    createdAt: campaign.createdAt.toISOString(),
    createdBy: campaign.createdBy,
  }
}

/** Biến thể của đợt theo thứ tự biến thể trên sản phẩm, kèm suất và số đã dùng. */
export function toCampaignVariants(campaign: CampaignRow, used: Map<string, number> | undefined) {
  return [...campaign.variants]
    .sort((a, b) => a.variant.sortOrder - b.variant.sortOrder || a.variant.sku.localeCompare(b.variant.sku))
    .map((v) => ({
      variantId: v.variantId,
      sku: v.variant.sku,
      attributes: v.variant.attributes as PreorderCampaign['variants'][number]['attributes'],
      status: v.variant.status,
      allocation: v.allocation,
      used: used?.get(v.variantId) ?? 0,
    }))
}

export async function loadCampaign(db: DbClient, id: string): Promise<PreorderCampaign> {
  const campaign = await db.preorderCampaign.findUnique({ where: { id }, include: CAMPAIGN_INCLUDE })
  if (!campaign) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đợt đặt trước')
  const used = await usedAllocations(db, [id])
  return { ...toCampaignHeader(campaign), variants: toCampaignVariants(campaign, used.get(id)) }
}
