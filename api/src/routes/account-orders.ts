import { Router } from 'express'
import { AccountOrderQuery, type AccountOrderPage, type PayRemainderResult, type PublicOrder } from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { authSubject } from '../core/middleware/require-auth.ts'
import { createRemainderLink } from '../preorders/remainder.ts'
import { assertCancellable, cancelOrder } from '../orders/cancel-order.ts'
import { pageWindow } from '../core/pagination.ts'
import { parse } from '../core/middleware/validation.ts'
import { findCustomerOrder, toPublicOrder } from '../orders/orders.ts'

/** Orders of the signed-in customer (`customer_id` is theirs); behind `requireAuth` for the customer audience. */
export function accountOrderRoutes({
  prisma,
  storage,
  payments,
  logger,
  siteUrl,
}: Pick<AppDeps, 'prisma' | 'storage' | 'payments' | 'logger' | 'siteUrl'>) {
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
            kind: order.kind,
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
      // Pay the remaining balance of your own pre-order; also issues a lookup token for the payment result page.
      .post('/:code/pay-remainder', async (req, res) => {
        const order = await findCustomerOrder(prisma, String(req.params.code), authSubject(req))
        const body: PayRemainderResult = await createRemainderLink(prisma, { payments, siteUrl, req }, order.id, {
          issueToken: true,
        })
        res.set('Cache-Control', 'no-store').json(body)
      })
      // The customer cancels their own unpaid order; someone else's order or an unknown code is 404.
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
