import { ErrorCode, ProductType, type CategoryLink } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import type { Category, Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'

/**
 * Xếp hàng các thao tác đổi hình dạng cây (tạo, đổi cha, xóa) trong transaction,
 * để hai lần đổi cha cùng lúc không cùng lọt kiểm tra rồi tạo thành vòng lặp.
 */
export async function lockTree(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catalog.category.tree'))`
}

const parentRejected = (status: 400 | 409, message: string) =>
  new AppError(status, status === 400 ? ErrorCode.VALIDATION_ERROR : ErrorCode.CONFLICT, message, [
    { path: 'parentId', message },
  ])

/**
 * Kiểm tra `parentId` làm cha được cho danh mục `child`: cha tồn tại, cùng nhóm hàng (ADR 0004),
 * và không nằm trong nhánh của chính `child`. Gọi sau `lockTree`.
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

  // Đi ngược từ cha mới lên gốc; gặp chính danh mục đang sửa nghĩa là cha mới nằm trong nhánh của nó.
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
 * Cây danh mục khách thấy, gốc là đủ năm nhóm hàng theo thứ tự cố định.
 * Danh mục ẩn bị bỏ cùng cả nhánh con, vì khách không còn đường nào đi tới nhánh đó.
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

/** Danh mục khách thấy theo slug, kèm đường dẫn từ gốc xuống; `null` khi không có hoặc bị ẩn. */
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
