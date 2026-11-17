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
      refunds: {
        include: {
          createdBy: { select: ACTOR_SELECT },
          executedBy: { select: ACTOR_SELECT },
          settledBy: { select: ACTOR_SELECT },
          retriedBy: { select: { id: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  })
  if (!order) throw orderNotFound()

  // ADR 0014: đã nhận tính từ giao dịch, đã hoàn và đang hoàn tính từ các khoản hoàn; trạng thái thanh toán không đổi.
  const received = order.paymentTransactions.reduce((sum, t) => sum + Number(t.amount), 0)
  const sumRefunds = (...statuses: string[]) =>
    order.refunds.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + Number(r.amount), 0)
  const refunded = sumRefunds('succeeded')
  const refunding = sumRefunds('pending', 'processing')

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
    voucher:
      order.voucherId === null
        ? null
        : {
            id: order.voucherId,
            code: order.voucherCode!,
            kind: order.voucherKind!,
            amount: order.voucherAmount === null ? null : Number(order.voucherAmount),
            percent: order.voucherPercent,
            maxDiscount: order.voucherMaxDiscount === null ? null : Number(order.voucherMaxDiscount),
          },
    subtotalAfterDiscount: Number(order.subtotal - order.discount),
    payments: order.paymentTransactions.map((t) => ({
      id: t.id,
      purpose: t.purpose,
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
    received,
    refunded,
    refunding,
    refundable: received - refunded - refunding,
    refunds: order.refunds.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      origin: r.origin,
      status: r.status,
      method: r.method,
      reconciliationItemId: r.reconciliationItemId,
      retryOfId: r.retryOfId,
      retriedById: r.retriedBy?.id ?? null,
      paymentTransactionId: r.paymentTransactionId,
      bankReference: r.bankReference,
      transferredOn: r.transferredOn?.toISOString().slice(0, 10) ?? null,
      note: r.note,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      executedBy: r.executedBy,
      executedAt: r.executedAt?.toISOString() ?? null,
      settledBy: r.settledBy,
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    history,
  }
}
