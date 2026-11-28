import { normalizeEmail } from '../../core/auth/email.ts'
import type { DbClient } from '../../core/db.ts'

/** Customer accounts for sign-up and sign-in. Every method takes `db`. */
export class CustomerAccountRepository {
  findCredentials(db: DbClient, email: string) {
    return db.customer.findUnique({ where: { email: normalizeEmail(email) }, select: { id: true, passwordHash: true } })
  }

  async isActive(db: DbClient, id: string) {
    return (await db.customer.count({ where: { id } })) > 0
  }

  /** `email` is already normalized. */
  findByEmail(db: DbClient, email: string) {
    return db.customer.findUnique({ where: { email } })
  }

  /** A new account with its consent to the privacy policy version current at sign-up. */
  createWithConsent(db: DbClient, email: string, passwordHash: string, policyVersionId: string) {
    return db.customer.create({ data: { email, passwordHash, consents: { create: { policyVersionId } } } })
  }
}
