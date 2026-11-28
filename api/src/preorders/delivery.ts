import type { DbClient } from '../core/db.ts'
import type { EmailQueue } from '../core/jobs/jobs.ts'
import { dayVN } from '../orders/format.ts'
import { DEPOSITED_PREORDER, issueOrderLookupUrl, recordOrderEvent } from '../orders/orders.ts'

/** Expected delivery, `YYYY-MM-DD`. */
export type DeliveryWindow = { from: string; to: string }

const windowText = ({ from, to }: DeliveryWindow) => `${dayVN(from)} – ${dayVN(to)}`

/**
 * Staff changed the campaign's expected delivery (ticket 09): emails every deposited customer whose stock has not fully
 * arrived, in the campaign edit's transaction (a rollback sends nothing). Orders keep their original promise; the order
 * page also shows the campaign's current dates. Pending-deposit, arrived and cancelled orders get no email. Returns the
 * number of orders notified.
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
    // Draft, awaiting the owner's approval of the wording.
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
