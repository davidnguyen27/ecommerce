import { normalizeEmail } from '../../core/auth/email.ts'
import type { DbClient } from '../../core/db.ts'

/** Staff accounts as staff sessions see them: locked accounts cannot sign in. Every method takes `db`. */
export class StaffAccountRepository {
  findCredentials(db: DbClient, email: string) {
    return db.staff.findUnique({
      where: { email: normalizeEmail(email), lockedAt: null },
      select: { id: true, passwordHash: true },
    })
  }

  async isActive(db: DbClient, id: string) {
    return (await db.staff.count({ where: { id, lockedAt: null } })) > 0
  }
}
