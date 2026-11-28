import type { DbClient } from '../../core/db.ts'
import { BaseRepository, type ModelDelegate } from '../../core/repository/base.repository.ts'
import type { Brand, Prisma } from '../../generated/prisma/client.ts'
import type { BrandInput } from './dto/index.ts'

type Update = Prisma.BrandUncheckedUpdateInput

export class BrandRepository extends BaseRepository<Brand, BrandInput, Update> {
  protected readonly table = 'brand'

  protected model(db: DbClient): ModelDelegate<Brand, BrandInput, Update> {
    return db.brand
  }

  findAllByName(db: DbClient) {
    return db.brand.findMany({ orderBy: { name: 'asc' } })
  }

  findVisibleNames(db: DbClient) {
    return db.brand.findMany({ where: { hidden: false }, select: { slug: true, name: true }, orderBy: { name: 'asc' } })
  }

  findVisibleBySlug(db: DbClient, slug: string) {
    return db.brand.findFirst({ where: { slug, hidden: false } })
  }
}
