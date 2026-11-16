import { ErrorCode, RESERVATION_MINUTES, type PayRemainderResult } from '@ecommerce/shared'
import type { Request, Response } from 'express'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import { createOrderPaymentLink } from '../checkout/order-snapshot.ts'
import type { Db } from '../db.ts'
import { AppError, isUniqueViolation } from '../http/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { remainingOf } from '../orders/orders.ts'
import type { PaymentGateway } from '../payments/gateway.ts'

const conflict = (message: string) => new AppError(409, ErrorCode.CONFLICT, message)

/**
 * Tạo link trả phần còn lại của đơn đặt trước đã cọc và đã về hàng (GLOSSARY "Phần còn lại"). Mỗi lần gọi một link mới,
 * hạn `RESERVATION_MINUTES` phút; link hết hạn không đổi gì của đơn, khách gọi lại là có link khác. Khóa đơn `FOR UPDATE`
 * như ghi nhận thanh toán, nên không tạo link cho đơn vừa được trả đủ.
 *
 * Giới hạn tần suất theo IP trước khi làm gì (`payRemainderPerIp`): mỗi lần gọi tạo một link ở cổng.
 *
 * `issueToken`: cấp thêm token tra cứu (chỉ lưu hash) để trình duyệt mở được trang kết quả khi cổng đưa khách về; dùng
 * khi khách vào từ tài khoản, chưa có token của đơn.
 */
export async function createRemainderLink(
  prisma: Db,
  deps: { payments: PaymentGateway; siteUrl: string; req: Request; res: Response },
  orderId: string,
  { issueToken = false }: { issueToken?: boolean } = {},
): Promise<PayRemainderResult> {
  await enforceRateLimits(
    prisma,
    deps.res,
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
        const checkoutUrl = await createOrderPaymentLink(tx, deps, order, {
          purpose: 'remainder',
          amount: Number(remainingOf(order)),
          description: `Thanh toán phần còn lại đơn hàng #${order.code}`,
          expiresAt,
        })
        let token: string | null = null
        if (issueToken) {
          token = newOpaqueToken()
          await tx.orderLookupToken.create({ data: { orderId, tokenHash: hashOpaqueToken(token) } })
        }
        return { checkoutUrl, expiresAt: expiresAt.toISOString(), token }
      },
      // Gọi cổng thanh toán nằm trong transaction nên cần lâu hơn mặc định 5 giây.
      { timeout: 30_000, maxWait: 10_000 },
    )
  } catch (err) {
    // Mã giao dịch VNPAY chỉ phân biệt tới giây: hai lần bấm trong cùng một giây thì lần sau trùng mã link.
    if (isUniqueViolation(err)) throw conflict('Vừa tạo link thanh toán, vui lòng thử lại sau vài giây')
    throw err
  }
}
