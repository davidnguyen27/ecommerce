import { ErrorCode, ShippingAddress, type CustomerProfile, type LastShippingAddress } from '@ecommerce/shared'
import { hashPassword, verifyPassword } from '../../core/auth/password.ts'
import type { Db } from '../../core/db.ts'
import { AppError } from '../../core/errors.ts'
import type { CustomerMail } from '../../core/jobs/jobs.ts'
import { RATE_LIMITS, enforceRateLimits } from '../../core/middleware/rate-limit.ts'
import { sendVerificationEmail, setCustomerPassword } from '../customer-auth/index.ts'
import { toCustomerProfile } from './customer.mapper.ts'
import type { CustomerRepository } from './customer.repository.ts'

const signedOut = () => new AppError(401, ErrorCode.UNAUTHORIZED, 'Cần đăng nhập')

/** The signed-in customer's own account. An account deleted while signed in counts as signed out. */
export class CustomerService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: CustomerRepository,
    private readonly mail: CustomerMail,
  ) {}

  private async current(id: string) {
    const customer = await this.repo.findById(this.prisma, id)
    if (!customer) throw signedOut()
    return customer
  }

  async profile(id: string): Promise<CustomerProfile> {
    const customer = await this.repo.findWithConsent(this.prisma, id)
    const consent = customer?.consents[0]
    if (!customer || !consent) throw signedOut()
    return toCustomerProfile(customer, consent)
  }

  async shippingAddress(id: string): Promise<LastShippingAddress> {
    const stored = ShippingAddress.safeParse((await this.current(id)).lastShippingAddress)
    return { address: stored.success ? stored.data : null }
  }

  /** Resends the verification email; `false` when already verified (nothing sent). */
  async resendVerification(id: string): Promise<boolean> {
    const customer = await this.current(id)
    if (customer.emailVerifiedAt) return false
    await enforceRateLimits(this.prisma, [{ limit: RATE_LIMITS.verificationEmailPerCustomer, subject: customer.id }])
    await this.prisma.$transaction((tx) => sendVerificationEmail(tx, this.mail.emails, this.mail.siteUrl, customer))
    return true
  }

  /** Changes the password after checking the current one; every session is revoked. */
  async changePassword(id: string, currentPassword: string, newPassword: string) {
    const customer = await this.current(id)
    if (!(await verifyPassword(customer.passwordHash, currentPassword))) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Mật khẩu hiện tại không đúng', [
        { path: 'currentPassword', message: 'Mật khẩu hiện tại không đúng' },
      ])
    }
    const passwordHash = await hashPassword(newPassword)
    await this.prisma.$transaction((tx) => setCustomerPassword(tx, customer.id, passwordHash))
  }
}
