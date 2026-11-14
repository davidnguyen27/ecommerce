import type { PreorderChange } from '@ecommerce/shared'
import { cartVariants, type CartVariant } from '../checkout/live-variants.ts'
import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { usedAllocations } from './campaigns.ts'

/** Đợt đang mở của biến thể, các trường chụp vào đơn đặt trước. */
export type OpenCampaign = {
  id: string
  depositPercent: number
  deliveryFrom: Date
  deliveryTo: Date
  remainderDays: number
}

export type PreorderCheck = {
  /** Biến thể như khách thấy (phiên bản đang xuất bản); `variant` là `null` khi không còn bán. */
  found: CartVariant
  /** Đợt đang mở có biến thể này, kể cả khi đã hết suất; `null` khi không có. */
  campaign: OpenCampaign | null
  /** Lý do không đặt trước được `quantity` cái lúc này; `null` khi đặt được. */
  problem: Extract<PreorderChange['kind'], 'in_stock' | 'campaign' | 'sold_out' | 'discontinued'> | null
}

/**
 * Biến thể có đặt trước được `quantity` cái lúc này không (GLOSSARY "Đang nhận đặt trước"): còn bán, hết hàng sẵn, thuộc
 * đợt đang mở và còn đủ suất. Như `preorderOffers` nhưng cho một biến thể và một số lượng.
 *
 * `lock` dùng trong transaction đặt trước: khóa dòng biến thể rồi dòng suất `FOR UPDATE`, nên hai khách tranh suất cuối
 * chạy lần lượt, và sửa suất (ticket 02, khóa dòng suất) không chen vào giữa lúc kiểm và lúc tạo đơn.
 */
export async function checkPreorder(
  db: DbClient,
  variantId: string,
  quantity: number,
  { lock = false, now = new Date() }: { lock?: boolean; now?: Date } = {},
): Promise<PreorderCheck> {
  // Dòng biến thể rồi dòng suất, cùng thứ tự với mọi nơi khác khóa cả hai.
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

  // Còn một cái hàng sẵn là không đặt trước: khách mua ngay.
  if (live.available > 0) return { found, campaign, problem: 'in_stock' }
  if (!row || !campaign) return { found, campaign, problem: 'campaign' }
  const used = (await usedAllocations(db, [campaign.id])).get(campaign.id)?.get(variantId) ?? 0
  return { found, campaign, problem: used + quantity > row.allocation ? 'sold_out' : null }
}
