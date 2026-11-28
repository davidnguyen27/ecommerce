import type { ProductType } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

/** Return windows: at most one row per product type. Every method takes `db`. */
export class ReturnWindowRepository {
  /** Serializes edits, so the audit's `before` is exactly what each edit replaced. */
  async lock(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('return_window'))`
  }

  findAll(db: DbClient) {
    return db.returnWindow.findMany()
  }

  async clear(db: DbClient, productType: ProductType) {
    await db.returnWindow.deleteMany({ where: { productType } })
  }

  async set(db: DbClient, productType: ProductType, days: number) {
    await db.returnWindow.upsert({ where: { productType }, create: { productType, days }, update: { days } })
  }
}
