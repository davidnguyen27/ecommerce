import {
  PRODUCT_PAGE_SIZE,
  type ProductCard,
  type ProductSort,
  type PublicProduct,
  type VariantAvailability,
} from '@ecommerce/shared'
import type { Storage } from '../core/adapters/storage.ts'
import { LATEST_VERSION } from '../content/pages.ts'
import type { Db } from '../core/db.ts'
import type { Brand, ProductVersion } from '../generated/prisma/client.ts'
import { imageRenditions } from '../core/media/images.ts'
import { preorderOffers } from '../preorders/campaigns.ts'
import { inStockIds } from '../stock/stock.ts'
import { attributeSchemaQuery } from '../modules/attribute-schema/index.ts'
import { categoryQuery } from '../modules/category/index.ts'
import { ProductSnapshot, cheapestVariant } from './publication.ts'
import { searchPage, type SearchCriteria } from './search.ts'

// Products as customers see them, shared by the website (`routes/public-products.ts`) and chatbot tools (M8): only
// published products, read from the published version. Exceptions: in-stock status is read from stock (ADR 0006) and
// pre-order availability from campaigns (M4).

function toCard(
  storage: Storage,
  version: ProductVersion & { brand: Brand },
  snapshot: ProductSnapshot,
  inStock: boolean,
  preorder: boolean,
): ProductCard {
  const cheapest = cheapestVariant(snapshot)
  const cover = snapshot.images[0]
  return {
    slug: snapshot.slug,
    name: snapshot.name,
    brand: { slug: version.brand.slug, name: version.brand.name },
    fromPrice: cheapest.price,
    compareAtPrice: cheapest.compareAtPrice,
    image: cover ? { ...imageRenditions(storage, cover), alt: cover.alt } : null,
    inStock,
    preorder: !inStock && preorder,
  }
}

/** One page of matching product cards in display order, with the total. */
export async function searchProductCards(
  prisma: Db,
  storage: Storage,
  criteria: SearchCriteria,
  sort: ProductSort | undefined,
  page: number,
  pageSize = PRODUCT_PAGE_SIZE,
) {
  const { versionIds, total } = await searchPage(prisma, criteria, sort, page, pageSize)
  const versions = await prisma.productVersion.findMany({ where: { id: { in: versionIds } }, include: { brand: true } })
  // Versions with parsed snapshots, by version id.
  const parsedById = new Map(versions.map((v) => [v.id, { version: v, snapshot: ProductSnapshot.parse(v.snapshot) }]))
  const variantIds = [...parsedById.values()].flatMap(({ snapshot }) => snapshot.variants.map((v) => v.id))
  const [stocked, offers] = await Promise.all([inStockIds(prisma, variantIds), preorderOffers(prisma, variantIds)])
  const items = versionIds.map((id) => {
    const { version, snapshot } = parsedById.get(id)!
    return toCard(
      storage,
      version,
      snapshot,
      snapshot.variants.some((v) => stocked.has(v.id)),
      snapshot.variants.some((v) => offers.has(v.id)),
    )
  })
  return { items, total }
}

/**
 * A published product by slug, or `null`. An old slug (renamed then republished) still resolves, with the current slug
 * for a 301. Hidden brands or categories do not hide the product (GLOSSARY "Ẩn").
 */
export async function findPublicProduct(prisma: Db, storage: Storage, slug: string): Promise<PublicProduct | null> {
  const include = { liveVersion: { include: { brand: true, category: true } } } as const
  // A product currently using the slug wins; otherwise the most recent publish among past users.
  const product =
    (await prisma.product.findFirst({ where: { liveVersion: { is: { slug } } }, include })) ??
    (await prisma.product.findFirst({
      where: { status: 'published', versions: { some: { slug } } },
      include,
      orderBy: { liveVersion: { publishedAt: 'desc' } },
    }))
  if (!product?.liveVersion) return null
  const version = product.liveVersion
  const snapshot = ProductSnapshot.parse(version.snapshot)
  const variantIds = snapshot.variants.map((v) => v.id)

  const [schema, tree, pages, stocked, offers] = await Promise.all([
    attributeSchemaQuery.load(prisma, snapshot.productType),
    categoryQuery.loadVisibleTree(prisma),
    prisma.contentPage.findMany({
      where: { id: { in: snapshot.policyPageIds }, kind: 'policy', versions: { some: {} } },
      include: { versions: LATEST_VERSION },
      orderBy: { createdAt: 'asc' },
    }),
    inStockIds(prisma, variantIds),
    preorderOffers(prisma, variantIds),
  ])
  const skuOf = new Map(snapshot.variants.map((v) => [v.id, v.sku]))
  const category = categoryQuery.findVisible(tree, version.category.slug)?.category

  return {
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
    variants: snapshot.variants.map(({ id, sku, attributes, price, compareAtPrice }) => {
      // In stock is never pre-order; `preorderOffers` already excludes those variants.
      const inStock = stocked.has(id)
      const preorder = inStock ? null : (offers.get(id) ?? null)
      const availability: VariantAvailability = inStock ? 'in_stock' : preorder ? 'preorder' : 'out_of_stock'
      return { id, sku, attributes, price, compareAtPrice, inStock, availability, preorder }
    }),
    images: snapshot.images.map((image) => ({
      ...imageRenditions(storage, image),
      alt: image.alt,
      skus: image.variantIds.map((id) => skuOf.get(id)!),
    })),
    policies: pages.map((page) => ({ slug: page.slug, title: page.versions[0]!.title })),
    commitments: snapshot.commitments,
    publishedAt: version.publishedAt.toISOString(),
  }
}

/** Ids of the category with this slug and all descendants, hidden ones included; unknown slug gives none. */
export async function subtreeIds(prisma: Db, slug: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE down AS (
      SELECT id FROM category WHERE slug = ${slug}
      UNION ALL
      SELECT c.id FROM category c JOIN down ON c.parent_id = down.id
    )
    SELECT id::text FROM down`
  return rows.map((r) => r.id)
}
