import { Router } from 'express'
import type { PayRemainderResult, PublicOrder } from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { RATE_LIMITS, withinRateLimit } from '../core/middleware/rate-limit.ts'
import { createRemainderLink } from '../preorders/remainder.ts'
import { assertCancellable, cancelOrder } from '../orders/cancel-order.ts'
import { findOrderByToken, toPublicOrder } from '../orders/orders.ts'
import { recordGatewayPayments } from '../payments/record-payment.ts'

/**
 * Orders via a lookup token link, no sign-in. The token allows viewing, cancelling unpaid orders and paying the
 * remainder.
 */
export function publicOrderRoutes({ prisma, storage, emails, siteUrl, payments, logger }: AppDeps) {
  const tokenOf = (query: Record<string, unknown>) => (typeof query.token === 'string' ? query.token : undefined)

  return (
    Router()
      .get('/:code', async (req, res) => {
        const token = tokenOf(req.query)
        const code = String(req.params.code)
        let order = await findOrderByToken(prisma, code, token)

        // Payment result page: ask the gateway for payments, in case the callback is late or missing.
        // Over the limit the customer still sees the order; only the gateway query is skipped.
        if (
          req.query.refresh === '1' &&
          (await withinRateLimit(prisma, RATE_LIMITS.paymentRefreshPerOrder, String(order.code)))
        ) {
          try {
            await recordGatewayPayments({ prisma, emails, siteUrl, payments }, order)
            order = await findOrderByToken(prisma, code, token)
          } catch (err) {
            // On gateway errors the customer still sees the order as is; the callback or a reload will record it.
            req.log.error({ err, orderCode: order.code }, 'Không truy vấn được cổng thanh toán')
          }
        }

        const body: PublicOrder = toPublicOrder(storage, order)
        // Personal data: no proxy or browser caching.
        res.set('Cache-Control', 'no-store').json(body)
      })
      // Arrived pre-orders: remaining-balance link. Link holders can pay, as they can cancel unpaid orders.
      .post('/:code/pay-remainder', async (req, res) => {
        const order = await findOrderByToken(prisma, String(req.params.code), tokenOf(req.query))
        const body: PayRemainderResult = await createRemainderLink(prisma, { payments, siteUrl, req }, order.id)
        res.set('Cache-Control', 'no-store').json(body)
      })
      .post('/:code/cancel', async (req, res) => {
        const token = tokenOf(req.query)
        const code = String(req.params.code)
        const order = await findOrderByToken(prisma, code, token)
        // The link holder is not always the buyer, so the event is tied to no customer account.
        assertCancellable(await cancelOrder({ prisma, payments, logger }, order.id, { reason: 'customer' }))

        const body: PublicOrder = toPublicOrder(storage, await findOrderByToken(prisma, code, token))
        res.set('Cache-Control', 'no-store').json(body)
      })
  )
}
