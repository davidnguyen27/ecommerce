import { ErrorCode } from '@ecommerce/shared'
import { audited, type Audit } from '../audit/audited.ts'
import type { RequestContext } from '../context/request-context.ts'
import type { Db, DbClient } from '../db.ts'
import { AppError } from '../errors.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { BaseRepository } from '../repository/base.repository.ts'

/** Audit action names of one entity, e.g. `{ create: 'catalog.brand.create', update: 'catalog.brand.update' }`. */
export type CrudActions = { create: string; update: string }

/**
 * Create, read and update with hooks, like the reference repo's `BaseCrudService`, but each write is one transaction
 * that also writes the audit (ADR 0003), and an update locks the row before checking it. An update that changes
 * nothing writes nothing and returns the current row.
 */
export abstract class BaseCrudService<Row extends { id: string }, Create, Update> {
  protected abstract readonly entityType: string
  protected abstract readonly actions: CrudActions

  protected constructor(
    protected readonly prisma: Db,
    protected readonly repo: BaseRepository<Row, Create, Update>,
  ) {}

  /** The business fields audit keeps; never passwords, hashes or tokens. */
  protected abstract snapshot(row: Row): Prisma.InputJsonValue

  protected notFound(): AppError {
    return new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy')
  }

  /** Checks before create, in the transaction (e.g. take a lock, check a parent exists). */
  protected async beforeCreate(_tx: Prisma.TransactionClient, _input: Create): Promise<void> {}

  /** Checks the locked row and returns what to write, or `null` when nothing changes. */
  protected async beforeUpdate(_tx: Prisma.TransactionClient, _current: Row, input: Update): Promise<Update | null> {
    return input
  }

  /** Reads one row; `db` is a caller's transaction when needed. */
  async getItem(id: string, db: DbClient = this.prisma): Promise<Row> {
    const row = await this.repo.findById(db, id)
    if (!row) throw this.notFound()
    return row
  }

  async create(input: Create, ctx: RequestContext): Promise<Row> {
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.beforeCreate(tx, input)
      const row = await this.repo.create(tx, input)
      await audit({
        action: this.actions.create,
        entityType: this.entityType,
        entityId: row.id,
        after: this.snapshot(row),
      })
      return row
    })
  }

  /** `action` overrides the update action, e.g. `catalog.category.hide` for a hide that is an update underneath. */
  async update(id: string, input: Update, ctx: RequestContext, action = this.actions.update): Promise<Row> {
    return audited(this.prisma, ctx, (tx, audit) => this.updateLocked(tx, audit, id, input, action))
  }

  protected async updateLocked(
    tx: Prisma.TransactionClient,
    audit: Audit,
    id: string,
    input: Update,
    action: string,
  ): Promise<Row> {
    const current = await this.repo.lockById(tx, id)
    if (!current) throw this.notFound()
    const change = await this.beforeUpdate(tx, current, input)
    if (change === null) return current
    const row = await this.repo.update(tx, id, change)
    await audit({
      action,
      entityType: this.entityType,
      entityId: id,
      before: this.snapshot(current),
      after: this.snapshot(row),
    })
    return row
  }
}
