import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { IOrderService } from '../order/index.ts'
import { applyArrivals, planArrivals } from './preorder-arrival.ts'
import { PreorderCampaignController } from './preorder-campaign.controller.ts'
import type { IPreorderApi } from './preorder-campaign.interface.ts'
import { preorderOffers, usedAllocations } from './preorder-campaign.query.ts'
import { PreorderCampaignRepository } from './preorder-campaign.repository.ts'
import { PreorderCampaignRoute } from './preorder-campaign.route.ts'
import { PreorderCampaignService } from './preorder-campaign.service.ts'
import { checkPreorder } from './preorder-check.ts'
import { processRemainderDeadlines } from './preorder-deadline.ts'
import { createRemainderLink } from './preorder-remainder.ts'

/** Wires repository → service → controller → routes. */
export class PreorderCampaignModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(
    deps: Pick<AppDeps, 'prisma' | 'emails' | 'siteUrl'>,
    orders: Pick<IOrderService, 'cancelPaidInTransaction'>,
  ) {
    super()
    const mail = { emails: deps.emails, siteUrl: deps.siteUrl }
    const service = new PreorderCampaignService(deps.prisma, new PreorderCampaignRepository(), mail, orders)
    this.routes = [new PreorderCampaignRoute(new PreorderCampaignController(service))]
  }
}

/** The pre-order functions other code calls; stateless, each works in the `db` it is given. */
export const preorderApi: IPreorderApi = {
  planArrivals,
  applyArrivals,
  preorderOffers,
  usedAllocations,
  checkPreorder,
  createRemainderLink,
  processRemainderDeadlines,
}
