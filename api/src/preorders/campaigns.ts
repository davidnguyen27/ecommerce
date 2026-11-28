import { ErrorCode, type PreorderCampaign } from '@ecommerce/shared'
import { ACTOR_SELECT } from '../core/audit/audited.ts'
import type { DbClient } from '../core/db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../core/errors.ts'
import { isoDay } from '../core/utils/format.ts'

/** An open campaign (GLOSSARY "Đợt đặt trước"): not closed by hand and not past its closing time. */
export const isCampaignOpen = (campaign: { closedAt: Date | null; closesAt: Date }, now = new Date()) =>
  campaign.closedAt === null && campaign.closesAt > now

/** Prisma condition for open campaigns, for list queries. */
export const openCampaignWhere = (now = new Date()) =>
  ({ closedAt: null, closesAt: { gt: now } }) satisfies Prisma.PreorderCampaignWhereInput

/**
 * Used allocation per variant per campaign: total quantity of uncancelled pre-orders, by campaign then variant.
 * Computed on demand, not stored as a counter. Campaigns or variants without orders are absent (i.e. 0).
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

/** What customers see about a variant open for pre-order: campaign, deposit percent, expected delivery. */
export type PreorderOffer = { campaignId: string; depositPercent: number; deliveryFrom: string; deliveryTo: string }

/**
 * Variants open for pre-order (GLOSSARY "Đang nhận đặt trước"), by variant id: published product, variant not
 * discontinued, no regular stock (`on_hand - reserved <= 0`), in an open campaign with used below allocation. One unit
 * of regular stock means no pre-order. Like `inStockIds`, never returns quantities or allocations (ADR 0006).
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
      deliveryFrom: isoDay(row.deliveryFrom),
      deliveryTo: isoDay(row.deliveryTo),
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

/** Campaign header shared by list and detail; delivery dates are DATE columns, returned as `YYYY-MM-DD`. */
export function toCampaignHeader(campaign: CampaignRow, now = new Date()) {
  return {
    id: campaign.id,
    product: campaign.product,
    depositPercent: campaign.depositPercent,
    deliveryFrom: isoDay(campaign.deliveryFrom),
    deliveryTo: isoDay(campaign.deliveryTo),
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

/** Figures for one variant in a campaign, from uncancelled orders (see `PreorderCampaignVariant`). */
export type VariantStats = { used: number; deposited: number; pendingDeposit: number; arrived: number }

/**
 * Per-variant figures of the campaigns, by campaign then variant: used, deposited (fully paid included), awaiting
 * deposit, and arrived (fully arrived counts the full quantity even after handover zeroed reserved). One SQL query for
 * the whole campaign list.
 */
export async function campaignStats(db: DbClient, campaignIds: string[]) {
  const stats = new Map<string, Map<string, VariantStats>>()
  if (campaignIds.length === 0) return stats
  const rows = await db.$queryRaw<
    { campaignId: string; variantId: string; used: bigint; deposited: bigint; pending: bigint; arrived: bigint }[]
  >`
    SELECT o."preorder_campaign_id" AS "campaignId", l."variant_id" AS "variantId",
      SUM(l."quantity") AS "used",
      COALESCE(SUM(l."quantity") FILTER (WHERE o."payment_status" IN ('deposit_paid', 'paid')), 0) AS "deposited",
      COALESCE(SUM(l."quantity") FILTER (WHERE o."status" = 'pending_payment'), 0) AS "pending",
      SUM(CASE WHEN o."arrived_at" IS NOT NULL THEN l."quantity" ELSE l."reserved_quantity" END) AS "arrived"
    FROM "order" o JOIN "order_line" l ON l."order_id" = o."id"
    WHERE o."preorder_campaign_id" IN (${Prisma.join(campaignIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND o."status" <> 'cancelled'
    GROUP BY o."preorder_campaign_id", l."variant_id"`
  for (const row of rows) {
    const byVariant = stats.get(row.campaignId) ?? new Map<string, VariantStats>()
    byVariant.set(row.variantId, {
      used: Number(row.used),
      deposited: Number(row.deposited),
      pendingDeposit: Number(row.pending),
      arrived: Number(row.arrived),
    })
    stats.set(row.campaignId, byVariant)
  }
  return stats
}

const NO_ORDERS: VariantStats = { used: 0, deposited: 0, pendingDeposit: 0, arrived: 0 }

/** The campaign's variants in the product's variant order, with allocation and order figures. */
export function toCampaignVariants(campaign: CampaignRow, stats: Map<string, VariantStats> | undefined) {
  return [...campaign.variants]
    .sort((a, b) => a.variant.sortOrder - b.variant.sortOrder || a.variant.sku.localeCompare(b.variant.sku))
    .map((v) => ({
      variantId: v.variantId,
      sku: v.variant.sku,
      attributes: v.variant.attributes as PreorderCampaign['variants'][number]['attributes'],
      status: v.variant.status,
      allocation: v.allocation,
      ...(stats?.get(v.variantId) ?? NO_ORDERS),
    }))
}

export async function loadCampaign(db: DbClient, id: string): Promise<PreorderCampaign> {
  const campaign = await db.preorderCampaign.findUnique({ where: { id }, include: CAMPAIGN_INCLUDE })
  if (!campaign) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đợt đặt trước')
  const [stats, orders] = await Promise.all([
    campaignStats(db, [id]),
    // Uncancelled orders of the campaign in deposit order, which is also the arrival allocation order (ADR 0013);
    // pending deposits last.
    db.order.findMany({
      where: { preorderCampaignId: id, status: { not: 'cancelled' } },
      include: { lines: { orderBy: { position: 'asc' } } },
      orderBy: [{ depositPaidAt: { sort: 'asc', nulls: 'last' } }, { code: 'asc' }],
    }),
  ])
  return {
    ...toCampaignHeader(campaign),
    variants: toCampaignVariants(campaign, stats.get(id)),
    orders: orders.map((order) => {
      const line = order.lines[0]!
      return {
        code: order.code,
        recipientName: order.recipientName,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        sku: line.sku,
        quantity: line.quantity,
        arrivedQuantity: order.arrivedAt ? line.quantity : line.reservedQuantity,
        depositPaidAt: order.depositPaidAt?.toISOString() ?? null,
        remainderDueAt: order.remainderDueAt?.toISOString() ?? null,
        remainderOverdueAt: order.remainderOverdueAt?.toISOString() ?? null,
      }
    }),
  }
}
