import { ErrorCode, type UnsuppliedPreview } from '@ecommerce/shared'
import type { Audit } from '../../core/audit/audited.ts'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { AppError } from '../../core/errors.ts'
import type { IOrderService } from '../order/index.ts'
import { DEPOSITED_PREORDER } from '../order/index.ts'
import { lockOrderForRefund, refundTotals } from '../refund/index.ts'
import { isCampaignOpen } from './preorder-campaign.query.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đợt đặt trước')

/**
 * The campaign's orders awaiting stock: deposited, processing, not fully arrived (`arrived_at` empty, partly arrived
 * included), in deposit order. Fully arrived or fully paid orders are excluded: their stock is here.
 */
const awaitingSupply = (campaignId: string) =>
  ({ ...DEPOSITED_PREORDER, preorderCampaignId: campaignId, arrivedAt: null }) satisfies Prisma.OrderWhereInput

/** Preview: which orders would be cancelled and how much each refunds (refundable now). Writes nothing. */
export async function previewUnsupplied(db: DbClient, campaignId: string): Promise<UnsuppliedPreview> {
  const campaign = await db.preorderCampaign.findUnique({ where: { id: campaignId }, select: { id: true } })
  if (!campaign) throw notFound()
  const orders = await db.order.findMany({
    where: awaitingSupply(campaignId),
    select: { id: true, code: true, recipientName: true },
    orderBy: [{ depositPaidAt: 'asc' }, { code: 'asc' }],
  })
  const rows = []
  for (const order of orders) {
    const { refundable } = await refundTotals(db, order.id)
    rows.push({ code: order.code, recipientName: order.recipientName, refundAmount: Number(refundable) })
  }
  return { orders: rows, refundTotal: rows.reduce((sum, r) => sum + r.refundAmount, 0) }
}

/**
 * A campaign that cannot be supplied (spec M6a): in one transaction, locks and closes the campaign if open, then
 * cancels each order awaiting stock with cause "không nhập được hàng" and a full refund, via the paid-order cancel
 * (each order gets its own audit, event and email). Partly held stock becomes regular stock, not reallocated within the
 * campaign. Rerunning with no orders left cancels nothing. Returns the cancelled order codes.
 */
export async function cancelUnsupplied(
  tx: Prisma.TransactionClient,
  orderService: Pick<IOrderService, 'cancelPaidInTransaction'>,
  audit: Audit,
  campaignId: string,
  staffId: string,
  note: string,
) {
  const [campaign] = await tx.$queryRaw<{ closedAt: Date | null; closesAt: Date }[]>`
    SELECT "closed_at" AS "closedAt", "closes_at" AS "closesAt"
    FROM "preorder_campaign" WHERE "id" = ${campaignId}::uuid FOR UPDATE`
  if (!campaign) throw notFound()
  // Close first: no one can pre-order into the campaign while its orders are being cancelled.
  const closing = isCampaignOpen(campaign)
  if (closing) await tx.preorderCampaign.update({ where: { id: campaignId }, data: { closedAt: new Date() } })

  const orders = await tx.order.findMany({
    where: awaitingSupply(campaignId),
    select: { id: true },
    orderBy: [{ depositPaidAt: 'asc' }, { code: 'asc' }],
  })
  const cancelled: number[] = []
  for (const { id } of orders) {
    // Lock the order before reading the refundable amount, so it matches what `cancelPaidInTransaction` rechecks under that
    // lock.
    await lockOrderForRefund(tx, id)
    const { refundable } = await refundTotals(tx, id)
    const code = await orderService.cancelPaidInTransaction(
      tx,
      audit,
      id,
      staffId,
      { cause: 'supply_failed', refundAmount: Number(refundable), note },
      { reallocate: false },
    )
    cancelled.push(code)
  }
  // Nothing changed (campaign closed, no orders left): no audit (CODING_STANDARDS "Ghi dữ liệu ở API quản trị").
  if (!closing && cancelled.length === 0) return cancelled
  await audit({
    action: 'preorder.campaign.cancel_unsupplied',
    entityType: 'preorder_campaign',
    entityId: campaignId,
    before: { closed: !closing },
    after: { closed: true, note, cancelledOrderCodes: cancelled },
  })
  return cancelled
}
