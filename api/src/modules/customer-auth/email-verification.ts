import type { Db, DbClient } from '../../core/db.ts'
import type { EmailQueue } from '../../core/jobs/jobs.ts'
import { claimCustomerToken, issueCustomerToken } from './customer-token.ts'

const VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000

/** Creates a one-time verification token and queues the email with its link, in `db` (usually a transaction). */
export async function sendVerificationEmail(
  db: DbClient,
  emails: EmailQueue,
  siteUrl: string,
  customer: { id: string; email: string },
) {
  const link = await issueCustomerToken(
    db,
    customer.id,
    'email_verification',
    VERIFICATION_TTL_MS,
    siteUrl,
    '/xac-minh-email',
  )
  await emails.sendEmail(db, {
    to: customer.email,
    subject: 'Xác minh địa chỉ email của bạn',
    text: `Chào bạn,\n\nMở link sau để xác minh email cho tài khoản của bạn (link dùng được một lần, trong 48 giờ):\n${link}\n\nNếu bạn không đăng ký tài khoản, hãy bỏ qua thư này.`,
  })
}

/**
 * Uses a verification token; `false` when wrong, used or expired. In the same transaction, guest orders (no
 * `customer_id`) placed with this exact email are linked to the customer: the email is now proven theirs.
 */
export async function verifyEmail(prisma: Db, token: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const customerId = await claimCustomerToken(tx, token, 'email_verification')
    if (customerId === null) return false
    await tx.customer.updateMany({
      where: { id: customerId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    })
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } })
    // Emails on orders and customers are both stored lowercase.
    await tx.order.updateMany({ where: { customerId: null, email: customer.email }, data: { customerId } })
    return true
  })
}
