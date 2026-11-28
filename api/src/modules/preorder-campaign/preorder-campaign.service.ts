import type { PreorderCampaignCreate, PreorderCampaignQuery, PreorderCampaignUpdate } from '@ecommerce/shared'
import type { z } from 'zod'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import type { CustomerMail } from '../../core/jobs/jobs.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { IOrderService } from '../order/index.ts'
import { closeCampaign, openCampaign, updateCampaign } from './preorder-campaign.admin.ts'
import { toAttention, toCampaignSummary } from './preorder-campaign.mapper.ts'
import { campaignStats, loadCampaign, openCampaignWhere } from './preorder-campaign.query.ts'
import type { PreorderCampaignRepository } from './preorder-campaign.repository.ts'
import { cancelUnsupplied, previewUnsupplied } from './preorder-unsupplied.ts'

/**
 * Pre-order campaigns for staff: list, attention list, open, edit, close, and cancelling a campaign that cannot be
 * supplied. No delete: an opened campaign is a promise to customers and can only be closed.
 */
export class PreorderCampaignService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: PreorderCampaignRepository,
    private readonly mail: CustomerMail,
    private readonly orders: Pick<IOrderService, 'cancelPaidInTransaction'>,
  ) {}

  async list(query: z.output<typeof PreorderCampaignQuery>) {
    const now = new Date()
    const where: Prisma.PreorderCampaignWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.state === 'open'
        ? openCampaignWhere(now)
        : query.state === 'closed'
          ? { OR: [{ closedAt: { not: null } }, { closesAt: { lte: now } }] }
          : {}),
    }
    const { campaigns, total } = await this.repo.page(this.prisma, where, query)
    const stats = await campaignStats(
      this.prisma,
      campaigns.map((c) => c.id),
    )
    return { items: campaigns.map((c) => toCampaignSummary(c, stats.get(c.id), now)), total }
  }

  /** "Đặt trước cần xử lý" (ticket 10): overdue remaining balances, and campaigns with a supply problem. */
  async attention() {
    const [overdue, issues] = await Promise.all([
      this.repo.overdueOrders(this.prisma),
      this.repo.issueCampaigns(this.prisma),
    ])
    return toAttention(overdue, issues)
  }

  get(id: string) {
    return loadCampaign(this.prisma, id)
  }

  /** Returns the new campaign's id. */
  open(input: z.output<typeof PreorderCampaignCreate>, ctx: RequestContext) {
    return audited(this.prisma, ctx, (tx, audit) => openCampaign(tx, audit, ctx.staffId, input, new Date()))
  }

  async update(id: string, input: z.output<typeof PreorderCampaignUpdate>, ctx: RequestContext) {
    await audited(this.prisma, ctx, (tx, audit) =>
      updateCampaign(tx, audit, this.mail, ctx.staffId, id, input, new Date()),
    )
  }

  async close(id: string, ctx: RequestContext) {
    await audited(this.prisma, ctx, (tx, audit) => closeCampaign(tx, audit, id))
  }

  previewUnsupplied(id: string) {
    return previewUnsupplied(this.prisma, id)
  }

  /** Returns the cancelled order codes. */
  cancelUnsupplied(id: string, note: string, ctx: RequestContext) {
    return audited(this.prisma, ctx, (tx, audit) => cancelUnsupplied(tx, this.orders, audit, id, ctx.staffId, note))
  }
}
