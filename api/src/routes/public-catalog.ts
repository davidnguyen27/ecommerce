import { Router } from 'express'
import { z } from 'zod'
import { ErrorCode, type AttributeSchema, type PublicBrand, type PublicBrandList } from '@ecommerce/shared'
import { ProductTypeParams, loadAttributeSchema } from '../catalog/attribute-schemas.ts'
import type { Storage } from '../core/adapters/storage.ts'
import type { Db } from '../core/db.ts'
import { StoredImage, imageRenditions } from '../core/media/images.ts'
import { AppError } from '../core/errors.ts'
import { parse } from '../core/middleware/validation.ts'

const SlugParams = z.object({ slug: z.string() })

/** A product type's attribute schema, for website labels and filters. */
export function publicAttributeSchemaRoutes(prisma: Db) {
  return Router().get('/:productType', async (req, res) => {
    const { productType } = parse(ProductTypeParams, req.params)
    const { attributes } = await loadAttributeSchema(prisma, productType)
    const body: AttributeSchema = { productType, attributes }
    res.json(body)
  })
}

/** Customers browse brands; hidden brands count as missing. */
export function publicBrandRoutes(prisma: Db, storage: Storage) {
  return Router()
    .get('/', async (_req, res) => {
      const brands = await prisma.brand.findMany({
        where: { hidden: false },
        select: { slug: true, name: true },
        orderBy: { name: 'asc' },
      })
      const body: PublicBrandList = { items: brands }
      res.json(body)
    })
    .get('/:slug', async (req, res) => {
      const { slug } = parse(SlugParams, req.params)
      const brand = await prisma.brand.findFirst({ where: { slug, hidden: false } })
      if (!brand) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy thương hiệu')
      const body: PublicBrand = {
        slug: brand.slug,
        name: brand.name,
        description: brand.description,
        logo: brand.logo === null ? null : imageRenditions(storage, StoredImage.parse(brand.logo)),
      }
      res.json(body)
    })
}
