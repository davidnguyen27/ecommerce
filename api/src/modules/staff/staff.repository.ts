import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

/** Staff accounts. Every method takes `db`. */
export class StaffRepository {
  findAll(db: DbClient) {
    return db.staff.findMany({ orderBy: { createdAt: 'asc' } })
  }

  findById(db: DbClient, id: string) {
    return db.staff.findUnique({ where: { id } })
  }

  findByEmail(db: DbClient, email: string) {
    return db.staff.findUnique({ where: { email } })
  }

  create(db: DbClient, data: Prisma.StaffCreateInput) {
    return db.staff.create({ data })
  }

  update(db: DbClient, id: string, data: Prisma.StaffUpdateInput) {
    return db.staff.update({ where: { id }, data })
  }

  /**
   * Serializes role, lock and profile changes, so two owners cannot demote each other and leave nobody. Taken before
   * reading the staff row.
   */
  async lockOwners(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff.owners'))`
  }

  countActiveOwners(db: DbClient) {
    return db.staff.count({ where: { roles: { has: 'owner' }, lockedAt: null } })
  }
}
