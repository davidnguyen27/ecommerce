import { ErrorCode, PreorderCampaignCreate, PreorderCampaignUpdate, type FieldError } from '@ecommerce/shared'
import type { z } from 'zod'
import type { Audit } from '../../core/audit/audited.ts'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { AppError, invalidField } from '../../core/errors.ts'
import type { CustomerMail } from '../../core/jobs/queues.ts'
import { isoDay } from '../../core/utils/format.ts'
import { isCampaignOpen, openCampaignWhere, usedAllocations } from './preorder-campaign.query.ts'
import { notifyDeliveryChange } from './preorder-delivery.ts'

// Admin pre-order campaign writes (GLOSSARY "Đợt đặt trước"), run inside `audited()`. The route reloads the campaign
// with `loadCampaign` for the response.

type Tx = Prisma.TransactionClient

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
 * Opens a campaign for a published product; at most one open campaign per product (the product row lock makes a second
 * opener see the first). Returns its id.
 */
export async function openCampaign(
  tx: Tx,
  audit: Audit,
  staffId: string,
  input: z.output<typeof PreorderCampaignCreate>,
  now: Date,
): Promise<string> {
  mustBeFuture(input.closesAt, now)
  // Lock the product: of two people opening a campaign for one product, the second sees the first's campaign.
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
      createdById: staffId,
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
}

/**
 * Edits a campaign; only fields that changed are written and audited, nothing changed writes nothing. Locks the
 * campaign, then its allocation rows by variant. With orders, deposit percent and remainder days are locked, allocations
 * stay at or above used, and ordered variants stay. A delivery change emails deposited customers awaiting stock.
 */
export async function updateCampaign(
  tx: Tx,
  audit: Audit,
  mail: CustomerMail,
  staffId: string,
  id: string,
  input: z.output<typeof PreorderCampaignUpdate>,
  now: Date,
): Promise<void> {
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
  const hasOrders = (await tx.order.count({ where: { preorderCampaignId: id, status: { not: 'cancelled' } } })) > 0

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
  if (change('deliveryTo', isoDay(campaign.deliveryTo), input.deliveryTo)) data.deliveryTo = new Date(deliveryTo)
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
          staffId: staffId,
        })
      : 0
  await audit({
    action: 'preorder.campaign.update',
    entityType: 'preorder_campaign',
    entityId: id,
    before,
    after: notified > 0 ? { ...after, notifiedOrders: notified } : after,
  })
}

/** Closes a campaign now; already closed (by hand or by time) does nothing. */
export async function closeCampaign(tx: Tx, audit: Audit, id: string): Promise<void> {
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
}
