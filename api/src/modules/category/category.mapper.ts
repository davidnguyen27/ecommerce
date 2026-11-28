import type { AdminCategory, CategoryNode, PublicCategory } from '@ecommerce/shared'
import type { Category } from '../../generated/prisma/client.ts'
import type { FoundCategory, VisibleCategory } from './category.interface.ts'

export function toAdminCategory({ id, productType, parentId, slug, name, hidden }: Category): AdminCategory {
  return { id, productType, parentId, slug, name, hidden }
}

export function toCategoryNode(category: VisibleCategory): CategoryNode {
  return { slug: category.slug, name: category.name, children: category.children.map(toCategoryNode) }
}

export function toPublicCategory({ category, ancestors }: FoundCategory): PublicCategory {
  return {
    slug: category.slug,
    name: category.name,
    productType: category.productType,
    ancestors,
    children: category.children.map(({ slug, name }) => ({ slug, name })),
  }
}
