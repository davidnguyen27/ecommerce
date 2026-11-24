import { Router } from 'express'
import { z } from 'zod'
import {
  CancelUnsuppliedRequest,
  ErrorCode,
  PreorderCampaignCreate,
  PreorderCampaignQuery,
  PreorderCampaignUpdate,
  type FieldError,
  type PreorderCampaign,
  type PreorderAttention,
  type PreorderCampaignPage,
  type CancelUnsuppliedResult,
  type UnsuppliedPreview,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db, DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { pageWindow } from '../http/pagination.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { isoDay } from '../orders/format.ts'
import { DEPOSITED_PREORDER, remainingOf } from '../orders/orders.ts'
import { parse } from '../http/validation.ts'
import {
  CAMPAIGN_INCLUDE,
  campaignStats,
  isCampaignOpen,
  loadCampaign,
  openCampaignWhere,
  toCampaignHeader,
  toCampaignVariants,
  usedAllocations,
} from '../preorders/campaigns.ts'
import { notifyDeliveryChange } from '../preorders/delivery.ts'
import { cancelUnsupplied, previewUnsupplied } from '../preorders/unsupplied.ts'

const CampaignParams = z.object({ id: z.uuid() })

const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)
const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đợt đặt trước')

/**
 * Variants added to a campaign must belong to its product and be on sale. Variants already in the campaign are not
 * rechecked: discontinuing one after opening only stops its pre-orders (ticket 03).
 */
async function checkNewVariants(
  db: DbClient,
  productId: string,
  variants: { variantId: string }[],
  existing: Set<string> = new Set(),
) {
  const ids = variants.map((v) => v.variantId).filter((id) => !existing.has(id))
  const found = await db.productVariant.findMany({
    where: { id: { in: ids } },
    select: { id: true, productId: true, status: true },
  })
  const byId = new Map(found.map((v) => [v.id, v]))
  const fields: FieldError[] = []
  variants.forEach(({ variantId }, index) => {
    if (existing.has(variantId)) return
    const variant = byId.get(variantId)
    const path = `variants.${index}.variantId`
    if (!variant || variant.productId !== productId) fields.push({ path, message: 'Biến thể không thuộc sản phẩm này' })
    else if (variant.status !== 'active') fields.push({ path, message: 'Biến thể đã ngừng bán' })
  })
  if (fields.length) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Đợt có biến thể không hợp lệ', fields)
}

const mustBeFuture = (closesAt: string, now: Date) => {
  if (new Date(closesAt) <= now) throw invalidField('closesAt', 'Hạn đóng phải ở tương lai')
}

/**
 * Pre-order campaigns, mounted at `/preorder-campaigns`. Viewing needs `order.view`; open, edit, close need
 * `preorder.manage`. No delete: an opened campaign is a promise to customers and can only be closed.
 */
export function adminPreorderCampaignRoutes(prisma: Db, mail: { emails: EmailQueue; siteUrl: string }) {
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
        const now = new Date()
        mustBeFuture(input.closesAt, now)

        const id = await audited(prisma, req, async (tx, audit) => {
          // Lock the product: of two people opening a campaign for one product, the second sees the first's campaign.
          const [product] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status" FROM "product" WHERE "id" = ${input.productId}::uuid FOR UPDATE`
          if (!product) throw invalidField('productId', 'Không tìm thấy sản phẩm')
          if (product.status !== 'published') throw conflict('Chỉ mở đợt đặt trước cho sản phẩm đã xuất bản')
          if (
            await tx.preorderCampaign.findFirst({ where: { productId: input.productId, ...openCampaignWhere(now) } })
          ) {
            throw conflict('Sản phẩm đã có một đợt đặt trước đang mở')
          }
          await checkNewVariants(tx, input.productId, input.variants)

          const campaign = await tx.preorderCampaign.create({
            data: {
              productId: input.productId,
              depositPercent: input.depositPercent,
              deliveryFrom: new Date(input.deliveryFrom),
              deliveryTo: new Date(input.deliveryTo),
              closesAt: new Date(input.closesAt),
              remainderDays: input.remainderDays,
              supplyStatus: input.supplyStatus,
              supplyNote: input.supplyNote,
              createdById: currentStaff(req).id,
              variants: { create: input.variants.map(({ variantId, allocation }) => ({ variantId, allocation })) },
            },
          })
          await audit({
            action: 'preorder.campaign.create',
            entityType: 'preorder_campaign',
            entityId: campaign.id,
            after: { ...input, closesAt: campaign.closesAt.toISOString() },
          })
          return campaign.id
        })
        const body: PreorderCampaign = await loadCampaign(prisma, id)
        res.status(201).json(body)
      })
      .patch('/:id', requirePermission('preorder.manage'), async (req, res) => {
        const { id } = parse(CampaignParams, req.params)
        const input = parse(PreorderCampaignUpdate, req.body)
        const now = new Date()

        await audited(prisma, req, async (tx, audit) => {
          // Lock the campaign, then its allocation rows in variant order: pre-ordering (ticket 04) locks allocation
          // rows too.
          const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "preorder_campaign" WHERE "id" = ${id}::uuid FOR UPDATE`
          if (!locked) throw notFound()
          await tx.$queryRaw`
          SELECT 1 FROM "preorder_campaign_variant" WHERE "campaign_id" = ${id}::uuid ORDER BY "variant_id" FOR UPDATE`
          const campaign = await tx.preorderCampaign.findUniqueOrThrow({
            where: { id },
            include: { variants: { include: { variant: { select: { sku: true } } } } },
          })
          const used = (await usedAllocations(tx, [id])).get(id) ?? new Map<string, number>()
          const hasOrders =
            (await tx.order.count({ where: { preorderCampaignId: id, status: { not: 'cancelled' } } })) > 0

          const before: Record<string, Prisma.InputJsonValue> = {}
          const after: Record<string, Prisma.InputJsonValue> = {}
          const data: Prisma.PreorderCampaignUpdateInput = {}
          /** Records a changed field in before/after; `false` when not sent or unchanged. */
          const change = (key: string, from: Prisma.InputJsonValue, to: Prisma.InputJsonValue | undefined) => {
            if (to === undefined || JSON.stringify(from) === JSON.stringify(to)) return false
            before[key] = from
            after[key] = to
            return true
          }

          if (change('depositPercent', campaign.depositPercent, input.depositPercent)) {
            if (hasOrders) throw conflict('Đợt đã có đơn, không đổi được mức cọc')
            data.depositPercent = input.depositPercent
          }
          if (change('remainderDays', campaign.remainderDays, input.remainderDays)) {
            if (hasOrders) throw conflict('Đợt đã có đơn, không đổi được số ngày trả phần còn lại')
            data.remainderDays = input.remainderDays
          }
          const deliveryFrom = input.deliveryFrom ?? isoDay(campaign.deliveryFrom)
          const deliveryTo = input.deliveryTo ?? isoDay(campaign.deliveryTo)
          if (deliveryFrom > deliveryTo) throw invalidField('deliveryTo', 'Ngày giao muộn nhất phải sau ngày sớm nhất')
          if (change('deliveryFrom', isoDay(campaign.deliveryFrom), input.deliveryFrom)) {
            data.deliveryFrom = new Date(deliveryFrom)
          }
          if (change('deliveryTo', isoDay(campaign.deliveryTo), input.deliveryTo))
            data.deliveryTo = new Date(deliveryTo)
          const closesAt = input.closesAt && new Date(input.closesAt).toISOString()
          if (change('closesAt', campaign.closesAt.toISOString(), closesAt)) {
            // Changing the closing time of a closed campaign would reopen it, out of M4 scope.
            if (!isCampaignOpen(campaign, now)) throw conflict('Đợt đã đóng, không đổi được hạn đóng')
            mustBeFuture(input.closesAt!, now)
            data.closesAt = new Date(input.closesAt!)
          }
          if (change('supplyStatus', campaign.supplyStatus, input.supplyStatus)) data.supplyStatus = input.supplyStatus
          if (change('supplyNote', campaign.supplyNote, input.supplyNote)) data.supplyNote = input.supplyNote

          let variantWrites: (() => Promise<unknown>)[] = []
          if (input.variants) {
            const current = new Map(campaign.variants.map((v) => [v.variantId, v.allocation]))
            const next = new Map(input.variants.map((v) => [v.variantId, v.allocation]))
            await checkNewVariants(tx, campaign.productId, input.variants, new Set(current.keys()))
            const fields: FieldError[] = []
            input.variants.forEach(({ variantId, allocation }, index) => {
              const taken = used.get(variantId) ?? 0
              if (allocation < taken) {
                fields.push({
                  path: `variants.${index}.allocation`,
                  message: `Đã đặt ${taken}, suất không thấp hơn được`,
                })
              }
            })
            for (const { variantId, variant } of campaign.variants) {
              if (!next.has(variantId) && (used.get(variantId) ?? 0) > 0) {
                fields.push({ path: 'variants', message: `${variant.sku} đã có đơn, không bỏ khỏi đợt được` })
              }
            }
            if (fields.length) throw new AppError(409, ErrorCode.CONFLICT, 'Không đổi được suất của đợt', fields)

            const sorted = (m: Map<string, number>) =>
              [...m]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([variantId, allocation]) => ({ variantId, allocation }))
            if (change('variants', sorted(current), sorted(next))) {
              const removed = [...current.keys()].filter((v) => !next.has(v))
              variantWrites = [
                () => tx.preorderCampaignVariant.deleteMany({ where: { campaignId: id, variantId: { in: removed } } }),
                ...[...next].map(
                  ([variantId, allocation]) =>
                    () =>
                      tx.preorderCampaignVariant.upsert({
                        where: { campaignId_variantId: { campaignId: id, variantId } },
                        create: { campaignId: id, variantId, allocation },
                        update: { allocation },
                      }),
                ),
              ]
            }
          }

          // Nothing changed: write nothing, audit included.
          if (Object.keys(after).length === 0) return
          await tx.preorderCampaign.update({ where: { id }, data })
          for (const write of variantWrites) await write()
          // A delivery change notifies deposited customers whose stock has not arrived; other changes send no email
          // (ticket 09).
          const notified =
            'deliveryFrom' in after || 'deliveryTo' in after
              ? await notifyDeliveryChange(tx, mail, id, {
                  before: { from: isoDay(campaign.deliveryFrom), to: isoDay(campaign.deliveryTo) },
                  after: { from: deliveryFrom, to: deliveryTo },
                  staffId: currentStaff(req).id,
                })
              : 0
          await audit({
            action: 'preorder.campaign.update',
            entityType: 'preorder_campaign',
            entityId: id,
            before,
            after: notified > 0 ? { ...after, notifiedOrders: notified } : after,
          })
        })
        const body: PreorderCampaign = await loadCampaign(prisma, id)
        res.json(body)
      })
      .post('/:id/close', requirePermission('preorder.manage'), async (req, res) => {
        const { id } = parse(CampaignParams, req.params)
        await audited(prisma, req, async (tx, audit) => {
          const [campaign] = await tx.$queryRaw<{ closedAt: Date | null; closesAt: Date }[]>`
          SELECT "closed_at" AS "closedAt", "closes_at" AS "closesAt"
          FROM "preorder_campaign" WHERE "id" = ${id}::uuid FOR UPDATE`
          if (!campaign) throw notFound()
          // Already closed (by hand or by time): do nothing.
          if (!isCampaignOpen(campaign)) return
          const closedAt = new Date()
          await tx.preorderCampaign.update({ where: { id }, data: { closedAt } })
          await audit({
            action: 'preorder.campaign.close',
            entityType: 'preorder_campaign',
            entityId: id,
            after: { closedAt: closedAt.toISOString() },
          })
        })
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
          const cancelledOrderCodes = await audited(prisma, req, (tx, audit) =>
            cancelUnsupplied(tx, mail, audit, id, staffId, note),
          )
          const body: CancelUnsuppliedResult = { cancelledOrderCodes, campaign: await loadCampaign(prisma, id) }
          res.json(body)
        },
      )
  )
}
