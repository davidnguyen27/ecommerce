import type { DbClient } from '../../core/db.ts'

/** What customers can open, read fresh on each call. Every method takes `db`. */
export class SitemapRepository {
  liveProducts(db: DbClient) {
    return db.productVersion.findMany({
      where: { liveOf: { isNot: null } },
      select: { slug: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    })
  }

  visibleBrands(db: DbClient) {
    return db.brand.findMany({
      where: { hidden: false },
      select: { slug: true, updatedAt: true },
      orderBy: { name: 'asc' },
    })
  }
}
