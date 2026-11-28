import type { CategoryLink, ProductType } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Category } from '../../generated/prisma/client.ts'

export type VisibleCategory = Category & { children: VisibleCategory[] }

/** The tree customers see: the five product types in fixed order, each with its visible categories. */
export type VisibleTree = { productType: ProductType; children: VisibleCategory[] }[]

/** A visible category with its path from the root. */
export type FoundCategory = { category: VisibleCategory; ancestors: CategoryLink[] }

/** What other modules (products, sitemap) may ask of the category module. */
export interface ICategoryQuery {
  /** Hidden categories drop with their subtree, since customers can no longer reach it. */
  loadVisibleTree(db: DbClient): Promise<VisibleTree>
  /** A visible category by slug; `null` when missing or hidden. */
  findVisible(tree: VisibleTree, slug: string): FoundCategory | null
}
