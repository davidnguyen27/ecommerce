import type { DbClient } from '../db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { isUuid } from '../middleware/validation.ts'

/** The Prisma model methods `BaseRepository` uses; `db.category`, `db.brand`… satisfy it. */
export type ModelDelegate<Row, Create, Update> = {
  findUnique(args: { where: { id: string } }): PromiseLike<Row | null>
  create(args: { data: Create }): PromiseLike<Row>
  update(args: { where: { id: string }; data: Update }): PromiseLike<Row>
}

/**
 * Data access for one table. Every method takes `db` (the client or the caller's transaction) as its first argument,
 * with no default, so a write cannot run outside the service's transaction by accident. Repositories never open
 * transactions. A malformed id finds nothing instead of raising a Postgres type error.
 */
export abstract class BaseRepository<Row extends { id: string }, Create, Update> {
  /** SQL table name, for `lockById`. */
  protected abstract readonly table: string
  protected abstract model(db: DbClient): ModelDelegate<Row, Create, Update>

  async findById(db: DbClient, id: string): Promise<Row | null> {
    return isUuid(id) ? this.model(db).findUnique({ where: { id } }) : null
  }

  /** Locks the row (`FOR UPDATE`) until the transaction ends, then reads it; check state only after this. */
  async lockById(tx: Prisma.TransactionClient, id: string): Promise<Row | null> {
    if (!isUuid(id)) return null
    // `table` is a class constant, never input.
    const locked = await tx.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "${this.table}" WHERE "id" = $1::uuid FOR UPDATE`,
      id,
    )
    return locked.length ? this.model(tx).findUnique({ where: { id } }) : null
  }

  async create(db: DbClient, data: Create): Promise<Row> {
    return this.model(db).create({ data })
  }

  async update(db: DbClient, id: string, data: Update): Promise<Row> {
    return this.model(db).update({ where: { id }, data })
  }
}
