import { hashPassword } from '../../core/auth/password.ts'
import { revokeAllRefreshTokens } from '../auth/index.ts'
import type { Db, DbClient } from '../../core/db.ts'
import type { EmailQueue } from '../../core/jobs/jobs.ts'
import { claimCustomerToken, issueCustomerToken } from './customer-token.ts'

const RESET_TTL_MS = 60 * 60 * 1000

/** Creates a one-time password reset token and queues the email with its link, in `db` (usually a transaction). */
export async function sendPasswordResetEmail(
  db: DbClient,
  emails: EmailQueue,
  siteUrl: string,
  customer: { id: string; email: string },
) {
  const link = await issueCustomerToken(db, customer.id, 'password_reset', RESET_TTL_MS, siteUrl, '/dat-lai-mat-khau')
  await emails.sendEmail(db, {
    to: customer.email,
    subject: 'Đặt lại mật khẩu',
    text: `Chào bạn,\n\nMở link sau để đặt mật khẩu mới cho tài khoản của bạn (link dùng được một lần, trong 1 giờ):\n${link}\n\nNếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua thư này; mật khẩu hiện tại vẫn giữ nguyên.`,
  })
}

/**
 * Changes the customer's password in `db` (usually a transaction) and signs out every device. Pending reset links
 * are invalidated too, since they were issued for the old password.
 */
export async function setCustomerPassword(db: DbClient, customerId: string, passwordHash: string) {
  await db.customer.update({ where: { id: customerId }, data: { passwordHash } })
  await db.customerToken.updateMany({
    where: { customerId, purpose: 'password_reset', usedAt: null },
    data: { usedAt: new Date() },
  })
  await revokeAllRefreshTokens(db, 'customer', customerId)
}

/** Sets a new password with the emailed token; `false` when wrong, used or expired. */
export async function resetPassword(prisma: Db, token: string, password: string): Promise<boolean> {
  const passwordHash = await hashPassword(password)
  return prisma.$transaction(async (tx) => {
    const customerId = await claimCustomerToken(tx, token, 'password_reset')
    if (customerId === null) return false
    await setCustomerPassword(tx, customerId, passwordHash)
    return true
  })
}
