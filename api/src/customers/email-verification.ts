import type { Db, DbClient } from '../db.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { claimCustomerToken, issueCustomerToken } from './customer-tokens.ts'

const VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000

/** Tạo token xác minh một lần và xếp thư chứa link vào hàng đợi, cùng `db` (thường là transaction). */
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
 * Dùng token xác minh; trả `false` khi token sai, đã dùng hoặc hết hạn. Cùng transaction, các đơn vãng lai
 * (chưa có `customer_id`) đặt bằng đúng email này được gắn vào khách: giờ đã chắc email là của khách.
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
    // Email trên đơn và trên khách đều lưu chữ thường.
    await tx.order.updateMany({ where: { customerId: null, email: customer.email }, data: { customerId } })
    return true
  })
}
