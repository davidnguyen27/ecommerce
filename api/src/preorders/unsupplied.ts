import { ErrorCode, type UnsuppliedPreview } from '@ecommerce/shared'
import type { Audit } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import type { CustomerMail } from '../jobs/jobs.ts'
import { cancelPaidOrder } from '../orders/cancel-paid-order.ts'
import { DEPOSITED_PREORDER } from '../orders/orders.ts'
import { lockOrderForRefund, refundTotals } from '../payments/refunds.ts'
import { isCampaignOpen } from './campaigns.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đợt đặt trước')

/**
 * Đơn chờ hàng của đợt: đã cọc, đang xử lý, chưa có hàng về đủ (`arrived_at` trống, kể cả đơn mới về một phần), theo
 * thứ tự cọc. Đơn đã về đủ hay đã trả đủ không thuộc nhóm này: hàng của họ đã có.
 */
const awaitingSupply = (campaignId: string) =>
  ({ ...DEPOSITED_PREORDER, preorderCampaignId: campaignId, arrivedAt: null }) satisfies Prisma.OrderWhereInput

/** Xem trước: đơn nào sẽ bị hủy và mỗi đơn hoàn bao nhiêu (số còn hoàn được lúc này). Không ghi gì. */
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
 * Đợt không nhập được hàng (spec M6a): trong một transaction, khóa đợt, đóng đợt nếu còn mở, rồi hủy từng đơn chờ hàng
 * với lý do "không nhập được hàng" và hoàn đủ, qua cùng hàm hủy đơn đã nhận tiền (mỗi đơn có audit, sự kiện, email
 * riêng). Phần hàng đã giữ một phần thành hàng sẵn, không chia cho đơn nào trong đợt. Gọi lại khi không còn đơn chờ
 * thì không hủy thêm gì. Trả mã các đơn vừa hủy.
 */
export async function cancelUnsupplied(
  tx: Prisma.TransactionClient,
  mail: CustomerMail,
  audit: Audit,
  campaignId: string,
  staffId: string,
  note: string,
) {
  const [campaign] = await tx.$queryRaw<{ closedAt: Date | null; closesAt: Date }[]>`
    SELECT "closed_at" AS "closedAt", "closes_at" AS "closesAt"
    FROM "preorder_campaign" WHERE "id" = ${campaignId}::uuid FOR UPDATE`
  if (!campaign) throw notFound()
  // Đóng trước: không khách nào đặt thêm vào đợt trong lúc các đơn đang bị hủy.
  const closing = isCampaignOpen(campaign)
  if (closing) await tx.preorderCampaign.update({ where: { id: campaignId }, data: { closedAt: new Date() } })

  const orders = await tx.order.findMany({
    where: awaitingSupply(campaignId),
    select: { id: true },
    orderBy: [{ depositPaidAt: 'asc' }, { code: 'asc' }],
  })
  const cancelled: number[] = []
  for (const { id } of orders) {
    // Khóa đơn trước khi đọc số còn hoàn được, để số hoàn đúng bằng số `cancelPaidOrder` kiểm lại dưới cùng khóa.
    await lockOrderForRefund(tx, id)
    const { refundable } = await refundTotals(tx, id)
    const code = await cancelPaidOrder(
      tx,
      mail,
      audit,
      id,
      staffId,
      { cause: 'supply_failed', refundAmount: Number(refundable), note },
      { reallocate: false },
    )
    cancelled.push(code)
  }
  // Không đổi gì (đợt đã đóng, không còn đơn chờ hàng) thì không ghi audit (CODING_STANDARDS "Ghi dữ liệu ở API quản trị").
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
