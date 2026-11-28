import type { ReconciliationPage } from '@ecommerce/shared'
import type { ReconciliationRow } from './reconciliation.repository.ts'

export function toReconciliationItem(item: ReconciliationRow, received: number): ReconciliationPage['items'][number] {
  return {
    id: item.id,
    reason: item.reason,
    status: item.status,
    resolution: item.resolution,
    note: item.note,
    resolvedBy: item.resolvedBy,
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    amount: Number(item.amount),
    receivedAt: item.receivedAt.toISOString(),
    reference: item.transaction.reference,
    source: item.transaction.source,
    createdAt: item.createdAt.toISOString(),
    order: {
      code: item.order.code,
      status: item.order.status,
      paymentStatus: item.order.paymentStatus,
      total: Number(item.order.total),
      received,
      recipientName: item.order.recipientName,
    },
  }
}
