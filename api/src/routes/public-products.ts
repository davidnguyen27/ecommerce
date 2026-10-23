import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  PRODUCT_PAGE_SIZE,
  ProductListQuery,
  type ProductCard,
  type ProductCardList,
  type PublicProduct,
} from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { loadAttributeSchema } from '../catalog/attribute-schemas.ts'
import { findVisible, loadVisibleTree } from '../catalog/categories.ts'
import { ProductSnapshot, cheapestVariant } from '../catalog/publication.ts'
import { LATEST_VERSION } from '../content/pages.ts'
import type { Db } from '../db.ts'
import type { Brand, Prisma, ProductVersion } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import { imageRenditions } from '../media/images.ts'

const SlugParams = z.object({ slug: z.string() })

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy sản phẩm')

/**
 * Sản phẩm như khách thấy: chỉ sản phẩm đã xuất bản, và chỉ đọc phiên bản đang xuất bản, không đọc bản đang soạn.
 * Ẩn thương hiệu, danh mục không làm sản phẩm biến mất (GLOSSARY "Ẩn").
 */
export function publicProductRoutes(prisma: Db, storage: Storage) {
  function toCard(version: ProductVersion & { brand: Brand }): ProductCard {
    const snapshot = ProductSnapshot.parse(version.snapshot)
    const cheapest = cheapestVariant(snapshot)
    const cover = snapshot.images[0]
    return {
      slug: snapshot.slug,
      name: snapshot.name,
      brand: { slug: version.brand.slug, name: version.brand.name },
      fromPrice: cheapest.price,
      compareAtPrice: cheapest.compareAtPrice,
      image: cover ? { ...imageRenditions(storage, cover), alt: cover.alt } : null,
    }
  }

  return Router()
    .get('/', async (req, res) => {
      const query = parse(ProductListQuery, req.query)
      const where: Prisma.ProductVersionWhereInput = {}
      if (query.category !== undefined) where.categoryId = { in: await subtreeIds(prisma, query.category) }
      if (query.brand !== undefined) where.brand = { slug: query.brand }

      const live = { liveVersionId: { not: null }, liveVersion: { is: where } }
      const [total, products] = await Promise.all([
        prisma.product.count({ where: live }),
        prisma.product.findMany({
          where: live,
          include: { liveVersion: { include: { brand: true } } },
          orderBy: [{ liveVersion: { publishedAt: 'desc' } }, { id: 'asc' }],
          skip: (query.page - 1) * PRODUCT_PAGE_SIZE,
          take: PRODUCT_PAGE_SIZE,
        }),
      ])
      const body: ProductCardList = {
        items: products.map((p) => toCard(p.liveVersion!)),
        page: query.page,
        pageSize: PRODUCT_PAGE_SIZE,
        total,
      }
      res.json(body)
    })
    .get('/:slug', async (req, res) => {
      const { slug } = parse(SlugParams, req.params)
      const product = await prisma.product.findFirst({
        where: { liveVersion: { is: { slug } } },
        include: { liveVersion: { include: { brand: true, category: true } } },
      })
      if (!product?.liveVersion) throw notFound()
      const version = product.liveVersion
      const snapshot = ProductSnapshot.parse(version.snapshot)

      const [schema, tree, pages] = await Promise.all([
        loadAttributeSchema(prisma, snapshot.productType),
        loadVisibleTree(prisma),
        prisma.contentPage.findMany({
          where: { id: { in: snapshot.policyPageIds }, kind: 'policy', versions: { some: {} } },
          include: { versions: LATEST_VERSION },
          orderBy: { createdAt: 'asc' },
        }),
      ])
      const skuOf = new Map(snapshot.variants.map((v) => [v.id, v.sku]))
      const category = findVisible(tree, version.category.slug)?.category

      const body: PublicProduct = {
        slug: snapshot.slug,
        name: snapshot.name,
        productType: snapshot.productType,
        brand: { slug: version.brand.hidden ? null : version.brand.slug, name: version.brand.name },
        category: category ? { slug: category.slug, name: category.name } : null,
        modelCode: snapshot.modelCode,
        description: snapshot.description,
        usageCare: snapshot.usageCare,
        sizeChart: snapshot.sizeChart,
        originStatement: snapshot.originStatement,
        attributes: snapshot.attributes,
        groundShippingOnly: snapshot.groundShippingOnly,
        attributeSchema: schema.attributes,
        variants: snapshot.variants.map(({ sku, attributes, price, compareAtPrice }) => ({
          sku,
          attributes,
          price,
          compareAtPrice,
        })),
        images: snapshot.images.map((image) => ({
          ...imageRenditions(storage, image),
          alt: image.alt,
          skus: image.variantIds.map((id) => skuOf.get(id)!),
        })),
        policies: pages.map((page) => ({ slug: page.slug, title: page.versions[0]!.title })),
        publishedAt: version.publishedAt.toISOString(),
      }
      res.json(body)
    })
}

/** Id của danh mục theo slug và mọi danh mục con cháu, kể cả đang ẩn; slug không có thì rỗng. */
async function subtreeIds(prisma: Db, slug: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE down AS (
      SELECT id FROM category WHERE slug = ${slug}
      UNION ALL
      SELECT c.id FROM category c JOIN down ON c.parent_id = down.id
    )
    SELECT id::text FROM down`
  return rows.map((r) => r.id)
}
