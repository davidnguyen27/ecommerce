import type { PreorderChange } from '@ecommerce/shared'
import { cartVariants, type CartVariant } from '../catalog/live-variants.ts'
import type { DbClient } from '../core/db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { usedAllocations } from './campaigns.ts'

/** The variant's open campaign, with the fields snapshotted onto pre-orders. */
export type OpenCampaign = {
  id: string
  depositPercent: number
  deliveryFrom: Date
  deliveryTo: Date
  remainderDays: number
}

export type PreorderCheck = {
  /** The variant as customers see it (live version); `variant` is `null` when no longer on sale. */
  found: CartVariant
  /** The open campaign containing this variant, even when allocation is used up; `null` if none. */
  campaign: OpenCampaign | null
  /** Why `quantity` cannot be pre-ordered now; `null` when it can. */
  problem: Extract<PreorderChange['kind'], 'in_stock' | 'campaign' | 'sold_out' | 'discontinued'> | null
}

/**
 * Whether `quantity` of the variant can be pre-ordered now (GLOSSARY "Đang nhận đặt trước"): on sale, no regular stock,
 * in an open campaign with enough allocation. Like `preorderOffers`, for one variant and quantity.
 * `lock` is for the pre-order transaction: locks the variant row then the allocation row, so two customers racing for
 * the last allocation run in turn, and allocation edits (ticket 02) cannot slip in between check and order.
 */
export async function checkPreorder(
  db: DbClient,
  variantId: string,
  quantity: number,
  { lock = false, now = new Date() }: { lock?: boolean; now?: Date } = {},
): Promise<PreorderCheck> {
  // Variant row then allocation row, the same order as everywhere that locks both.
  const forUpdate = (of: Prisma.Sql) => (lock ? Prisma.sql`FOR UPDATE ${of}` : Prisma.empty)
  const [live] = await db.$queryRaw<{ available: number }[]>`
    SELECT "on_hand" - "reserved" AS available FROM "product_variant" WHERE "id" = ${variantId}::uuid
    ${forUpdate(Prisma.empty)}`
  const found = (await cartVariants(db, [variantId])).get(variantId) ?? { snapshot: null, variant: null }
  if (!live || !found.variant) return { found, campaign: null, problem: 'discontinued' }

  const [row] = await db.$queryRaw<(OpenCampaign & { allocation: number })[]>`
    SELECT c."id"::text AS id, c."deposit_percent" AS "depositPercent", c."delivery_from" AS "deliveryFrom",
      c."delivery_to" AS "deliveryTo", c."remainder_days" AS "remainderDays", cv."allocation"
    FROM "preorder_campaign_variant" cv JOIN "preorder_campaign" c ON c."id" = cv."campaign_id"
    WHERE cv."variant_id" = ${variantId}::uuid AND c."closed_at" IS NULL AND c."closes_at" > ${now}
    ${forUpdate(Prisma.sql`OF cv`)}`
  const campaign = row
    ? {
        id: row.id,
        depositPercent: row.depositPercent,
        deliveryFrom: row.deliveryFrom,
        deliveryTo: row.deliveryTo,
        remainderDays: row.remainderDays,
      }
    : null

  // One unit of regular stock means no pre-order: the customer buys now.
  if (live.available > 0) return { found, campaign, problem: 'in_stock' }
  if (!row || !campaign) return { found, campaign, problem: 'campaign' }
  const used = (await usedAllocations(db, [campaign.id])).get(campaign.id)?.get(variantId) ?? 0
  return { found, campaign, problem: used + quantity > row.allocation ? 'sold_out' : null }
}
