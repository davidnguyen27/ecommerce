import type { DbClient } from '../../core/db.ts'
import { BaseRepository, type ModelDelegate } from '../../core/repository/base.repository.ts'
import type { Category, Prisma } from '../../generated/prisma/client.ts'
import type { CreateCategoryInput } from './dto/index.ts'

type Update = Prisma.CategoryUncheckedUpdateInput

export class CategoryRepository extends BaseRepository<Category, CreateCategoryInput, Update> {
  protected readonly table = 'category'

  protected model(db: DbClient): ModelDelegate<Category, CreateCategoryInput, Update> {
    return db.category
  }

  /**
   * Serializes tree-shape changes (create, reparent, delete) in the transaction, so two concurrent reparents cannot
   * both pass the check and form a cycle.
   */
  async lockTree(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catalog.category.tree'))`
  }

  findAllByName(db: DbClient) {
    return db.category.findMany({ orderBy: { name: 'asc' } })
  }

  findVisible(db: DbClient) {
    return db.category.findMany({ where: { hidden: false }, orderBy: { name: 'asc' } })
  }

  /** Whether `childId` is `parentId` or one of its ancestors: walks up from the new parent. */
  async isAncestorOrSelf(tx: Prisma.TransactionClient, childId: string, parentId: string) {
    const cycle = await tx.$queryRaw<unknown[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id FROM category WHERE id = ${parentId}::uuid
        UNION ALL
        SELECT c.id, c.parent_id FROM category c JOIN up ON c.id = up.parent_id
      )
      SELECT 1 FROM up WHERE id = ${childId}::uuid`
    return cycle.length > 0
  }

  countChildren(db: DbClient, id: string) {
    return db.category.count({ where: { parentId: id } })
  }

  /** Products and published versions (old ones too) that reference the category. */
  async countReferences(db: DbClient, id: string) {
    return (
      (await db.product.count({ where: { categoryId: id } })) +
      (await db.productVersion.count({ where: { categoryId: id } }))
    )
  }

  async delete(tx: Prisma.TransactionClient, id: string) {
    await tx.category.delete({ where: { id } })
  }
}
