import { ErrorCode, ProductType, type CategoryLink } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import type { Category, Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'

/**
 * Serializes tree-shape changes (create, reparent, delete) in the transaction, so two concurrent reparents cannot both
 * pass the check and form a cycle.
 */
export async function lockTree(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catalog.category.tree'))`
}

const parentRejected = (status: 400 | 409, message: string) =>
  new AppError(status, status === 400 ? ErrorCode.VALIDATION_ERROR : ErrorCode.CONFLICT, message, [
    { path: 'parentId', message },
  ])

/**
 * Checks `parentId` can parent `child`: it exists, has the same product type (ADR 0004), and is not inside `child`'s
 * subtree. Call after `lockTree`.
 */
export async function assertValidParent(
  tx: Prisma.TransactionClient,
  child: { id?: string; productType: ProductType },
  parentId: string | null,
) {
  if (parentId === null) return
  const parent = await tx.category.findUnique({ where: { id: parentId } })
  if (!parent) throw parentRejected(400, 'Danh mục cha không tồn tại')
  if (parent.productType !== child.productType) {
    throw parentRejected(409, 'Danh mục con phải cùng nhóm hàng với danh mục cha')
  }
  if (child.id === undefined) return

  // Walk up from the new parent; meeting the edited category means the parent is inside its subtree.
  const cycle = await tx.$queryRaw<unknown[]>`
    WITH RECURSIVE up AS (
      SELECT id, parent_id FROM category WHERE id = ${parentId}::uuid
      UNION ALL
      SELECT c.id, c.parent_id FROM category c JOIN up ON c.id = up.parent_id
    )
    SELECT 1 FROM up WHERE id = ${child.id}::uuid`
  if (cycle.length > 0) throw parentRejected(409, 'Không đặt được danh mục vào dưới chính nó hay nhánh con của nó')
}

export type VisibleCategory = Category & { children: VisibleCategory[] }

/**
 * The category tree customers see, rooted at the five product types in fixed order. Hidden categories drop with their
 * subtree, since customers can no longer reach it.
 */
export async function loadVisibleTree(db: DbClient) {
  const categories = await db.category.findMany({ where: { hidden: false }, orderBy: { name: 'asc' } })
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

/** A visible category by slug, with its path from the root; `null` when missing or hidden. */
export function findVisible(
  tree: Awaited<ReturnType<typeof loadVisibleTree>>,
  slug: string,
): { category: VisibleCategory; ancestors: CategoryLink[] } | null {
  const search = (nodes: VisibleCategory[], ancestors: CategoryLink[]): ReturnType<typeof findVisible> => {
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
