import { hashPassword } from '../auth/password.ts'
import { revokeAllRefreshTokens } from '../auth/refresh-tokens.ts'
import type { Db, DbClient } from '../db.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { claimCustomerToken, issueCustomerToken } from './customer-tokens.ts'

const RESET_TTL_MS = 60 * 60 * 1000

/** Tạo token đặt lại mật khẩu một lần và xếp thư chứa link vào hàng đợi, cùng `db` (thường là transaction). */
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
 * Đổi mật khẩu của khách trong `db` (thường là transaction) và đăng xuất mọi thiết bị.
 * Link đặt lại còn dở cũng bị vô hiệu, vì chúng được cấp cho mật khẩu cũ.
 */
export async function setCustomerPassword(db: DbClient, customerId: string, passwordHash: string) {
  await db.customer.update({ where: { id: customerId }, data: { passwordHash } })
  await db.customerToken.updateMany({
    where: { customerId, purpose: 'password_reset', usedAt: null },
    data: { usedAt: new Date() },
  })
  await revokeAllRefreshTokens(db, 'customer', customerId)
}

/** Đặt mật khẩu mới bằng token trong thư; trả `false` khi token sai, đã dùng hoặc hết hạn. */
export async function resetPassword(prisma: Db, token: string, password: string): Promise<boolean> {
  const passwordHash = await hashPassword(password)
  return prisma.$transaction(async (tx) => {
    const customerId = await claimCustomerToken(tx, token, 'password_reset')
    if (customerId === null) return false
    await setCustomerPassword(tx, customerId, passwordHash)
    return true
  })
}
