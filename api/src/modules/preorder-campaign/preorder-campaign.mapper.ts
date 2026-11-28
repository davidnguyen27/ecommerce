import type { PreorderAttention, PreorderCampaignPage } from '@ecommerce/shared'
import { remainingOf } from '../order/index.ts'
import { toCampaignHeader, toCampaignVariants, type VariantStats } from './preorder-campaign.query.ts'
import type { IssueCampaignRow, OverdueOrderRow } from './preorder-campaign.repository.ts'

type CampaignRow = Parameters<typeof toCampaignVariants>[0] & Parameters<typeof toCampaignHeader>[0]

export function toCampaignSummary(
  campaign: CampaignRow,
  stats: Map<string, VariantStats> | undefined,
  now: Date,
): PreorderCampaignPage['items'][number] {
  const variants = toCampaignVariants(campaign, stats)
  return {
    ...toCampaignHeader(campaign, now),
    variantCount: variants.length,
    totalAllocation: variants.reduce((sum, v) => sum + v.allocation, 0),
    totalUsed: variants.reduce((sum, v) => sum + v.used, 0),
  }
}

export function toAttention(overdue: OverdueOrderRow[], issues: IssueCampaignRow[]): PreorderAttention {
  return {
    overdueOrders: overdue.map((order) => ({
      code: order.code,
      recipientName: order.recipientName,
      phone: order.phone,
      productName: order.lines[0]!.productName,
      remainingAmount: Number(remainingOf(order)),
      remainderDueAt: order.remainderDueAt!.toISOString(),
      remainderOverdueAt: order.remainderOverdueAt!.toISOString(),
    })),
    issueCampaigns: issues.map((campaign) => ({
      id: campaign.id,
      productName: campaign.product.name,
      supplyNote: campaign.supplyNote,
      depositedOrders: campaign._count.orders,
    })),
    total: overdue.length + issues.length,
  }
}
