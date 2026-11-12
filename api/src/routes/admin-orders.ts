import { Router, type Request, type Response } from 'express'
import { AdminOrderQuery, HandoverRequest, type AdminOrder, type AdminOrderPage } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { pageWindow } from '../http/pagination.ts'
import { parse } from '../http/validation.ts'
import { loadAdminOrder } from '../orders/admin-order.ts'
import { assertCancellable, cancelInTransaction, cancelPaymentLink } from '../orders/cancel-order.ts'
import {
  deliverOrder,
  failDelivery,
  handOverOrder,
  prepareOrder,
  type FulfillmentAudit,
  type FulfillmentMail,
} from '../orders/fulfill-order.ts'
import { orderNotFound, parseOrderCode } from '../orders/orders.ts'
import type { PaymentGateway } from '../payments/gateway.ts'

/** Ô tìm kiếm: mã đơn đúng bằng, số điện thoại (nhận cả `+84`, dấu cách, chấm, gạch) hoặc email chứa chuỗi đã gõ. */
function searchWhere(q: string): Prisma.OrderWhereInput {
  const or: Prisma.OrderWhereInput[] = [{ email: { contains: q.toLowerCase() } }]
  const digits = q.replace(/[\s.-]/g, '').replace(/^\+?84(?=\d{9}$)/, '0')
  if (/^\d+$/.test(digits)) or.push({ phone: { contains: digits } })
  if (/^\d{1,9}$/.test(q)) or.push({ code: Number(q) })
  return { OR: or }
}

/** Đơn hàng ở trang quản trị: xem cần `order.view`, xử lý đơn cần `order.fulfill`. */
export function adminOrderRoutes(prisma: Db, storage: Storage, payments: PaymentGateway, mail: FulfillmentMail) {
  const findOrder = async (code: string) => {
    const order = await prisma.order.findUnique({
      where: { code: parseOrderCode(code) },
      select: { id: true, code: true, gatewayReference: true },
    })
    if (!order) throw orderNotFound()
    return order
  }

  /** Route chuyển trạng thái giao hàng: chạy trong `audited()`, ghi bản audit hàm trả về, trả lại chi tiết đơn. */
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
      const body: AdminOrder = await loadAdminOrder(prisma, storage, code)
      res.json(body)
    }

  return Router()
    .get('/', requirePermission('order.view'), async (req, res) => {
      const query = parse(AdminOrderQuery, req.query)
      const where: Prisma.OrderWhereInput = {
        ...(query.status !== 'all' && { status: query.status }),
        ...(query.paymentStatus !== 'all' && { paymentStatus: query.paymentStatus }),
        ...(query.fulfillmentStatus !== 'all' && { fulfillmentStatus: query.fulfillmentStatus }),
        ...(query.q && searchWhere(query.q)),
      }
      const direction = query.sort === 'oldest' ? 'asc' : 'desc'
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          include: { lines: { select: { quantity: true } } },
          // Mã đơn tăng theo thời điểm đặt, nên sắp theo mã là sắp theo lúc đặt mà vẫn ổn định.
          orderBy: { code: direction },
          ...pageWindow(query),
        }),
        prisma.order.count({ where }),
      ])
      const body: AdminOrderPage = {
        items: orders.map((order) => ({
          code: order.code,
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
      const body: AdminOrder = await loadAdminOrder(prisma, storage, String(req.params.code))
      res.json(body)
    })
    .post('/:code/cancel', requirePermission('order.fulfill'), async (req, res) => {
      const code = String(req.params.code)
      const order = await findOrder(code)

      // Khách gọi điện báo thôi: nhân viên hủy hộ, cùng hàm với hết hạn và khách tự hủy, audit trong cùng transaction.
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
      if (outcome === 'cancelled') await cancelPaymentLink({ payments, logger: req.log }, order)
      // Đơn đã hủy từ trước cũng trả đơn hiện tại, không ghi gì.
      const body: AdminOrder = await loadAdminOrder(prisma, storage, code)
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
}
