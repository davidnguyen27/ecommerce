import { Router } from 'express'
import { AccountOrderQuery, type AccountOrderPage, type PublicOrder } from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { authSubject } from '../auth/require-auth.ts'
import { assertCancellable, cancelOrder } from '../orders/cancel-order.ts'
import { pageWindow } from '../http/pagination.ts'
import { parse } from '../http/validation.ts'
import { findCustomerOrder, toPublicOrder } from '../orders/orders.ts'

/** Đơn hàng của khách đang đăng nhập (đơn có `customer_id` là khách); đã đi qua `requireAuth` audience customer. */
export function accountOrderRoutes({
  prisma,
  storage,
  payments,
  logger,
}: Pick<AppDeps, 'prisma' | 'storage' | 'payments' | 'logger'>) {
  return (
    Router()
      .get('/', async (req, res) => {
        const query = parse(AccountOrderQuery, req.query)
        const where = { customerId: authSubject(req) }
        const [orders, total] = await Promise.all([
          prisma.order.findMany({
            where,
            include: { lines: { select: { quantity: true } } },
            orderBy: { code: 'desc' },
            ...pageWindow(query),
          }),
          prisma.order.count({ where }),
        ])
        const body: AccountOrderPage = {
          items: orders.map((order) => ({
            code: order.code,
            status: order.status,
            paymentStatus: order.paymentStatus,
            fulfillmentStatus: order.fulfillmentStatus,
            createdAt: order.createdAt.toISOString(),
            total: Number(order.total),
            itemCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
          })),
          total,
          page: query.page,
          pageSize: query.pageSize,
        }
        res.set('Cache-Control', 'no-store').json(body)
      })
      .get('/:code', async (req, res) => {
        const order = await findCustomerOrder(prisma, String(req.params.code), authSubject(req))
        const body: PublicOrder = toPublicOrder(storage, order)
        res.set('Cache-Control', 'no-store').json(body)
      })
      // Khách hủy đơn chưa thanh toán của chính mình; đơn người khác hay mã lạ đều là 404.
      .post('/:code/cancel', async (req, res) => {
        const customerId = authSubject(req)
        const code = String(req.params.code)
        const order = await findCustomerOrder(prisma, code, customerId)
        assertCancellable(await cancelOrder({ prisma, payments, logger }, order.id, { reason: 'customer', customerId }))
        const body: PublicOrder = toPublicOrder(storage, await findCustomerOrder(prisma, code, customerId))
        res.set('Cache-Control', 'no-store').json(body)
      })
  )
}
