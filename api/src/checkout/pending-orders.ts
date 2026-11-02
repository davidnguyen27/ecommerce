import type { Response } from 'express'
import { ErrorCode } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { AppError } from '../http/errors.ts'

/** Số đơn chờ thanh toán tối đa cho mỗi email và mỗi số điện thoại. Số tạm, chờ chủ doanh nghiệp xác nhận. */
export const MAX_PENDING_ORDERS_PER_CONTACT = 3

/**
 * Chặn giữ hàng ác ý: email hay số điện thoại đã có đủ `MAX_PENDING_ORDERS_PER_CONTACT` đơn chờ thanh toán còn hạn
 * giữ hàng thì 429, `Retry-After` là lúc đơn sớm nhất hết hạn. Gọi trong transaction đặt mua, trước khi tạo đơn.
 * `email` chữ thường và `phone` dạng `0xxxxxxxxx`, như đã lưu trên đơn.
 */
export async function enforcePendingOrderLimit(
  tx: DbClient,
  res: Response,
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
  // Hai lần đặt cùng email hay số điện thoại chạy lần lượt nên không vượt giới hạn. Luôn khóa email trước
  // số điện thoại, nên hai khóa thuộc hai không gian khác nhau và không deadlock.
  for (const { key } of checks) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
  }

  for (const { path, where, label } of checks) {
    // Đơn đã quá hạn giữ hàng mà job chưa kịp hủy (ticket 06) thì không tính.
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
    res.setHeader('Retry-After', String(Math.max(retryAfter, 1)))
    throw new AppError(429, ErrorCode.RATE_LIMITED, message, [{ path, message }])
  }
}
