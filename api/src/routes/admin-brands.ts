import { randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import { z } from 'zod'
import { BrandRequest, ErrorCode, type AdminBrand, type AdminBrandList } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { Prisma, type Brand } from '../generated/prisma/client.ts'
import { AppError, rethrowUnique } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import {
  LOGO_WIDTHS,
  StoredImage,
  deleteImageFilesQuietly,
  imageRenditions,
  receiveImage,
  storeImage,
  uploadedFile,
} from '../media/images.ts'

const logoOf = (brand: Brand) => (brand.logo === null ? null : StoredImage.parse(brand.logo))

function toAdmin(storage: Storage, brand: Brand): AdminBrand {
  const logo = logoOf(brand)
  return {
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    description: brand.description,
    hidden: brand.hidden,
    logo: logo && imageRenditions(storage, logo),
    updatedAt: brand.updatedAt.toISOString(),
  }
}

const slugTaken = () =>
  new AppError(409, ErrorCode.CONFLICT, 'Slug này đã có thương hiệu khác dùng', [
    { path: 'slug', message: 'Slug đã được dùng' },
  ])

const brandNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy thương hiệu')

/** Brand management: logos need `media.upload`, other routes `catalog.edit`. */
export function adminBrandRoutes(prisma: Db, storage: Storage) {
  return (
    Router()
      // Declared before the shared `catalog.edit` guard below, since logos have their own permission.
      .put('/:id/logo', requirePermission('media.upload'), receiveImage, async (req, res) => {
        const { id } = parse(BrandParams, req.params)
        const file = uploadedFile(req)
        if (!(await prisma.brand.findUnique({ where: { id } }))) throw brandNotFound()

        // A new prefix per logo: the URL changes, so the CDN never serves the old one.
        const logo = await storeImage(storage, `brands/${id}/${randomUUID()}`, file, LOGO_WIDTHS)
        const brand = await setLogo(prisma, storage, req, id, logo).catch(async (err: unknown) => {
          await deleteImageFilesQuietly(storage, req, logo)
          throw err
        })
        res.json(toAdmin(storage, brand))
      })
      .delete('/:id/logo', requirePermission('media.upload'), async (req, res) => {
        const { id } = parse(BrandParams, req.params)
        res.json(toAdmin(storage, await setLogo(prisma, storage, req, id, null)))
      })
      .use(requirePermission('catalog.edit'))
      .get('/', async (_req, res) => {
        const brands = await prisma.brand.findMany({ orderBy: { name: 'asc' } })
        const body: AdminBrandList = { items: brands.map((brand) => toAdmin(storage, brand)) }
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
        }).catch(rethrowUnique(slugTaken))
        res.status(201).json(toAdmin(storage, brand))
      })
      .put('/:id', async (req, res) => {
        const input = parse(BrandRequest, req.body)
        const brand = await updateBrand(prisma, req, 'catalog.brand.update', (before) =>
          before.name === input.name && before.slug === input.slug && before.description === input.description
            ? null
            : input,
        )
        res.json(toAdmin(storage, brand))
      })
      .post('/:id/hide', async (req, res) => {
        const brand = await updateBrand(prisma, req, 'catalog.brand.hide', (before) =>
          before.hidden ? null : { hidden: true },
        )
        res.json(toAdmin(storage, brand))
      })
      .post('/:id/unhide', async (req, res) => {
        const brand = await updateBrand(prisma, req, 'catalog.brand.unhide', (before) =>
          before.hidden ? { hidden: false } : null,
        )
        res.json(toAdmin(storage, brand))
      })
  )
}

const BrandParams = z.object({ id: z.uuid() })

/** Business fields recorded in audit. */
function auditFields({ slug, name, description, hidden }: Brand) {
  return { slug, name, description, hidden }
}

/** Updates a brand with before/after audit. `change` returns `null` when nothing changes: then nothing is written. */
async function updateBrand(
  prisma: Db,
  req: Request,
  action: string,
  change: (before: Brand) => Prisma.BrandUpdateInput | null,
) {
  const { id } = parse(BrandParams, req.params)
  return audited(prisma, req, async (tx, audit) => {
    const before = await tx.brand.findUnique({ where: { id } })
    if (!before) throw brandNotFound()
    const data = change(before)
    if (!data) return before

    const after = await tx.brand.update({ where: { id }, data })
    await audit({ action, entityType: 'brand', entityId: id, before: auditFields(before), after: auditFields(after) })
    return after
  }).catch(rethrowUnique(slugTaken))
}

/**
 * Sets a new logo (`null` removes it) with audit; the old logo is deleted from storage after commit. Locks the brand
 * row so two concurrent logo changes never leave a replaced file behind.
 */
async function setLogo(prisma: Db, storage: Storage, req: Request, id: string, logo: StoredImage | null) {
  const { before, after } = await audited(prisma, req, async (tx, audit) => {
    await tx.$executeRaw`SELECT 1 FROM "brand" WHERE "id" = ${id}::uuid FOR UPDATE`
    const before = await tx.brand.findUnique({ where: { id } })
    if (!before) throw brandNotFound()
    if (before.logo === null && logo === null) return { before, after: before }

    const after = await tx.brand.update({ where: { id }, data: { logo: logo ?? Prisma.DbNull } })
    await audit({
      action: logo ? 'media.brand_logo.upload' : 'media.brand_logo.delete',
      entityType: 'brand',
      entityId: id,
      before: { logo: before.logo ?? null },
      after: { logo: logo ?? null },
    })
    return { before, after }
  })
  const old = logoOf(before)
  if (old) await deleteImageFilesQuietly(storage, req, old)
  return after
}
