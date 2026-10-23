import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import type { Db, DbClient } from '../db.ts'
import type { EmailQueue } from '../jobs/jobs.ts'

const VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000

/** Tạo token xác minh một lần và xếp thư chứa link vào hàng đợi, cùng `db` (thường là transaction). */
export async function sendVerificationEmail(
  db: DbClient,
  emails: EmailQueue,
  siteUrl: string,
  customer: { id: string; email: string },
) {
  const token = newOpaqueToken()
  await db.customerToken.create({
    data: {
      customerId: customer.id,
      purpose: 'email_verification',
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  })
  const link = new URL('/xac-minh-email', siteUrl)
  link.searchParams.set('token', token)
  await emails.sendEmail(db, {
    to: customer.email,
    subject: 'Xác minh địa chỉ email của bạn',
    text: `Chào bạn,\n\nMở link sau để xác minh email cho tài khoản của bạn (link dùng được một lần, trong 48 giờ):\n${link}\n\nNếu bạn không đăng ký tài khoản, hãy bỏ qua thư này.`,
  })
}

/** Dùng token xác minh; trả `false` khi token sai, đã dùng hoặc hết hạn. */
export async function verifyEmail(prisma: Db, token: string): Promise<boolean> {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const found = await tx.customerToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } })
    if (!found || found.purpose !== 'email_verification') return false
    // Đánh dấu đã dùng có điều kiện, để hai lần mở link cùng lúc chỉ một lần thành công.
    const claimed = await tx.customerToken.updateMany({
      where: { id: found.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (claimed.count === 0) return false
    await tx.customer.updateMany({
      where: { id: found.customerId, emailVerifiedAt: null },
      data: { emailVerifiedAt: now },
    })
    return true
  })
}
