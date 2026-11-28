import { ErrorCode, type RegisterRequest } from '@ecommerce/shared'
import { findCurrentPrivacyPolicy } from '../content-page/index.ts'
import { normalizeEmail } from '../../core/auth/email.ts'
import { hashPassword } from '../../core/auth/password.ts'
import type { Db } from '../../core/db.ts'
import { AppError, isUniqueViolation } from '../../core/errors.ts'
import type { CustomerMail } from '../../core/jobs/jobs.ts'
import { RATE_LIMITS, enforceRateLimits } from '../../core/middleware/rate-limit.ts'
import type { CustomerAccountRepository } from './customer-auth.repository.ts'
import { sendVerificationEmail, verifyEmail } from './email-verification.ts'
import { resetPassword, sendPasswordResetEmail } from './password-reset.ts'

/** Customer sign-up, email verification and forgot password; sessions are in the `auth` module. */
export class CustomerAuthService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: CustomerAccountRepository,
    private readonly mail: CustomerMail,
  ) {}

  /** Creates the account and queues the verification email; returns the new customer id. */
  async register(input: RegisterRequest, clientIp: string): Promise<string> {
    const { prisma, mail } = this
    await enforceRateLimits(prisma, [{ limit: RATE_LIMITS.registerPerIp, subject: clientIp }])
    const email = normalizeEmail(input.email)
    const passwordHash = await hashPassword(input.password)

    const customer = await prisma
      .$transaction(async (tx) => {
        // Read the version in the same transaction, so consent points at the version current at sign-up.
        const policy = await findCurrentPrivacyPolicy(tx)
        if (!policy) {
          throw new AppError(
            503,
            ErrorCode.SERVICE_UNAVAILABLE,
            'Chưa thể đăng ký vì chính sách bảo mật chưa được công bố',
          )
        }
        const created = await this.repo.createWithConsent(tx, email, passwordHash, policy.id)
        await sendVerificationEmail(tx, mail.emails, mail.siteUrl, created)
        return created
      })
      .catch((err: unknown) => {
        // Only say it is taken, nothing more about the existing account.
        throw isUniqueViolation(err) ? new AppError(409, ErrorCode.CONFLICT, 'Email này đã được đăng ký') : err
      })
    return customer.id
  }

  async verifyEmail(token: string) {
    if (!(await verifyEmail(this.prisma, token))) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Link xác minh không hợp lệ hoặc đã hết hạn')
    }
  }

  /** Emails a reset link when the email has an account; the caller answers the same either way. */
  async forgotPassword(rawEmail: string, clientIp: string) {
    const { prisma, mail } = this
    const email = normalizeEmail(rawEmail)
    await enforceRateLimits(prisma, [
      { limit: RATE_LIMITS.forgotPasswordPerEmail, subject: email },
      { limit: RATE_LIMITS.forgotPasswordPerIp, subject: clientIp },
    ])
    const customer = await this.repo.findByEmail(prisma, email)
    if (customer) {
      await prisma.$transaction((tx) => sendPasswordResetEmail(tx, mail.emails, mail.siteUrl, customer))
    }
  }

  async resetPassword(token: string, password: string) {
    if (!(await resetPassword(this.prisma, token, password))) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn')
    }
  }
}
