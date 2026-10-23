import { Router, type Request } from 'express'
import { z } from 'zod'
import {
  CreateCategoryRequest,
  ErrorCode,
  UpdateCategoryRequest,
  type AdminCategory,
  type AdminCategoryList,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import { assertValidParent, lockTree } from '../catalog/categories.ts'
import type { Db } from '../db.ts'
import { Prisma, type Category } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

function toAdmin({ id, productType, parentId, slug, name, hidden }: Category): AdminCategory {
  return { id, productType, parentId, slug, name, hidden }
}

const slugTaken = () =>
  new AppError(409, ErrorCode.CONFLICT, 'Slug này đã có danh mục khác dùng', [
    { path: 'slug', message: 'Slug đã được dùng' },
  ])

function rethrowSlugTaken(err: unknown): never {
  throw err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? slugTaken() : err
}

/** Quản lý cây danh mục; mọi route cần `catalog.edit`. */
export function adminCategoryRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('catalog.edit'))
    .get('/', async (_req, res) => {
      const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } })
      const body: AdminCategoryList = { items: categories.map(toAdmin) }
      res.json(body)
    })
    .post('/', async (req, res) => {
      const input = parse(CreateCategoryRequest, req.body)
      const category = await audited(prisma, req, async (tx, audit) => {
        await lockTree(tx)
        await assertValidParent(tx, input, input.parentId)
        const created = await tx.category.create({ data: input })
        await audit({
          action: 'catalog.category.create',
          entityType: 'category',
          entityId: created.id,
          after: toAdmin(created),
        })
        return created
      }).catch(rethrowSlugTaken)
      res.status(201).json(toAdmin(category))
    })
    .put('/:id', async (req, res) => {
      const input = parse(UpdateCategoryRequest, req.body)
      res.json(
        await updateCategory(prisma, req, 'catalog.category.update', async (tx, before) => {
          if (before.name === input.name && before.slug === input.slug && before.parentId === input.parentId) {
            return null
          }
          if (before.parentId !== input.parentId) {
            await lockTree(tx)
            await assertValidParent(tx, before, input.parentId)
          }
          return input
        }),
      )
    })
    .post('/:id/hide', async (req, res) => {
      res.json(
        await updateCategory(prisma, req, 'catalog.category.hide', async (_tx, before) =>
          before.hidden ? null : { hidden: true },
        ),
      )
    })
    .post('/:id/unhide', async (req, res) => {
      res.json(
        await updateCategory(prisma, req, 'catalog.category.unhide', async (_tx, before) =>
          before.hidden ? { hidden: false } : null,
        ),
      )
    })
    .delete('/:id', async (req, res) => {
      const { id } = parse(CategoryParams, req.params)
      await audited(prisma, req, async (tx, audit) => {
        // Cùng khóa với tạo và đổi cha, để không có danh mục con nào được gắn vào giữa lúc kiểm và lúc xóa.
        await lockTree(tx)
        // Khóa dòng danh mục: sản phẩm đang được gắn vào nó (khóa `FOR KEY SHARE`) thì chờ nhau, không lọt qua bước đếm.
        await tx.$executeRaw`SELECT 1 FROM "category" WHERE "id" = ${id}::uuid FOR UPDATE`
        const before = await tx.category.findUnique({ where: { id } })
        if (!before) throw categoryNotFound()
        if (await tx.category.count({ where: { parentId: id } })) {
          throw new AppError(409, ErrorCode.CONFLICT, 'Danh mục còn danh mục con nên không xóa được; hãy ẩn nó')
        }
        // Phiên bản đã xuất bản (kể cả phiên bản cũ) cũng tham chiếu danh mục, và không sửa được.
        if (
          (await tx.product.count({ where: { categoryId: id } })) ||
          (await tx.productVersion.count({ where: { categoryId: id } }))
        ) {
          throw new AppError(409, ErrorCode.CONFLICT, 'Danh mục còn sản phẩm nên không xóa được; hãy ẩn nó')
        }
        await tx.category.delete({ where: { id } })
        await audit({
          action: 'catalog.category.delete',
          entityType: 'category',
          entityId: id,
          before: toAdmin(before),
        })
      })
      res.status(204).end()
    })
}

const CategoryParams = z.object({ id: z.uuid() })

const categoryNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy danh mục')

/** Sửa một danh mục kèm audit trước/sau. `change` trả `null` khi không có gì đổi: khi đó không ghi gì. */
async function updateCategory(
  prisma: Db,
  req: Request,
  action: string,
  change: (tx: Prisma.TransactionClient, before: Category) => Promise<Prisma.CategoryUncheckedUpdateInput | null>,
) {
  const { id } = parse(CategoryParams, req.params)
  const updated = await audited(prisma, req, async (tx, audit) => {
    const before = await tx.category.findUnique({ where: { id } })
    if (!before) throw categoryNotFound()
    const data = await change(tx, before)
    if (!data) return before

    const after = await tx.category.update({ where: { id }, data })
    await audit({ action, entityType: 'category', entityId: id, before: toAdmin(before), after: toAdmin(after) })
    return after
  }).catch(rethrowSlugTaken)
  return toAdmin(updated)
}
