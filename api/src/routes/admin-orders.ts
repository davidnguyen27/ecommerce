import { Router, type Request, type Response } from 'express'
import {
  AdminOrderQuery,
  CancelPaidOrderRequest,
  HandoverRequest,
  RedeliverRequest,
  ReturnToStockRequest,
  type AdminOrder,
  type AdminOrderPage,
} from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { pageWindow } from '../http/pagination.ts'
import { parse } from '../http/validation.ts'
import { loadAdminOrder } from '../orders/admin-order.ts'
import { assertCancellable, cancelInTransaction, cancelPaymentLinks } from '../orders/cancel-order.ts'
import { cancelPaidOrder } from '../orders/cancel-paid-order.ts'
import {
  deliverOrder,
  failDelivery,
  handOverOrder,
  prepareOrder,
  redeliverOrder,
  restockForRedelivery,
  returnToStock,
  type FulfillmentAudit,
  type FulfillmentMail,
} from '../orders/fulfill-order.ts'
import { orderNotFound, parseOrderCode } from '../orders/orders.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import { PAYMENT_LINK_REFERENCES } from '../payments/record-payment.ts'

/** Search box: exact order code, phone (accepts `+84`, spaces, dots, dashes) or email containing the text. */
function searchWhere(q: string): Prisma.OrderWhereInput {
  const or: Prisma.OrderWhereInput[] = [{ email: { contains: q.toLowerCase() } }]
  const digits = q.replace(/[\s.-]/g, '').replace(/^\+?84(?=\d{9}$)/, '0')
  if (/^\d+$/.test(digits)) or.push({ phone: { contains: digits } })
  if (/^\d{1,9}$/.test(q)) or.push({ code: Number(q) })
  return { OR: or }
}

/** Admin orders: viewing needs `order.view`, fulfillment `order.fulfill`. */
export function adminOrderRoutes(prisma: Db, storage: Storage, payments: PaymentGateway, mail: FulfillmentMail) {
  const findOrder = async (code: string) => {
    const order = await prisma.order.findUnique({
      where: { code: parseOrderCode(code) },
      select: { id: true, code: true, paymentLinks: PAYMENT_LINK_REFERENCES },
    })
    if (!order) throw orderNotFound()
    return order
  }

  /** Fulfillment transition route: runs in `audited()`, writes the returned audit entry, returns the order detail. */
  const transition =
    (
      run: (tx: Prisma.TransactionClient, orderId: string, staffId: string, req: Request) => Promise<FulfillmentAudit>,
    ) =>
    async (req: Request, res: Response) => {
      const code = String(req.params.code)
      const order = await findOrder(code)
      await audited(prisma, req, async (tx, audit) => {
        const entry = await run(tx, order.id, currentStaff(req).id, req)
        await audit({ ...entry, entityType: 'order', entityId: order.id })
      })
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, code)
      res.json(body)
    }

  return Router()
    .get('/', requirePermission('order.view'), async (req, res) => {
      const query = parse(AdminOrderQuery, req.query)
      const where: Prisma.OrderWhereInput = {
        ...(query.status !== 'all' && { status: query.status }),
        ...(query.paymentStatus !== 'all' && { paymentStatus: query.paymentStatus }),
        ...(query.fulfillmentStatus !== 'all' && { fulfillmentStatus: query.fulfillmentStatus }),
        ...(query.kind !== 'all' && { kind: query.kind }),
        ...(query.campaignId && { preorderCampaignId: query.campaignId }),
        // Remaining balance overdue: the flag means not fully paid yet (paying clears it, ticket 08).
        ...(query.remainderOverdue !== undefined && {
          remainderOverdueAt: query.remainderOverdue ? { not: null } : null,
        }),
        ...(query.q && searchWhere(query.q)),
        ...(query.voucherCode && { voucherCode: query.voucherCode.toUpperCase() }),
        ...(query.refund === 'open' && { refunds: { some: { status: { in: ['pending', 'processing'] } } } }),
      }
      const direction = query.sort === 'oldest' ? 'asc' : 'desc'
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          include: { lines: { select: { quantity: true } } },
          // Order codes grow with order time, so sorting by code sorts by time and stays stable.
          orderBy: { code: direction },
          ...pageWindow(query),
        }),
        prisma.order.count({ where }),
      ])
      const body: AdminOrderPage = {
        items: orders.map((order) => ({
          code: order.code,
          kind: order.kind,
          status: order.status,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          createdAt: order.createdAt.toISOString(),
          total: Number(order.total),
          itemCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
          recipientName: order.recipientName,
          phone: order.phone,
          email: order.email,
          provinceName: order.provinceName,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
      res.json(body)
    })
    .get('/:code', requirePermission('order.view'), async (req, res) => {
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, String(req.params.code))
      res.json(body)
    })
    .post('/:code/cancel', requirePermission('order.fulfill'), async (req, res) => {
      const code = String(req.params.code)
      const order = await findOrder(code)

      // The customer called to cancel: staff cancel for them, with the same function as expiry and self-cancel, audited
      // in the same transaction.
      const outcome = await audited(prisma, req, async (tx, audit) => {
        const result = await cancelInTransaction(tx, order.id, { reason: 'staff', staffId: currentStaff(req).id })
        if (result === 'cancelled') {
          await audit({
            action: 'order.cancel',
            entityType: 'order',
            entityId: order.id,
            before: { status: 'pending_payment' },
            after: { status: 'cancelled', cancelReason: 'staff' },
          })
        }
        return result
      })
      assertCancellable(outcome)
      if (outcome === 'cancelled') await cancelPaymentLinks({ payments, logger: req.log }, order)
      // Already cancelled: return the current order and write nothing.
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, code)
      res.json(body)
    })
    .post('/:code/cancel-paid', requirePermission('order.cancel_paid'), async (req, res) => {
      const input = parse(CancelPaidOrderRequest, req.body)
      const code = String(req.params.code)
      const order = await findOrder(code)
      const staffId = currentStaff(req).id
      await audited(prisma, req, (tx, audit) => cancelPaidOrder(tx, mail, audit, order.id, staffId, input))
      // Pre-orders may still have a remaining-balance link: cancel it after commit, as for unpaid cancels; money
      // arriving later needs reconciliation. Cancelling an in-stock order's already-paid link is harmless: errors are
      // only logged.
      await cancelPaymentLinks({ payments, logger: req.log }, order)
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, code)
      res.json(body)
    })
    .post(
      '/:code/prepare',
      requirePermission('order.fulfill'),
      transition((tx, orderId, staffId) => prepareOrder(tx, orderId, staffId)),
    )
    .post(
      '/:code/hand-over',
      requirePermission('order.fulfill'),
      transition((tx, orderId, staffId, req) =>
        handOverOrder(tx, mail, orderId, staffId, parse(HandoverRequest, req.body)),
      ),
    )
    .post(
      '/:code/deliver',
      requirePermission('order.fulfill'),
      transition((tx, orderId, staffId) => deliverOrder(tx, orderId, staffId)),
    )
    .post(
      '/:code/delivery-failed',
      requirePermission('order.fulfill'),
      transition((tx, orderId, staffId) => failDelivery(tx, mail.emails, orderId, staffId)),
    )
    .post(
      '/:code/redeliver',
      requirePermission('order.fulfill'),
      transition((tx, orderId, staffId, req) =>
        redeliverOrder(tx, orderId, staffId, parse(RedeliverRequest, req.body)),
      ),
    )
    .post(
      '/:code/return-to-stock',
      requirePermission('order.fulfill'),
      transition((tx, orderId, staffId, req) =>
        returnToStock(tx, orderId, staffId, parse(ReturnToStockRequest, req.body)),
      ),
    )
    .post(
      '/:code/restock-redeliver',
      requirePermission('order.fulfill'),
      transition((tx, orderId, staffId) => restockForRedelivery(tx, orderId, staffId)),
    )
}
