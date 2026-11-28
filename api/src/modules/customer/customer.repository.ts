import type { DbClient } from '../../core/db.ts'

/** The signed-in customer's account. Every method takes `db`. */
export class CustomerRepository {
  findById(db: DbClient, id: string) {
    return db.customer.findUnique({ where: { id } })
  }

  /** With the latest privacy consent and its policy version. */
  findWithConsent(db: DbClient, id: string) {
    return db.customer.findUnique({
      where: { id },
      include: {
        consents: {
          orderBy: { consentedAt: 'desc' },
          take: 1,
          include: { policyVersion: { select: { version: true } } },
        },
      },
    })
  }
}
