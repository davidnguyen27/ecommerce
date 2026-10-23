import { Router, type Request } from 'express'
import { z } from 'zod'
import { BrandRequest, ErrorCode, type AdminBrand, type AdminBrandList } from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { Prisma, type Brand } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

function toAdmin(brand: Brand): AdminBrand {
  return {
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    description: brand.description,
    hidden: brand.hidden,
    updatedAt: brand.updatedAt.toISOString(),
  }
}

const slugTaken = () =>
  new AppError(409, ErrorCode.CONFLICT, 'Slug này đã có thương hiệu khác dùng', [
    { path: 'slug', message: 'Slug đã được dùng' },
  ])

function rethrowSlugTaken(err: unknown): never {
  throw err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? slugTaken() : err
}

/** Quản lý thương hiệu; mọi route cần `catalog.edit`. */
export function adminBrandRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('catalog.edit'))
    .get('/', async (_req, res) => {
      const brands = await prisma.brand.findMany({ orderBy: { name: 'asc' } })
      const body: AdminBrandList = { items: brands.map(toAdmin) }
      res.json(body)
    })
    .post('/', async (req, res) => {
      const input = parse(BrandRequest, req.body)
      const brand = await audited(prisma, req, async (tx, audit) => {
        const created = await tx.brand.create({ data: input })
        await audit({
          action: 'catalog.brand.create',
          entityType: 'brand',
          entityId: created.id,
          after: auditFields(created),
        })
        return created
      }).catch(rethrowSlugTaken)
      res.status(201).json(toAdmin(brand))
    })
    .put('/:id', async (req, res) => {
      const input = parse(BrandRequest, req.body)
      res.json(
        await updateBrand(prisma, req, 'catalog.brand.update', (before) =>
          before.name === input.name && before.slug === input.slug && before.description === input.description
            ? null
            : input,
        ),
      )
    })
    .post('/:id/hide', async (req, res) => {
      res.json(
        await updateBrand(prisma, req, 'catalog.brand.hide', (before) => (before.hidden ? null : { hidden: true })),
      )
    })
    .post('/:id/unhide', async (req, res) => {
      res.json(
        await updateBrand(prisma, req, 'catalog.brand.unhide', (before) => (before.hidden ? { hidden: false } : null)),
      )
    })
}

const BrandParams = z.object({ id: z.uuid() })

/** Trường nghiệp vụ ghi vào audit. */
function auditFields({ slug, name, description, hidden }: Brand) {
  return { slug, name, description, hidden }
}

/** Sửa một thương hiệu kèm audit trước/sau. `change` trả `null` khi không có gì đổi: khi đó không ghi gì. */
async function updateBrand(
  prisma: Db,
  req: Request,
  action: string,
  change: (before: Brand) => Prisma.BrandUpdateInput | null,
) {
  const { id } = parse(BrandParams, req.params)
  const updated = await audited(prisma, req, async (tx, audit) => {
    const before = await tx.brand.findUnique({ where: { id } })
    if (!before) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy thương hiệu')
    const data = change(before)
    if (!data) return before

    const after = await tx.brand.update({ where: { id }, data })
    await audit({ action, entityType: 'brand', entityId: id, before: auditFields(before), after: auditFields(after) })
    return after
  }).catch(rethrowSlugTaken)
  return toAdmin(updated)
}
