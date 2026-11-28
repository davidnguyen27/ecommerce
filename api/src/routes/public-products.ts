import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  GENDER_KEY,
  PRODUCT_PAGE_SIZE,
  ProductListQuery,
  ProductType,
  attributeFiltersOf,
  type ProductSearchResult,
  type PublicProduct,
} from '@ecommerce/shared'
import type { Storage } from '../core/adapters/storage.ts'
import { attributeSchemaQuery } from '../modules/attribute-schema/index.ts'
import { findPublicProduct, searchProductCards, subtreeIds } from '../catalog/public-products.ts'
import { searchFacets, type SearchCriteria } from '../catalog/search.ts'
import type { Db } from '../core/db.ts'
import { AppError } from '../core/errors.ts'
import { parse } from '../core/middleware/validation.ts'

const SlugParams = z.object({ slug: z.string() })

/** Products as customers see them (`catalog/public-products.ts`). */
export function publicProductRoutes(prisma: Db, storage: Storage) {
  return Router()
    .get('/', async (req, res) => {
      const query = parse(ProductListQuery, { ...req.query, attributes: attributeFiltersOf(req.query) })
      const category =
        query.category === undefined
          ? undefined
          : await prisma.category.findUnique({ where: { slug: query.category }, select: { productType: true } })
      // The product type in view decides filters and facets; when unknown, only gender, shared by all types.
      const productType = category?.productType ?? query.type ?? null
      const schema = await attributeSchemaQuery.load(prisma, productType ?? ProductType.enum.footwear)
      const filterable = schema.attributes.filter((a) => a.filterable && (productType || a.key === GENDER_KEY))

      const criteria: SearchCriteria = {
        text: query.q,
        categoryIds: query.category === undefined ? undefined : await subtreeIds(prisma, query.category),
        brandSlug: query.brand,
        productType: query.type,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        // Keys not filterable for the current type (old URL, changed schema) are ignored instead of erroring.
        attributes: filterable.flatMap((definition) => {
          const values = query.attributes[definition.key] ?? []
          return values.length ? [{ definition, values }] : []
        }),
      }
      const [{ items, total }, facets] = await Promise.all([
        searchProductCards(prisma, storage, criteria, query.sort, query.page),
        searchFacets(prisma, criteria, filterable),
      ])
      const body: ProductSearchResult = {
        items,
        page: query.page,
        pageSize: PRODUCT_PAGE_SIZE,
        total,
        productType,
        facets,
      }
      res.json(body)
    })
    .get('/:slug', async (req, res) => {
      const { slug } = parse(SlugParams, req.params)
      const product = await findPublicProduct(prisma, storage, slug)
      if (!product) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy sản phẩm')
      const body: PublicProduct = product
      res.json(body)
    })
}
