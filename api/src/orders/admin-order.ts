import { type AdminOrder, type OrderHistoryActor, type OrderHistoryEntry } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { ACTOR_SELECT } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import { ORDER_VIEW_INCLUDE, orderNotFound, parseOrderCode, toPublicOrder } from './orders.ts'

/**
 * Chi tiết đơn cho trang quản trị theo mã (chuỗi từ URL). Route xử lý đơn (chuẩn bị, bàn giao, đã giao…) trả lại đúng
 * dạng này sau khi đổi trạng thái, để trang chi tiết thay đơn đang hiện bằng response.
 */
export async function loadAdminOrder(db: DbClient, storage: Storage, code: string): Promise<AdminOrder> {
  const order = await db.order.findUnique({
    where: { code: parseOrderCode(code) },
    include: {
      ...ORDER_VIEW_INCLUDE,
      paymentTransactions: {
        include: { reconciliationItem: { include: { resolvedBy: { select: ACTOR_SELECT } } } },
        orderBy: { createdAt: 'asc' },
      },
      events: {
        include: { staff: { select: ACTOR_SELECT }, customer: { select: { id: true, email: true } } },
        orderBy: { seq: 'asc' },
      },
    },
  })
  if (!order) throw orderNotFound()

  const eventActor = (event: (typeof order.events)[number]): OrderHistoryActor => {
    if (event.actor === 'staff') return { type: 'staff', ...event.staff! }
    if (event.actor === 'customer')
      return { type: 'customer', id: event.customer?.id ?? null, email: event.customer?.email ?? null }
    return { type: 'system' }
  }
  // Chỉ sự kiện đơn: thao tác nào của nhân viên cũng ghi một sự kiện kèm người làm, audit của nó xem ở Nhật ký kiểm toán.
  const history: OrderHistoryEntry[] = order.events.map((event) => ({
    action: event.kind,
    actor: eventActor(event),
    data: event.data,
    at: event.createdAt.toISOString(),
  }))

  return {
    ...toPublicOrder(storage, order),
    customerId: order.customerId,
    payments: order.paymentTransactions.map((t) => ({
      id: t.id,
      amount: Number(t.amount),
      reference: t.reference,
      paidAt: t.paidAt.toISOString(),
      source: t.source,
      reconciliation: t.reconciliationItem && {
        id: t.reconciliationItem.id,
        reason: t.reconciliationItem.reason,
        status: t.reconciliationItem.status,
        resolution: t.reconciliationItem.resolution,
        note: t.reconciliationItem.note,
        resolvedBy: t.reconciliationItem.resolvedBy,
        resolvedAt: t.reconciliationItem.resolvedAt?.toISOString() ?? null,
      },
    })),
    history,
  }
}
