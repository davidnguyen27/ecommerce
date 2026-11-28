import { Router } from 'express'
import {
  ReconciliationQuery,
  ResolveReconciliationRequest,
  type AdminOrder,
  type ReconciliationPage,
} from '@ecommerce/shared'
import type { Storage } from '../core/adapters/storage.ts'
import { ACTOR_SELECT, audited } from '../core/audit/audited.ts'
import { currentStaff, requirePermission } from '../core/middleware/staff-context.ts'
import type { Db } from '../core/db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { pageWindow } from '../core/pagination.ts'
import { parse } from '../core/middleware/validation.ts'
import type { EmailQueue } from '../core/jobs/jobs.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import { loadAdminOrder } from '../orders/admin-order.ts'
import { refundReconciliationItem, resolveExternally, restoreOrder } from '../payments/reconciliation.ts'

export type ReconciliationDeps = { emails: EmailQueue; siteUrl: string }

/**
 * Reconciliation: listing needs `order.view`; restoring an order, resolving by refund or closing an item needs
 * `payment.reconcile`.
 */
export function adminReconciliationRoutes(
  prisma: Db,
  storage: Storage,
  payments: PaymentGateway,
  deps: ReconciliationDeps,
) {
  return Router()
    .get('/', requirePermission('order.view'), async (req, res) => {
      const query = parse(ReconciliationQuery, req.query)
      const where: Prisma.ReconciliationItemWhereInput = query.status === 'all' ? {} : { status: query.status }
      const [items, total] = await Promise.all([
        prisma.reconciliationItem.findMany({
          where,
          include: {
            transaction: { select: { reference: true, source: true } },
            resolvedBy: { select: ACTOR_SELECT },
            order: {
              select: { id: true, code: true, status: true, paymentStatus: true, total: true, recipientName: true },
            },
          },
          // Oldest first: the longest-waiting money is handled first.
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          ...pageWindow(query),
        }),
        prisma.reconciliationItem.count({ where }),
      ])
      const sums = await prisma.paymentTransaction.groupBy({
        by: ['orderId'],
        where: { orderId: { in: [...new Set(items.map((i) => i.orderId))] } },
        _sum: { amount: true },
      })
      const received = new Map(sums.map((s) => [s.orderId, Number(s._sum.amount ?? 0n)]))
      const body: ReconciliationPage = {
        items: items.map((item) => ({
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
            received: received.get(item.orderId) ?? 0,
            recipientName: item.order.recipientName,
          },
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
      res.json(body)
    })
    .post('/:id/restore', requirePermission('payment.reconcile'), async (req, res) => {
      const staffId = currentStaff(req).id
      const code = await audited(prisma, req, (tx, audit) =>
        restoreOrder(tx, deps, audit, String(req.params.id), staffId),
      )
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, String(code))
      res.json(body)
    })
    .post('/:id/refund', requirePermission('payment.reconcile'), async (req, res) => {
      const staffId = currentStaff(req).id
      const code = await audited(prisma, req, (tx, audit) =>
        refundReconciliationItem(tx, audit, String(req.params.id), staffId),
      )
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, String(code))
      res.json(body)
    })
    .post('/:id/resolve', requirePermission('payment.reconcile'), async (req, res) => {
      const { note } = parse(ResolveReconciliationRequest, req.body)
      const staffId = currentStaff(req).id
      const code = await audited(prisma, req, (tx, audit) =>
        resolveExternally(tx, audit, String(req.params.id), staffId, note),
      )
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, String(code))
      res.json(body)
    })
}
