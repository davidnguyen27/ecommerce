import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  GENDER_KEY,
  PRODUCT_PAGE_SIZE,
  ProductListQuery,
  ProductType,
  attributeFiltersOf,
  type ProductCard,
  type ProductSearchResult,
  type PublicProduct,
} from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { loadAttributeSchema } from '../catalog/attribute-schemas.ts'
import { publicCommitments } from '../catalog/commitments.ts'
import { findVisible, loadVisibleTree } from '../catalog/categories.ts'
import { ProductSnapshot, cheapestVariant } from '../catalog/publication.ts'
import { searchFacets, searchPage, type SearchCriteria } from '../catalog/search.ts'
import { LATEST_VERSION } from '../content/pages.ts'
import type { Db } from '../db.ts'
import type { Brand, ProductVersion } from '../generated/prisma/client.ts'
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
      const query = parse(ProductListQuery, { ...req.query, attributes: attributeFiltersOf(req.query) })
      const category =
        query.category === undefined
          ? undefined
          : await prisma.category.findUnique({ where: { slug: query.category }, select: { productType: true } })
      // Nhóm hàng đang xem quyết định bộ lọc và facets; chưa xác định thì chỉ có giới tính, chung mọi nhóm hàng.
      const productType = category?.productType ?? query.type ?? null
      const schema = await loadAttributeSchema(prisma, productType ?? ProductType.enum.footwear)
      const filterable = schema.attributes.filter((a) => a.filterable && (productType || a.key === GENDER_KEY))

      const criteria: SearchCriteria = {
        text: query.q,
        categoryIds: query.category === undefined ? undefined : await subtreeIds(prisma, query.category),
        brandSlug: query.brand,
        productType: query.type,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        // Key không lọc được ở nhóm hàng đang xem (URL cũ, schema đã đổi) thì bỏ qua thay vì báo lỗi.
        attributes: filterable.flatMap((definition) => {
          const values = query.attributes[definition.key] ?? []
          return values.length ? [{ definition, values }] : []
        }),
      }
      const [{ versionIds, total }, facets] = await Promise.all([
        searchPage(prisma, criteria, query.sort, query.page),
        searchFacets(prisma, criteria, filterable),
      ])
      const versions = await prisma.productVersion.findMany({
        where: { id: { in: versionIds } },
        include: { brand: true },
      })
      const byId = new Map(versions.map((v) => [v.id, v]))

      const body: ProductSearchResult = {
        items: versionIds.map((id) => toCard(byId.get(id)!)),
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
      const include = { liveVersion: { include: { brand: true, category: true } } } as const
      // Slug cũ (đã đổi rồi xuất bản lại) vẫn trả sản phẩm, kèm slug hiện tại để website chuyển hướng 301.
      // Slug đang có sản phẩm dùng thì ưu tiên sản phẩm đó; nhiều sản phẩm từng dùng thì lấy lần xuất bản gần nhất.
      const product =
        (await prisma.product.findFirst({ where: { liveVersion: { is: { slug } } }, include })) ??
        (await prisma.product.findFirst({
          where: { status: 'published', versions: { some: { slug } } },
          include,
          orderBy: { liveVersion: { publishedAt: 'desc' } },
        }))
      if (!product?.liveVersion) throw notFound()
      const version = product.liveVersion
      const snapshot = ProductSnapshot.parse(version.snapshot)

      const [schema, tree, commitments, pages] = await Promise.all([
        loadAttributeSchema(prisma, snapshot.productType),
        loadVisibleTree(prisma),
        publicCommitments(prisma, product.id),
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
        commitments,
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
