import { ErrorCode, type AdminOrder, type OrderHistoryActor, type OrderHistoryEntry } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { ACTOR_SELECT } from '../audit/audited.ts'
import type { DbClient } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { ORDER_VIEW_INCLUDE, toPublicOrder } from './orders.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/**
 * Chi tiết đơn cho trang quản trị theo mã (chuỗi từ URL). Route xử lý đơn (chuẩn bị, bàn giao, đã giao…) trả lại đúng
 * dạng này sau khi đổi trạng thái, để trang chi tiết thay đơn đang hiện bằng response.
 */
export async function loadAdminOrder(db: DbClient, storage: Storage, code: string): Promise<AdminOrder> {
  if (!/^\d{1,9}$/.test(code)) throw notFound()
  const order = await db.order.findUnique({
    where: { code: Number(code) },
    include: {
      ...ORDER_VIEW_INCLUDE,
      paymentTransactions: { include: { reconciliationItem: true }, orderBy: { createdAt: 'asc' } },
      events: {
        include: { staff: { select: ACTOR_SELECT }, customer: { select: { id: true, email: true } } },
        orderBy: { seq: 'asc' },
      },
    },
  })
  if (!order) throw notFound()
  const audits = await db.auditLog.findMany({
    where: { entityType: 'order', entityId: order.id },
    include: { actor: { select: ACTOR_SELECT } },
    orderBy: { seq: 'asc' },
  })

  const eventActor = (event: (typeof order.events)[number]): OrderHistoryActor => {
    if (event.actor === 'staff') return { type: 'staff', ...event.staff! }
    if (event.actor === 'customer')
      return { type: 'customer', id: event.customer?.id ?? null, email: event.customer?.email ?? null }
    return { type: 'system' }
  }
  const history: OrderHistoryEntry[] = [
    ...order.events.map((event) => ({
      source: 'event' as const,
      action: event.kind,
      actor: eventActor(event),
      data: event.data,
      at: event.createdAt.toISOString(),
    })),
    ...audits.map((audit) => ({
      source: 'audit' as const,
      action: audit.action,
      actor: { type: 'staff' as const, ...audit.actor },
      data: { before: audit.before, after: audit.after },
      at: audit.createdAt.toISOString(),
    })),
  ]
  // Sự kiện và audit của cùng một thao tác ghi trong một transaction nên trùng thời điểm: sắp ổn định, sự kiện trước.
  history.sort((a, b) => a.at.localeCompare(b.at))

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
        reason: t.reconciliationItem.reason,
        status: t.reconciliationItem.status,
      },
    })),
    history,
  }
}
