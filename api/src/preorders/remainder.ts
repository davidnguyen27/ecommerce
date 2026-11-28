import { ErrorCode, RESERVATION_MINUTES, type PayRemainderResult } from '@ecommerce/shared'
import type { Request } from 'express'
import { hashOpaqueToken, newOpaqueToken } from '../core/auth/opaque-token.ts'
import { createOrderPaymentLink } from '../payments/payment-link.ts'
import type { Db } from '../core/db.ts'
import { AppError, isUniqueViolation } from '../core/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../core/middleware/rate-limit.ts'
import { remainingOf } from '../modules/order/index.ts'
import type { PaymentGateway } from '../payments/gateway.ts'

const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)

/**
 * Creates a payment link for the remaining balance of a deposited, arrived pre-order (GLOSSARY "Phần còn lại"). Each
 * call makes a new link valid `RESERVATION_MINUTES`; expiry changes nothing on the order. Locks the order like payment
 * recording, so a just-paid order gets no link. Rate-limited per IP first, since each call hits the gateway.
 * `issueToken`: also issue a lookup token so the browser can open the result page (for customers coming from the account).
 */
export async function createRemainderLink(
  prisma: Db,
  deps: { payments: PaymentGateway; siteUrl: string; req: Request },
  orderId: string,
  { issueToken = false }: { issueToken?: boolean } = {},
): Promise<PayRemainderResult> {
  await enforceRateLimits(
    prisma,
    [{ limit: RATE_LIMITS.payRemainderPerIp, subject: String(deps.req.ip) }],
    'Bạn đã tạo quá nhiều lần thanh toán, vui lòng thử lại sau',
  )
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "order" WHERE "id" = ${orderId}::uuid FOR UPDATE`
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } })
        if (order.kind !== 'preorder' || order.status !== 'processing' || order.paymentStatus !== 'deposit_paid') {
          throw conflict('Đơn này không có phần còn lại cần trả')
        }
        if (!order.arrivedAt) throw conflict('Hàng chưa về đủ, chưa trả phần còn lại được')

        const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60_000)
        const checkoutUrl = await createOrderPaymentLink(
          tx,
          { ...deps, clientIp: deps.req.ip, log: deps.req.log },
          order,
          {
            purpose: 'remainder',
            amount: Number(remainingOf(order)),
            description: `Thanh toán phần còn lại đơn hàng #${order.code}`,
            expiresAt,
          },
        )
        let token: string | null = null
        if (issueToken) {
          token = newOpaqueToken()
          await tx.orderLookupToken.create({ data: { orderId, tokenHash: hashOpaqueToken(token) } })
        }
        return { checkoutUrl, expiresAt: expiresAt.toISOString(), token }
      },
      // The gateway call runs inside the transaction, so allow more than the default 5 s.
      { timeout: 30_000, maxWait: 10_000 },
    )
  } catch (err) {
    // VNPAY transaction refs have one-second precision: two clicks in a second collide.
    if (isUniqueViolation(err)) throw conflict('Vừa tạo link thanh toán, vui lòng thử lại sau vài giây')
    throw err
  }
}
