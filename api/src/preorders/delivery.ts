import type { DbClient } from '../db.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { dayVN } from '../orders/format.ts'
import { DEPOSITED_PREORDER, issueOrderLookupUrl, recordOrderEvent } from '../orders/orders.ts'

/** Thời gian giao dự kiến, `YYYY-MM-DD`. */
export type DeliveryWindow = { from: string; to: string }

const windowText = ({ from, to }: DeliveryWindow) => `${dayVN(from)} – ${dayVN(to)}`

/**
 * Nhân viên đổi thời gian giao dự kiến của đợt (ticket 09): báo mọi khách đã cọc mà hàng chưa về đủ, trong transaction
 * của lần sửa đợt (sửa rollback thì không có thư). Đơn giữ lời hẹn lúc đặt; trang đơn hiện thêm thời gian hiện tại của
 * đợt. Đơn chờ cọc, đơn đã về hàng hay đã hủy không nhận thư. Trả số đơn được báo.
 */
export async function notifyDeliveryChange(
  tx: DbClient,
  { emails, siteUrl }: { emails: EmailQueue; siteUrl: string },
  campaignId: string,
  change: { before: DeliveryWindow; after: DeliveryWindow; staffId: string },
) {
  const orders = await tx.order.findMany({
    where: {
      ...DEPOSITED_PREORDER,
      preorderCampaignId: campaignId,
      arrivedAt: null,
    },
    include: { lines: { orderBy: { position: 'asc' } } },
    orderBy: { depositPaidAt: 'asc' },
  })
  for (const order of orders) {
    await recordOrderEvent(
      tx,
      order.id,
      'delivery_changed',
      { type: 'staff', staffId: change.staffId },
      { before: change.before, after: change.after },
    )
    const link = await issueOrderLookupUrl(tx, siteUrl, order)
    const line = order.lines[0]!
    // Bản nháp, chờ chủ doanh nghiệp duyệt nội dung.
    await emails.sendEmail(tx, {
      to: order.email,
      subject: `Thời gian giao dự kiến của đơn đặt trước #${order.code} đã thay đổi`,
      text: [
        `Chào ${order.recipientName},`,
        '',
        `Thời gian giao dự kiến của đơn đặt trước #${order.code} (${line.productName} x ${line.quantity}) đã thay đổi:`,
        '',
        `Trước đây: ${windowText(change.before)}`,
        `Hiện tại: ${windowText(change.after)}`,
        '',
        'Chúng tôi sẽ báo bạn khi hàng về. Nếu cần trao đổi thêm, vui lòng liên hệ cửa hàng.',
        '',
        `Xem đơn hàng: ${link}`,
      ].join('\n'),
    })
  }
  return orders.length
}
