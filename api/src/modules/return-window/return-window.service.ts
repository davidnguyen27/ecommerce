import { ProductType, type ReturnWindowItem } from '@ecommerce/shared'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db, DbClient } from '../../core/db.ts'
import type { ReturnWindowRepository } from './return-window.repository.ts'

/** Return windows per product type (GLOSSARY "Hạn đổi trả", spec M6b): one shared config, audited. */
export class ReturnWindowService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ReturnWindowRepository,
  ) {}

  /** All five product types; unconfigured types are `null`. */
  async list(db: DbClient = this.prisma): Promise<ReturnWindowItem[]> {
    const rows = await this.repo.findAll(db)
    return ProductType.options.map((productType) => ({
      productType,
      days: rows.find((r) => r.productType === productType)?.days ?? null,
    }))
  }

  /** Saves return windows under a lock: `null` clears that type. No change, no audit. Returns all windows. */
  async save(items: readonly ReturnWindowItem[], ctx: RequestContext): Promise<ReturnWindowItem[]> {
    await audited(this.prisma, ctx, async (tx, audit) => {
      await this.repo.lock(tx)
      const before = await this.list(tx)
      const changed = items.filter((i) => before.find((b) => b.productType === i.productType)?.days !== i.days)
      if (changed.length === 0) return
      for (const item of changed) {
        if (item.days === null) await this.repo.clear(tx, item.productType)
        else await this.repo.set(tx, item.productType, item.days)
      }
      await audit({
        action: 'return_window.update',
        entityType: 'return_window',
        // One shared config row, like shipping fees: fixed id.
        entityId: 'return_window',
        before: { items: before },
        after: { items: await this.list(tx) },
      })
    })
    return this.list()
  }
}
