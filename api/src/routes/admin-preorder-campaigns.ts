import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  PreorderCampaignCreate,
  PreorderCampaignQuery,
  PreorderCampaignUpdate,
  type FieldError,
  type PreorderCampaign,
  type PreorderCampaignPage,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db, DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { pageWindow } from '../http/pagination.ts'
import { parse } from '../http/validation.ts'
import {
  CAMPAIGN_INCLUDE,
  isCampaignOpen,
  loadCampaign,
  openCampaignWhere,
  toCampaignHeader,
  toCampaignVariants,
  usedAllocations,
} from '../preorders/campaigns.ts'

const CampaignParams = z.object({ id: z.uuid() })

const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)
const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đợt đặt trước')

/**
 * Biến thể thêm vào đợt phải thuộc sản phẩm của đợt và đang bán. Biến thể đã có trong đợt từ trước thì không kiểm lại:
 * ngừng bán sau khi mở đợt chỉ làm biến thể đó ngừng nhận đặt (ticket 03).
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

const day = (date: Date) => date.toISOString().slice(0, 10)

/**
 * Đợt đặt trước, mount tại `/preorder-campaigns`. Xem cần `order.view`; mở, sửa, đóng cần `preorder.manage`.
 * Không có endpoint xóa: đợt đã mở là lời hẹn với khách, chỉ đóng được.
 */
export function adminPreorderCampaignRoutes(prisma: Db) {
  return Router()
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
      const used = await usedAllocations(
        prisma,
        campaigns.map((c) => c.id),
      )
      const body: PreorderCampaignPage = {
        items: campaigns.map((campaign) => {
          const variants = toCampaignVariants(campaign, used.get(campaign.id))
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
        // Khóa sản phẩm: hai người cùng mở đợt cho một sản phẩm thì người sau thấy đợt của người trước.
        const [product] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status" FROM "product" WHERE "id" = ${input.productId}::uuid FOR UPDATE`
        if (!product) throw invalidField('productId', 'Không tìm thấy sản phẩm')
        if (product.status !== 'published') throw conflict('Chỉ mở đợt đặt trước cho sản phẩm đã xuất bản')
        if (await tx.preorderCampaign.findFirst({ where: { productId: input.productId, ...openCampaignWhere(now) } })) {
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
        // Khóa đợt rồi các dòng suất, theo thứ tự biến thể: đặt trước (ticket 04) khóa dòng suất khi kiểm còn suất.
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
        /** Ghi nhận một trường đổi vào before/after; trả `false` khi không gửi hoặc giữ nguyên giá trị. */
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
        const deliveryFrom = input.deliveryFrom ?? day(campaign.deliveryFrom)
        const deliveryTo = input.deliveryTo ?? day(campaign.deliveryTo)
        if (deliveryFrom > deliveryTo) throw invalidField('deliveryTo', 'Ngày giao muộn nhất phải sau ngày sớm nhất')
        if (change('deliveryFrom', day(campaign.deliveryFrom), input.deliveryFrom)) {
          data.deliveryFrom = new Date(deliveryFrom)
        }
        if (change('deliveryTo', day(campaign.deliveryTo), input.deliveryTo)) data.deliveryTo = new Date(deliveryTo)
        const closesAt = input.closesAt && new Date(input.closesAt).toISOString()
        if (change('closesAt', campaign.closesAt.toISOString(), closesAt)) {
          // Đổi hạn của đợt đã đóng là mở lại đợt, ngoài phạm vi M4.
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
            [...m].sort(([a], [b]) => a.localeCompare(b)).map(([variantId, allocation]) => ({ variantId, allocation }))
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

        // Không đổi gì thì không ghi gì, kể cả audit.
        if (Object.keys(after).length === 0) return
        await tx.preorderCampaign.update({ where: { id }, data })
        for (const write of variantWrites) await write()
        await audit({
          action: 'preorder.campaign.update',
          entityType: 'preorder_campaign',
          entityId: id,
          before,
          after,
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
        // Đã đóng (tay hay tới hạn) thì không làm gì.
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
}
