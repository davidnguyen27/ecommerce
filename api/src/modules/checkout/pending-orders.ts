import { ErrorCode } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import { AppError } from '../../core/errors.ts'

/** Max pending orders per email and per phone. Provisional, pending owner confirmation. */
export const MAX_PENDING_ORDERS_PER_CONTACT = 3

/**
 * Blocks malicious reservations: 429 when the email or phone already has `MAX_PENDING_ORDERS_PER_CONTACT` unexpired
 * pending orders; `retryAfter` is seconds until the earliest expires. Call inside the placement transaction.
 * `email` lowercase and `phone` as `0xxxxxxxxx`, as stored on orders.
 */
export async function enforcePendingOrderLimit(
  tx: DbClient,
  contact: { email: string; phone: string },
  now = new Date(),
) {
  const checks = [
    { path: 'address.email', key: `checkout:email:${contact.email}`, where: { email: contact.email }, label: 'Email' },
    {
      path: 'address.phone',
      key: `checkout:phone:${contact.phone}`,
      where: { phone: contact.phone },
      label: 'Số điện thoại',
    },
  ]
  // Serializes orders for the same contact so the limit holds. Email is always locked before phone: no deadlock.
  for (const { key } of checks) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
  }

  for (const { path, where, label } of checks) {
    // Expired orders the job has not cancelled yet (ticket 06) do not count.
    const pending = await tx.order.findMany({
      where: { ...where, status: 'pending_payment', reservedUntil: { gt: now } },
      select: { reservedUntil: true },
      orderBy: { reservedUntil: 'asc' },
    })
    if (pending.length < MAX_PENDING_ORDERS_PER_CONTACT) continue
    const message =
      `${label} này đang có ${pending.length} đơn đang chờ thanh toán. ` +
      'Hãy thanh toán hoặc chờ đơn cũ hết hạn rồi đặt lại.'
    const retryAfter = Math.ceil((pending[0]!.reservedUntil!.getTime() - now.getTime()) / 1000)
    throw new AppError(429, ErrorCode.RATE_LIMITED, message, [{ path, message }], undefined, Math.max(retryAfter, 1))
  }
}
