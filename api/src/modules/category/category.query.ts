import { ProductType } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Category } from '../../generated/prisma/client.ts'
import type { FoundCategory, ICategoryQuery, VisibleCategory, VisibleTree } from './category.interface.ts'
import type { CategoryRepository } from './category.repository.ts'

/** Read side of the category tree for other modules; reads only through the `db` it is given. */
export class CategoryQuery implements ICategoryQuery {
  constructor(private readonly repo: CategoryRepository) {}

  async loadVisibleTree(db: DbClient): Promise<VisibleTree> {
    const categories = await this.repo.findVisible(db)
    const byParent = new Map<string | null, Category[]>()
    for (const category of categories) {
      byParent.set(category.parentId, [...(byParent.get(category.parentId) ?? []), category])
    }
    const build = (parentId: string | null): VisibleCategory[] =>
      (byParent.get(parentId) ?? []).map((category) => ({ ...category, children: build(category.id) }))

    const roots = build(null)
    return ProductType.options.map((productType) => ({
      productType,
      children: roots.filter((category) => category.productType === productType),
    }))
  }

  findVisible(tree: VisibleTree, slug: string): FoundCategory | null {
    const search = (nodes: VisibleCategory[], ancestors: FoundCategory['ancestors']): FoundCategory | null => {
      for (const node of nodes) {
        if (node.slug === slug) return { category: node, ancestors }
        const found = search(node.children, [...ancestors, { slug: node.slug, name: node.name }])
        if (found) return found
      }
      return null
    }
    return search(
      tree.flatMap((root) => root.children),
      [],
    )
  }
}
