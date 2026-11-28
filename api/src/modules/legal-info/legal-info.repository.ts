import type { LegalInfo } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

const KEY = 'legal_info'

/** Legal info is one system config row. Every method takes `db`. */
export class LegalInfoRepository {
  readonly key = KEY

  async find(db: DbClient) {
    return (await db.systemConfig.findUnique({ where: { key: KEY } }))?.value
  }

  /** Serializes edits, so the audit's `before` is exactly what each edit replaced. */
  async lock(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('legal_info'))`
  }

  async save(db: DbClient, value: LegalInfo) {
    await db.systemConfig.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } })
  }
}
