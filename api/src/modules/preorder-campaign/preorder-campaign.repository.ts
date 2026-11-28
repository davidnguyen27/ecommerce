import type { DbClient } from '../../core/db.ts'
import { pageWindow } from '../../core/pagination.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { DEPOSITED_PREORDER } from '../order/index.ts'
import { CAMPAIGN_INCLUDE } from './preorder-campaign.query.ts'

const ISSUE_CAMPAIGN_INCLUDE = {
  product: { select: { name: true } },
  _count: { select: { orders: { where: DEPOSITED_PREORDER } } },
} as const satisfies Prisma.PreorderCampaignInclude

export type IssueCampaignRow = Prisma.PreorderCampaignGetPayload<{ include: typeof ISSUE_CAMPAIGN_INCLUDE }>
export type OverdueOrderRow = Prisma.OrderGetPayload<{ include: { lines: true } }>

/** Campaign lists for the admin screens. Every method takes `db`. */
export class PreorderCampaignRepository {
  async page(db: DbClient, where: Prisma.PreorderCampaignWhereInput, window: { page: number; pageSize: number }) {
    const [campaigns, total] = await Promise.all([
      db.preorderCampaign.findMany({
        where,
        include: CAMPAIGN_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageWindow(window),
      }),
      db.preorderCampaign.count({ where }),
    ])
    return { campaigns, total }
  }

  /** Deposited pre-orders with an overdue remaining balance. */
  overdueOrders(db: DbClient): Promise<OverdueOrderRow[]> {
    return db.order.findMany({
      where: { ...DEPOSITED_PREORDER, remainderOverdueAt: { not: null } },
      include: { lines: { orderBy: { position: 'asc' } } },
      orderBy: [{ remainderDueAt: 'asc' }, { code: 'asc' }],
    })
  }

  /**
   * Campaigns with a supply problem that still have deposited orders not fully paid (arrived ones too: all customers
   * of a troubled campaign need contacting).
   */
  issueCampaigns(db: DbClient): Promise<IssueCampaignRow[]> {
    return db.preorderCampaign.findMany({
      where: { supplyStatus: 'issue', orders: { some: DEPOSITED_PREORDER } },
      include: ISSUE_CAMPAIGN_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  }
}
