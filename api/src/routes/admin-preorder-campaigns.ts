import { Router } from 'express'
import { z } from 'zod'
import {
  CancelUnsuppliedRequest,
  PreorderCampaignCreate,
  PreorderCampaignQuery,
  PreorderCampaignUpdate,
  type PreorderCampaign,
  type PreorderAttention,
  type PreorderCampaignPage,
  type CancelUnsuppliedResult,
  type UnsuppliedPreview,
} from '@ecommerce/shared'
import { audited } from '../core/audit/audited.ts'
import { currentStaff, requirePermission } from '../core/middleware/staff-context.ts'
import type { Db } from '../core/db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { pageWindow } from '../core/pagination.ts'
import type { CustomerMail } from '../core/jobs/jobs.ts'
import { DEPOSITED_PREORDER, remainingOf, type IOrderService } from '../modules/order/index.ts'
import { parse } from '../core/middleware/validation.ts'
import { closeCampaign, openCampaign, updateCampaign } from '../preorders/campaign-admin.ts'
import {
  CAMPAIGN_INCLUDE,
  campaignStats,
  loadCampaign,
  openCampaignWhere,
  toCampaignHeader,
  toCampaignVariants,
} from '../preorders/campaigns.ts'
import { cancelUnsupplied, previewUnsupplied } from '../preorders/unsupplied.ts'
import { contextOf } from '../core/context/request-context.ts'

const CampaignParams = z.object({ id: z.uuid() })

/**
 * Pre-order campaigns, mounted at `/preorder-campaigns`. Viewing needs `order.view`; open, edit, close need
 * `preorder.manage`. No delete: an opened campaign is a promise to customers and can only be closed.
 */
export function adminPreorderCampaignRoutes(
  prisma: Db,
  mail: CustomerMail,
  orders: Pick<IOrderService, 'cancelPaidInTransaction'>,
) {
  return (
    Router()
      .use(requirePermission('order.view', 'preorder.manage'))
      .get('/', async (req, res) => {
        const query = parse(PreorderCampaignQuery, req.query)
        const now = new Date()
        const where: Prisma.PreorderCampaignWhereInput = {
          ...(query.productId ? { productId: query.productId } : {}),
          ...(query.state === 'open'
            ? openCampaignWhere(now)
            : query.state === 'closed'
              ? { OR: [{ closedAt: { not: null } }, { closesAt: { lte: now } }] }
              : {}),
        }
        const [campaigns, total] = await Promise.all([
          prisma.preorderCampaign.findMany({
            where,
            include: CAMPAIGN_INCLUDE,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            ...pageWindow(query),
          }),
          prisma.preorderCampaign.count({ where }),
        ])
        const stats = await campaignStats(
          prisma,
          campaigns.map((c) => c.id),
        )
        const body: PreorderCampaignPage = {
          items: campaigns.map((campaign) => {
            const variants = toCampaignVariants(campaign, stats.get(campaign.id))
            return {
              ...toCampaignHeader(campaign, now),
              variantCount: variants.length,
              totalAllocation: variants.reduce((sum, v) => sum + v.allocation, 0),
              totalUsed: variants.reduce((sum, v) => sum + v.used, 0),
            }
          }),
          total,
          page: query.page,
          pageSize: query.pageSize,
        }
        res.json(body)
      })
      // Before `/:id`: "Đặt trước cần xử lý" (ticket 10). Orders with an overdue remaining balance, and campaigns with
      // a supply problem that still have deposited orders not fully paid.
      .get('/attention', requirePermission('order.view'), async (_req, res) => {
        const [overdue, issues] = await Promise.all([
          prisma.order.findMany({
            where: { ...DEPOSITED_PREORDER, remainderOverdueAt: { not: null } },
            include: { lines: { orderBy: { position: 'asc' } } },
            orderBy: [{ remainderDueAt: 'asc' }, { code: 'asc' }],
          }),
          prisma.preorderCampaign.findMany({
            // Every deposited order not fully paid, arrived ones too: all customers of a troubled campaign need
            // contacting.
            where: { supplyStatus: 'issue', orders: { some: DEPOSITED_PREORDER } },
            include: {
              product: { select: { name: true } },
              _count: { select: { orders: { where: DEPOSITED_PREORDER } } },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
        ])
        const body: PreorderAttention = {
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
        res.json(body)
      })
      .get('/:id', async (req, res) => {
        const { id } = parse(CampaignParams, req.params)
        const body: PreorderCampaign = await loadCampaign(prisma, id)
        res.json(body)
      })
      .post('/', requirePermission('preorder.manage'), async (req, res) => {
        const input = parse(PreorderCampaignCreate, req.body)
        const staffId = currentStaff(req).id
        const id = await audited(prisma, contextOf(req), (tx, audit) =>
          openCampaign(tx, audit, staffId, input, new Date()),
        )
        const body: PreorderCampaign = await loadCampaign(prisma, id)
        res.status(201).json(body)
      })
      .patch('/:id', requirePermission('preorder.manage'), async (req, res) => {
        const { id } = parse(CampaignParams, req.params)
        const input = parse(PreorderCampaignUpdate, req.body)
        const staffId = currentStaff(req).id
        await audited(prisma, contextOf(req), (tx, audit) =>
          updateCampaign(tx, audit, mail, staffId, id, input, new Date()),
        )
        const body: PreorderCampaign = await loadCampaign(prisma, id)
        res.json(body)
      })
      .post('/:id/close', requirePermission('preorder.manage'), async (req, res) => {
        const { id } = parse(CampaignParams, req.params)
        await audited(prisma, contextOf(req), (tx, audit) => closeCampaign(tx, audit, id))
        const body: PreorderCampaign = await loadCampaign(prisma, id)
        res.json(body)
      })
      .get('/:id/cancel-unsupplied', async (req, res) => {
        const { id } = parse(CampaignParams, req.params)
        const body: UnsuppliedPreview = await previewUnsupplied(prisma, id)
        res.json(body)
      })
      // Cancelling paid orders and closing the campaign are separate permissions: both are needed.
      .post(
        '/:id/cancel-unsupplied',
        requirePermission('order.cancel_paid'),
        requirePermission('preorder.manage'),
        async (req, res) => {
          const { id } = parse(CampaignParams, req.params)
          const { note } = parse(CancelUnsuppliedRequest, req.body)
          const staffId = currentStaff(req).id
          const cancelledOrderCodes = await audited(prisma, contextOf(req), (tx, audit) =>
            cancelUnsupplied(tx, orders, audit, id, staffId, note),
          )
          const body: CancelUnsuppliedResult = { cancelledOrderCodes, campaign: await loadCampaign(prisma, id) }
          res.json(body)
        },
      )
  )
}
