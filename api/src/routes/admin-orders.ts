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
import type { Storage } from '../core/adapters/storage.ts'
import { audited, type AuditedRun } from '../core/audit/audited.ts'
import { currentStaff, requirePermission } from '../core/middleware/staff-context.ts'
import type { Db } from '../core/db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { parse } from '../core/middleware/validation.ts'
import { listAdminOrders, loadAdminOrder } from '../orders/admin-order.ts'
import { cancelOrderByStaff } from '../orders/cancel-order.ts'
import { cancelPaidOrderByStaff } from '../orders/cancel-paid-order.ts'
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
import { contextOf } from '../core/context/request-context.ts'

/** Admin orders: viewing needs `order.view`, fulfillment `order.fulfill`. */
export function adminOrderRoutes(prisma: Db, storage: Storage, payments: PaymentGateway, mail: FulfillmentMail) {
  const findOrder = async (code: string) => {
    const order = await prisma.order.findUnique({
      where: { code: parseOrderCode(code) },
      select: { id: true },
    })
    if (!order) throw orderNotFound()
    return order
  }
  const auditedRun =
    (req: Request): AuditedRun =>
    (fn) =>
      audited(prisma, contextOf(req), fn)
  const cancelDeps = (req: Request) => ({ prisma, payments, logger: req.log })

  /** Fulfillment transition route: runs in `audited()`, writes the returned audit entry, returns the order detail. */
  const transition =
    (
      run: (tx: Prisma.TransactionClient, orderId: string, staffId: string, req: Request) => Promise<FulfillmentAudit>,
    ) =>
    async (req: Request, res: Response) => {
      const code = String(req.params.code)
      const order = await findOrder(code)
      await audited(prisma, contextOf(req), async (tx, audit) => {
        const entry = await run(tx, order.id, currentStaff(req).id, req)
        await audit({ ...entry, entityType: 'order', entityId: order.id })
      })
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, code)
      res.json(body)
    }

  return Router()
    .get('/', requirePermission('order.view'), async (req, res) => {
      const body: AdminOrderPage = await listAdminOrders(prisma, parse(AdminOrderQuery, req.query))
      res.json(body)
    })
    .get('/:code', requirePermission('order.view'), async (req, res) => {
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, String(req.params.code))
      res.json(body)
    })
    .post('/:code/cancel', requirePermission('order.fulfill'), async (req, res) => {
      const code = String(req.params.code)
      const order = await findOrder(code)
      // Already cancelled: returns the current order and writes nothing.
      await cancelOrderByStaff(cancelDeps(req), auditedRun(req), order.id, currentStaff(req).id)
      const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, code)
      res.json(body)
    })
    .post('/:code/cancel-paid', requirePermission('order.cancel_paid'), async (req, res) => {
      const input = parse(CancelPaidOrderRequest, req.body)
      const code = String(req.params.code)
      const order = await findOrder(code)
      await cancelPaidOrderByStaff(
        { ...cancelDeps(req), ...mail },
        auditedRun(req),
        order.id,
        currentStaff(req).id,
        input,
      )
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
